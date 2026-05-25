// Search Loop — site-agnostic state machine for automated BOM price searching
// Drives a SiteAdapter through search → results → pricing for each pending BOM part.
// CAPTCHA pauses the loop; Agent handles exceptions.
// Path: /root/bom-to-cart-extension/background/search-loop.js

import { BOMStore } from '/lib/bom-store.js';

const STATES = {
  IDLE: 'idle',
  NEXT_PART: 'next_part',
  SEARCHING: 'searching',
  GET_RESULTS: 'get_results',
  SAVING: 'saving',
  AGENT_FALLBACK: 'agent_fallback',
  USER_NEEDED: 'user_needed',
  RETRYING: 'retrying',
  DONE: 'done'
};

export class SearchLoop {
  /**
   * @param {import('/lib/site-adapter.js').SiteAdapter} adapter
   * @param {object} options
   * @param {number} options.stepDelay - ms between steps (default: 2000)
   * @param {number} options.maxRetries - max retries before asking agent (default: 2)
   * @param {Function} options.onAgentException - (payload) => Promise<{action}> — called for agent decisions
   */
  constructor(adapter, options = {}) {
    this.adapter = adapter;
    this.state = STATES.IDLE;
    this.stepDelay = options.stepDelay || 2000;
    this.maxRetries = options.maxRetries || 2;
    this._onAgentException = options.onAgentException || null;

    this.currentPart = null;
    this.retryCount = 0;
    this.progress = { total: 0, done: 0, current: 0 };
    this.logs = [];

    // Callbacks
    this._onLog = null;
    this._onStateChange = null;
    this._onCaptcha = null;

    this._aborted = false;
    this._paused = false;
    this._resumeResolve = null;
  }

  // ── Callbacks ────────────────────────────────────────────

  onLog(cb) { this._onLog = cb; }
  onStateChange(cb) { this._onStateChange = cb; }
  onCaptcha(cb) { this._onCaptcha = cb; }

  // ── Public API ───────────────────────────────────────────

  getStatus() {
    return {
      state: this.state,
      progress: { ...this.progress },
      currentPart: this.currentPart ? this.currentPart.name : null,
      logs: this.logs.slice(-50),
      paused: this._paused
    };
  }

  async start() {
    if (this.state !== STATES.IDLE) return;
    this._aborted = false;
    this._paused = false;
    this.retryCount = 0;
    this.logs = [];

    // Count total pending
    const stats = await BOMStore.stats();
    this.progress = { total: stats.pending, done: 0, current: 0 };

    this.log('info', `搜索启动 — ${this.adapter.name}, ${stats.pending} 个零件待搜索`);
    this._transition(STATES.NEXT_PART);
    await this._run();
  }

  pause() {
    this._paused = true;
    this.log('warn', '搜索已暂停');
  }

  async resume() {
    if (!this._paused) return;
    this._paused = false;
    this.log('info', '搜索已恢复');
    if (this._resumeResolve) {
      this._resumeResolve();
      this._resumeResolve = null;
    }
  }

  stop() {
    this._aborted = true;
    this._paused = false;
    if (this._resumeResolve) {
      this._resumeResolve();
      this._resumeResolve = null;
    }
    this.log('warn', '搜索已停止');
    this._transition(STATES.DONE);
  }

  // ── State Machine ────────────────────────────────────────

  async _run() {
    while (this.state !== STATES.DONE && !this._aborted) {
      await this._waitIfPaused();

      try {
        switch (this.state) {
          case STATES.NEXT_PART:
            await this._nextPart();
            break;
          case STATES.SEARCHING:
            await this._doSearch();
            break;
          case STATES.GET_RESULTS:
            await this._getResults();
            break;
          case STATES.SAVING:
            await this._savePrices();
            break;
          case STATES.AGENT_FALLBACK:
            await this._handleException();
            break;
          case STATES.USER_NEEDED:
            await this._waitForUser();
            break;
          case STATES.RETRYING:
            await this._retry();
            break;
        }
      } catch (err) {
        this.log('error', `异常: ${err.message}`);
        this._lastError = { step: this.state, error: err.message };
        this._transition(STATES.AGENT_FALLBACK);
      }
    }
  }

  // ── State Handlers ───────────────────────────────────────

  async _nextPart() {
    const resp = await BOMStore.load();
    if (!resp || !resp.parts) {
      this._transition(STATES.DONE);
      return;
    }

    const pending = resp.parts.filter(p => p.status === 'pending');
    if (pending.length === 0) {
      this.log('info', '✓ 所有零件已处理完毕');
      this._transition(STATES.DONE);
      return;
    }

    this.currentPart = pending[0];
    this.retryCount = 0;
    this.progress.current = this.progress.total - pending.length + 1;

    // Mark as searching
    await BOMStore.updatePart(this.currentPart.id, { status: 'searching' });

    this.log('info', `开始搜索: ${this.currentPart.name} (${this.progress.current}/${this.progress.total + this.progress.done + 1})`);
    this._transition(STATES.SEARCHING);
  }

  async _doSearch() {
    if (!this.currentPart) return;
    // Strip parenthetical notes from name for cleaner search query
    let query = this.currentPart.name.replace(/\s*\([^)]*\)\s*$/, '');
    this.log('info', `-> 执行搜索: "${query}"`);

    // If part already has an octopart_url, skip search
    if (this.currentPart.octopart_url) {
      this.log('info', `→ 跳过搜索，直接提取已知 URL 的数据`);
      this._transition(STATES.GET_RESULTS);
      return;
    }

    await this.adapter.search(query);
    await this._delay(this.stepDelay);

    // Check for CAPTCHA (quick check before getting results)
    const captcha = await this.adapter.detectCaptcha();
    if (captcha.captcha) {
      this._triggerCaptcha(captcha);
      this._transition(STATES.USER_NEEDED);
      return;
    }

    this._transition(STATES.GET_RESULTS);
  }

  async _getResults() {
    const data = await this.adapter.getSearchResults();

    if (!data.results || data.results.length === 0) {
      this.log('warn', '搜索结果为空');
      this._lastError = { step: STATES.GET_RESULTS, error: 'No search results found' };
      this._transition(STATES.AGENT_FALLBACK);
      return;
    }

    this.log('info', `搜索结果: ${data.results.length} 个匹配 → 自动选第一个`);

    // Auto-select first result
    const selected = data.results[0];
    this._selectedUrl = selected.href;

    // If search results include inline pricing, skip to save
    if (selected.pricing && selected.pricing.length > 0) {
      this._extractedPrices = selected.pricing;
      this.log('info', `→ 已提取 ${selected.pricing.length} 个报价（直接从搜索结果页）`);
      this._transition(STATES.SAVING);
      return;
    }

    // No pricing found in search results — treat as not found
    this.log('warn', '搜索结果无价格数据');
    this._lastError = { step: STATES.GET_RESULTS, error: 'No pricing in search results' };
    this._transition(STATES.AGENT_FALLBACK);
  }

  async _savePrices() {
    if (!this.currentPart || !this._extractedPrices) {
      this._transition(STATES.NEXT_PART);
      return;
    }

    // Build prices object: { distributorName: unitPrice }
    const prices = {};
    for (const s of this._extractedPrices) {
      if (s.distributor && typeof s.unit_price === 'number') {
        prices[s.distributor] = s.unit_price;
      }
    }

    const priceSummary = Object.entries(prices).map(([k, v]) => `${k}: $${v}`).join(', ');
    this.log('success', `✓ 提取价格: ${priceSummary}`);

    await BOMStore.updatePart(this.currentPart.id, {
        status: 'priced', prices, octopart_url: this._selectedUrl || this.currentPart.octopart_url
      });

    this.progress.done++;
    this.log('success', `✓ ${this.currentPart.name} 完成 (${this.progress.done} 个已标价)`);

    this._extractedPrices = null;
    this._selectedUrl = null;
    this.currentPart = null;
    this._transition(STATES.NEXT_PART);
  }

  async _handleException() {
    const err = this._lastError;
    if (!err) {
      this._transition(STATES.RETRYING);
      return;
    }

    this.log('warn', `⚠ Agent 决策中... (${err.error})`);

    // Get page snapshot for context
    let pageInfo = 'unavailable';
    try {
      const snap = await this.adapter.getPageSnapshot();
      pageInfo = `${snap.title || '?'} — ${snap.bodyPreview?.substring(0, 200) || ''}`;
    } catch {}

    // Use direct callback instead of sendMessage (SW-to-SW unreliable)
    if (!this._onAgentException) {
      this.log('error', 'Agent 回调未配置');
      this._transition(STATES.RETRYING);
      return;
    }

    let resp;
    try {
      resp = await this._onAgentException({
        step: err.step,
        error: err.error,
        url: err.pageSnapshot?.url || '',
        pageInfo
      });
    } catch (e) {
      this.log('error', `Agent 调用异常: ${e.message}`);
      this._transition(STATES.RETRYING);
      return;
    }

    if (!resp || resp.error) {
      this.log('error', `Agent 调用失败: ${resp?.error || '无响应'}`);
      this._transition(STATES.RETRYING);
      return;
    }

    const action = resp.action;
    if (!action || typeof action.action !== 'string') {
      this.log('error', `Agent 返回格式异常: ${JSON.stringify(resp)}`);
      this._transition(STATES.RETRYING);
      return;
    }

    this.log('info', `Agent 决策: ${action.action} — ${action.reason || '无原因'}`);

    switch (action.action) {
      case 'retry':
        this._transition(STATES.RETRYING);
        break;
      case 'skip':
        // Mark as not_found
        if (this.currentPart) {
          await BOMStore.updatePart(this.currentPart.id, { status: 'not_found' });
          this.log('warn', `跳过: ${this.currentPart.name}`);
        }
        this.progress.done++;
        this.currentPart = null;
        this._transition(STATES.NEXT_PART);
        break;
      case 'wait':
        this.log('info', `等待 ${action.seconds || 3}s...`);
        await this._delay((action.seconds || 3) * 1000);
        this._transition(STATES.RETRYING);
        break;
      case 'captcha':
        this._triggerCaptcha({ indicators: [action.reason] });
        this._transition(STATES.USER_NEEDED);
        break;
      case 'navigate':
        // Detail page navigation no longer supported — treat as retry
        this.log('warn', 'Agent 建议导航但详情页流程已移除，重试');
        this._transition(STATES.RETRYING);
        break;
      case 'abort':
      default:
        this.log('error', `Agent 放弃: ${action.reason}`);
        this._transition(STATES.DONE);
        break;
    }
  }

  async _waitForUser() {
    this.log('warn', '⚠ CAPTCHA 检测 — 请完成验证后点击 "继续"');
    this._paused = true;

    // System notification
    try {
      chrome.notifications.create('captcha-' + Date.now(), {
        type: 'basic',
        iconUrl: '/icons/icon-48.png',
        title: 'BOM-to-Cart — CAPTCHA',
        message: `${this.adapter.name} 需要人机验证，请打开页面完成验证。`,
        priority: 2
      });
    } catch {}

    if (this._onCaptcha) this._onCaptcha();
  }

  async _retry() {
    this.retryCount++;
    if (this.retryCount > this.maxRetries) {
      // Exhausted retries — skip this part rather than looping back to agent
      this.log('warn', `已达最大重试次数 (${this.maxRetries})，跳过当前零件`);
      if (this.currentPart) {
        await BOMStore.updatePart(this.currentPart.id, { status: 'not_found' });
        this.log('warn', `跳过: ${this.currentPart.name}`);
      }
      this.progress.done++;
      this.currentPart = null;
      this._transition(STATES.NEXT_PART);
      return;
    }
    this.log('info', `重试 (${this.retryCount}/${this.maxRetries})...`);
    await this._delay(this.stepDelay);

    // Go back to the step that failed
    const prevState = this._lastError?.step;
    if (prevState === STATES.SEARCHING || prevState === STATES.GET_RESULTS) {
      this._transition(STATES.SEARCHING);
    } else {
      this._transition(STATES.SAVING);
    }
  }

  // ── Helpers ───────────────────────────────────────────────

  _transition(newState) {
    const old = this.state;
    this.state = newState;
    this._notifyStateChange();
    if (old !== newState) {
      console.log(`[SearchLoop] ${old} → ${newState}`);
    }
  }

  _notifyStateChange() {
    if (this._onStateChange) {
      try { this._onStateChange(this.getStatus()); } catch {}
    }
  }

  _triggerCaptcha(result) {
    if (this._onCaptcha) {
      try { this._onCaptcha(result); } catch {}
    }
  }

  log(level, msg) {
    const entry = {
      ts: new Date().toISOString(),
      level,
      msg
    };
    this.logs.push(entry);
    console.log(`[SearchLoop] [${level}] ${msg}`);
    if (this._onLog) {
      try { this._onLog(entry); } catch {}
    }
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async _waitIfPaused() {
    if (!this._paused) return;
    return new Promise((resolve) => {
      this._resumeResolve = resolve;
    });
  }
}