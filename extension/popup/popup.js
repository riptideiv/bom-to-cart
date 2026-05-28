// BOM-to-Cart Popup Controller
// Path: /root/bom-to-cart-extension/popup/popup.js

import { BOMStore } from '/lib/bom-store.js';

// ── Init ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  try {
    initTabs();
    await checkAgentStatus();
    await renderBOMSelector();
    await renderBOMTable();
    bindEvents();
  } catch (err) {
    console.error('[BOM-to-Cart] Init crash:', err);
    const el = document.getElementById('bom-stats');
    if (el) el.textContent = `初始化失败: ${err.message}`;
    // Still bind events so user can retry
    try { bindEvents(); } catch {}
  }
});

// ── Tab Switching ──────────────────────────────────────────
function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');

      if (tab.dataset.tab === 'optimize') renderOptimizeTab();
      if (tab.dataset.tab === 'bom') renderBOMTable();
    });
  });
}

// ── BOM Manager ──────────────────────────────────────────

async function renderBOMSelector() {
  const sel = document.getElementById('bom-selector');
  // Get list
  let resp = await chrome.runtime.sendMessage({ type: 'bom:list' });
  if (!resp) { sel.innerHTML = '<option value="">SW 未响应</option>'; return; }

  const { list, activeId } = resp;
  sel.innerHTML = list.map(e =>
    `<option value="${e.id}" ${e.id === activeId ? 'selected' : ''}>${escHtml(e.name)}</option>`
  ).join('');
  if (list.length === 0) {
    sel.innerHTML = '<option value="">— 无 BOM —</option>';
  }
}

async function handleBOMSwitch() {
  const sel = document.getElementById('bom-selector');
  const id = sel.value;
  if (!id) return;

  const resp = await chrome.runtime.sendMessage({ type: 'bom:switch', payload: { id } });
  if (!resp || resp.error) { alert('切换失败: ' + (resp?.error || 'SW 未响应')); return; }
  await renderBOMTable();
  await renderBOMSelector();
}

async function handleBOMNew() {
  const name = prompt('新建 BOM 名称:', 'Untitled BOM');
  if (name === null) return;
  const bomName = name.trim() || 'Untitled BOM';

  const resp = await chrome.runtime.sendMessage({ type: 'bom:new', payload: { name: bomName } });
  if (!resp || resp.error) { alert('创建失败: ' + (resp?.error || 'SW 未响应')); return; }
  await renderBOMSelector();
  await renderBOMTable();
}

async function handleBOMSaveAs() {
  const name = prompt('另存为:', 'My BOM');
  if (name === null) return;
  const bomName = name.trim() || 'My BOM';

  const resp = await chrome.runtime.sendMessage({ type: 'bom:save-as', payload: { name: bomName } });
  if (!resp || resp.error) { alert('保存失败: ' + (resp?.error || 'SW 未响应')); return; }
  await renderBOMSelector();
}

async function handleBOMDelete() {
  const sel = document.getElementById('bom-selector');
  const id = sel.value;
  if (!id) return;

  const option = sel.selectedOptions[0];
  const name = option ? option.textContent : 'this BOM';
  if (!confirm(`确定删除 "${name}"？此操作不可撤销。`)) return;

  const resp = await chrome.runtime.sendMessage({ type: 'bom:delete-bom', payload: { id } });
  if (!resp || resp.error) { alert('删除失败: ' + (resp?.error || 'SW 未响应')); return; }
  await renderBOMSelector();
  await renderBOMTable();
}

async function handleBulkStatus() {
  const sel = document.getElementById('bulk-status');
  const status = sel.value;
  if (!status) return;
  const label = sel.options[sel.selectedIndex].text;
  if (!confirm(`将所有零件的状态设为 "${label}"？此操作不可撤销。`)) return;

  const resp = await chrome.runtime.sendMessage({ type: 'bom:bulk-status', payload: { status } });
  if (!resp || resp.error) { alert('批量更新失败: ' + (resp?.error || 'SW 未响应')); return; }
  sel.value = '';
  await renderBOMTable();
}

// ── Agent Status ───────────────────────────────────────────
async function checkAgentStatus() {
  const el = document.getElementById('agent-status');
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'agent:is-configured' });
    if (resp) {
      el.textContent = 'Agent: ⬤ Ready';
      el.className = 'agent-status online';
    } else {
      el.textContent = 'Agent: ⬤ No API key';
      el.className = 'agent-status offline';
    }
  } catch {
    el.textContent = 'Agent: ⬤ SW error';
    el.className = 'agent-status offline';
  }
}

// ── BOM Table Rendering ───────────────────────────────────
async function renderBOMTable() {
  const stats = await chrome.runtime.sendMessage({ type: 'bom:stats' });
  if (!stats) {
    document.getElementById('bom-stats').textContent = '无法加载 BOM (SW 未响应)';
    return;
  }
  document.getElementById('bom-stats').textContent =
    `${stats.total} 零件 · ${stats.priced} 已标价 · ${stats.pending} 待搜索`;

  const bom = await chrome.runtime.sendMessage({ type: 'bom:load' });
  const table = document.getElementById('bom-table');
  const thead = table.querySelector('thead');

  if (!bom || !bom.parts.length) {
    thead.innerHTML = '<tr><th>#</th><th>零件名</th><th>数量</th><th>规格</th><th>状态</th><th>操作</th></tr>';
    table.querySelector('tbody').innerHTML = '<tr class="empty-row"><td colspan="6">还没有零件。点击 "从文本导入" 或 "添加行"。</td></tr>';
    return;
  }

  // Collect all unique distributors
  const allDistributors = [...new Set(
    bom.parts.flatMap(p => Object.keys(p.prices || {}))
  )].sort();

  // Build header
  const distHeaders = allDistributors.map(d => `<th class="dist-col">${escHtml(d)}</th>`).join('');
  thead.innerHTML = `<tr><th>#</th><th>零件名</th><th>数量</th><th>规格</th><th>状态</th>${distHeaders}<th>操作</th></tr>`;

  // Build rows
  const tbody = table.querySelector('tbody');
  tbody.innerHTML = bom.parts.map((p, i) => {
    const specsStr = p.specs ? Object.entries(p.specs).map(([k, v]) => `${k}: ${v}`).join(', ') : '';
    const distCells = allDistributors.map(d => {
      const v = p.prices?.[d];
      return v !== undefined ? `<td class="price-cell">$${Number(v).toFixed(2)}</td>` : '<td class="price-cell empty">—</td>';
    }).join('');

    return `
      <tr data-id="${p.id}">
        <td>${i + 1}</td>
        <td><input type="text" value="${escAttr(p.name)}" data-field="name" data-id="${p.id}"></td>
        <td><input type="number" value="${p.quantity}" data-field="quantity" data-id="${p.id}" class="inline-qty" min="1"></td>
        <td><input type="text" value="${escAttr(specsStr)}" data-field="specsStr" data-id="${p.id}" style="width:80px"></td>
        <td><span class="status-badge status-${p.status}">${p.status}</span></td>
        ${distCells}
        <td>
          <button class="btn-small btn-danger" data-action="delete" data-id="${p.id}">✕</button>
        </td>
      </tr>`;
  }).join('');

  // Inline edit — save on blur/enter
  tbody.querySelectorAll('input').forEach(inp => {
    inp.addEventListener('change', () => saveInlineEdit(inp));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); } });
  });

  // Delete buttons
  tbody.querySelectorAll('[data-action="delete"]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('删除这个零件？')) return;
      await chrome.runtime.sendMessage({ type: 'bom:remove-part', payload: btn.dataset.id });
      await renderBOMTable();
    });
  });
}

async function saveInlineEdit(inp) {
  const id = inp.dataset.id;
  const field = inp.dataset.field;
  let value = inp.value.trim();

  if (field === 'quantity') {
    value = Math.max(1, parseInt(value) || 1);
    inp.value = value;
    await chrome.runtime.sendMessage({ type: 'bom:update-part', payload: { id, changes: { quantity: value } } });
  } else if (field === 'name') {
    await chrome.runtime.sendMessage({ type: 'bom:update-part', payload: { id, changes: { name: value } } });
  } else if (field === 'specsStr') {
    const specs = {};
    if (value) {
      value.split(',').forEach(pair => {
        const [k, v] = pair.split(':').map(s => s.trim());
        if (k && v !== undefined) specs[k] = v;
      });
    }
    await chrome.runtime.sendMessage({ type: 'bom:update-part', payload: { id, changes: { specs } } });
  }
  await renderBOMTable();
}

// ── Import Flow ────────────────────────────────────────────
function bindEvents() {
  // ── BOM Manager ──
  document.getElementById('bom-selector').addEventListener('change', handleBOMSwitch);
  document.getElementById('btn-bom-new').addEventListener('click', handleBOMNew);
  document.getElementById('btn-bom-saveas').addEventListener('click', handleBOMSaveAs);
  document.getElementById('btn-bom-delete').addEventListener('click', handleBOMDelete);

  // Bulk status
  document.getElementById('btn-bulk-status').addEventListener('click', handleBulkStatus);

  // Import
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('import-modal').classList.remove('hidden');
  });
  document.getElementById('btn-cancel-import').addEventListener('click', () => {
    document.getElementById('import-modal').classList.add('hidden');
    document.getElementById('import-status').textContent = '';
  });
  document.getElementById('btn-parse').addEventListener('click', handleParseBOM);

  // Clarify
  document.getElementById('btn-clarify-send').addEventListener('click', handleClarifySend);
  document.getElementById('btn-clarify-skip').addEventListener('click', () => {
    document.getElementById('clarify-dialog').classList.add('hidden');
  });

  // Add row
  document.getElementById('btn-add-row').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ type: 'bom:add-part', payload: { name: 'New Part', quantity: 1 } });
    await renderBOMTable();
  });

  // Clear BOM
  document.getElementById('btn-clear-bom').addEventListener('click', async () => {
    if (!confirm('确定要清空整个 BOM 表吗？此操作不可撤销。')) return;
    await chrome.runtime.sendMessage({ type: 'bom:save', payload: { version: '1.0', parts: [] } });
    await renderBOMTable();
  });

  // Search console
  document.getElementById('btn-search-start').addEventListener('click', handleSearchStart);
  document.getElementById('btn-search-pause').addEventListener('click', handleSearchPause);
  document.getElementById('btn-search-stop').addEventListener('click', handleSearchStop);

  // Listen for search state updates from background SW
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'search:log') appendLog(msg.data);
    if (msg.type === 'search:state-change') handleStateChange(msg.data);
    if (msg.type === 'search:captcha') handleCaptchaEvent();
  });

  // Start polling for search status
  startSearchPolling();
}

// ── Agent BOM Parsing ──────────────────────────────────────
async function handleParseBOM() {
  const textarea = document.getElementById('import-textarea');
  const statusEl = document.getElementById('import-status');
  const bomText = textarea.value.trim();

  if (!bomText) {
    statusEl.textContent = '请先粘贴 BOM 内容';
    statusEl.className = 'status-msg error';
    return;
  }

  statusEl.textContent = 'Agent 正在解析...';
  statusEl.className = 'status-msg loading';
  document.getElementById('btn-parse').disabled = true;

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'agent:parse-bom',
      payload: { bomText }
    });

    if (resp.error) throw new Error(resp.error);

    const { bom, rawResponse } = resp;

    // Save parsed BOM to storage
    await chrome.runtime.sendMessage({ type: 'bom:replace-parts', payload: bom.parts });
    await chrome.runtime.sendMessage({
      type: 'bom:save',
      payload: { ...bom, parts: bom.parts }
    });

    statusEl.textContent = `✓ 解析完成！${bom.parts.length} 个零件 (${rawResponse.model})`;
    statusEl.className = 'status-msg success';

    // Check for parts with notes (ambiguities)
    const ambiguous = bom.parts.filter(p => p.notes);
    if (ambiguous.length > 0) {
      const question = ambiguous.map(p => `• ${p.name}: ${p.notes}`).join('\n');
      document.getElementById('clarify-question').textContent =
        `以下 ${ambiguous.length} 个零件存在歧义，Agent 已做了猜测：\n\n${question}\n\n需要修改吗？`;
      document.getElementById('clarify-dialog').classList.remove('hidden');
      document.getElementById('clarify-answer').value = '';
    }

    await renderBOMTable();
    setTimeout(() => {
      document.getElementById('import-modal').classList.add('hidden');
      statusEl.textContent = '';
      statusEl.className = 'status-msg';
    }, 1500);

  } catch (err) {
    statusEl.textContent = '✗ ' + err.message;
    statusEl.className = 'status-msg error';
  } finally {
    document.getElementById('btn-parse').disabled = false;
  }
}

async function handleClarifySend() {
  const answer = document.getElementById('clarify-answer').value.trim();
  if (!answer) return;

  document.getElementById('btn-clarify-send').disabled = true;
  document.getElementById('btn-clarify-send').textContent = '处理中...';

  try {
    const bom = await chrome.runtime.sendMessage({ type: 'bom:load' });
    const resp = await chrome.runtime.sendMessage({
      type: 'agent:clarify',
      payload: { bom, question: answer }
    });

    // TODO: parse clarification response and merge
    document.getElementById('clarify-dialog').classList.add('hidden');
  } catch (err) {
    alert('Clarify error: ' + err.message);
  } finally {
    document.getElementById('btn-clarify-send').disabled = false;
    document.getElementById('btn-clarify-send').textContent = '发送';
  }
}

// ── Search Console ─────────────────────────────────────────

let _searchPollTimer = null;
let _searchRunning = false;

function startSearchPolling() {
  // Sync immediately on popup open — rebuild console from existing state+logs
  (async () => {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'search:status' });
      if (status && status.state && status.state !== 'idle' && status.state !== 'done') {
        updateSearchButtons(status);
        // Rebuild console from existing logs
        const out = document.getElementById('console-output');
        if (status.logs && status.logs.length > 0) {
          out.innerHTML = '';
          status.logs.forEach(entry => appendLog(entry));
        } else {
          out.innerHTML = '<div class="console-line">搜索运行中...</div>';
        }
      }
    } catch {}
  })();

  _searchPollTimer = setInterval(async () => {
    try {
      const status = await chrome.runtime.sendMessage({ type: 'search:status' });
      if (status && status.state && status.state !== 'idle' && status.state !== 'done') {
        updateSearchButtons(status);
      }
    } catch {}
  }, 1000);
}

async function handleSearchStart() {
  const site = document.getElementById('site-select').value;
  const out = document.getElementById('console-output');

  const configured = await chrome.runtime.sendMessage({ type: 'agent:is-configured' });
  if (!configured) {
    out.innerHTML = '<div class="console-line"><span class="error">✗ Agent 未配置。</span> 请在扩展选项页设置 OpenRouter API Key。</div>';
    return;
  }

  const stats = await chrome.runtime.sendMessage({ type: 'bom:stats' });
  if (!stats) {
    out.innerHTML = '<div class="console-line"><span class="error">✗ SW 未响应。</span> 请重新打开扩展弹窗。</div>';
    return;
  }
  if (stats.pending === 0) {
    out.innerHTML = '<div class="console-line"><span class="warn">⚠ 没有待搜索的零件。</span></div>';
    return;
  }

  // Clear console and show progress bar
  out.innerHTML = '';
  document.getElementById('search-progress').classList.remove('hidden');

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'search:start', payload: { site } });
    if (resp.error) throw new Error(resp.error);

    _searchRunning = true;
    updateSearchButtons({ state: 'running', progress: { total: stats.pending, done: 0, current: 0 } });
  } catch (err) {
    out.innerHTML = `<div class="console-line"><span class="error">✗ ${escHtml(err.message)}</span></div>`;
  }
}

async function handleSearchPause() {
  await chrome.runtime.sendMessage({ type: 'search:pause' });
}

function handleSearchStop() {
  chrome.runtime.sendMessage({ type: 'search:stop' });
  _searchRunning = false;
  document.getElementById('search-progress').classList.add('hidden');
  document.getElementById('btn-search-start').disabled = false;
  document.getElementById('btn-search-pause').disabled = true;
  document.getElementById('btn-search-stop').disabled = true;
}

function updateSearchButtons(status) {
  const startBtn = document.getElementById('btn-search-start');
  const pauseBtn = document.getElementById('btn-search-pause');
  const stopBtn = document.getElementById('btn-search-stop');
  const progressEl = document.getElementById('search-progress');

  const state = status.state;
  const isActive = state !== 'idle' && state !== 'done';

  startBtn.disabled = isActive;
  pauseBtn.disabled = !isActive || status.paused;
  stopBtn.disabled = !isActive;

  if (isActive) {
    progressEl.classList.remove('hidden');
    const p = status.progress || {};
    const total = p.total || 1;
    const done = p.done || 0;
    const pct = Math.round((done / total) * 100);
    document.getElementById('progress-bar-fill').style.width = pct + '%';
    document.getElementById('progress-text').textContent = `${done}/${total} (${pct}%)`;
    if (status.currentPart) {
      document.getElementById('progress-current').textContent = `当前: ${status.currentPart}`;
    }
    if (status.paused) {
      document.getElementById('btn-search-pause').textContent = '▶ 继续';
      document.getElementById('btn-search-pause').onclick = () => {
        chrome.runtime.sendMessage({ type: 'search:resume' });
      };
    } else {
      document.getElementById('btn-search-pause').textContent = '⏸ 暂停';
      document.getElementById('btn-search-pause').onclick = handleSearchPause;
    }
  } else if (state === 'done') {
    _searchRunning = false;
    progressEl.classList.add('hidden');
    startBtn.disabled = false;
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
    document.getElementById('btn-search-pause').textContent = '⏸ 暂停';
    document.getElementById('btn-search-pause').onclick = handleSearchPause;
  }
}

function handleStateChange(status) {
  if (!status) return;
  updateSearchButtons(status);
  if (status.state === 'done' && status.error) {
    appendLog({ ts: new Date().toISOString(), level: 'error', msg: '搜索异常终止: ' + status.error });
  }
}

function handleCaptchaEvent() {
  appendLog({ ts: new Date().toISOString(), level: 'warn', msg: '⚠ CAPTCHA — 请完成验证后点击"继续"' });
  updateSearchButtons({ state: 'running', paused: true, progress: {} });
}

function appendLog(entry) {
  const out = document.getElementById('console-output');
  if (!out) return;
  // Remove placeholder if present
  const ph = out.querySelector('.console-placeholder');
  if (ph) ph.remove();

  const ts = new Date(entry.ts).toLocaleTimeString('en-US', { hour12: false });
  const line = document.createElement('div');
  line.className = 'console-line';
  line.innerHTML = `<span class="ts">[${ts}]</span> <span class="${entry.level}">${escHtml(entry.msg)}</span>`;
  out.appendChild(line);
  out.scrollTop = out.scrollHeight;
}

function logConsole(el, level, msg) {
  // Legacy helper — now channeled through appendLog to centralize
  appendLog({ ts: new Date().toISOString(), level, msg });
}

// ── Optimize Tab ───────────────────────────────────────────
async function renderOptimizeTab() {
  const el = document.getElementById('optimize-results');
  const stats = await chrome.runtime.sendMessage({ type: 'bom:stats' });
  if (!stats) {
    el.innerHTML = '<div class="optimize-placeholder error">无法加载数据 (SW 未响应)</div>';
    return;
  }

  if (stats.priced === 0) {
    el.innerHTML = '<div class="optimize-placeholder">还没有已标价的零件。先在 Octopart 搜索并标价。</div>';
    return;
  }

  el.innerHTML = '<div class="optimize-placeholder loading">计算中...</div>';

  const shipping = parseFloat(document.getElementById('shipping-cost')?.value) || 10;
  const result = await chrome.runtime.sendMessage({
    type: 'optimize:run',
    payload: { shipping }
  });

  if (!result || result.error === 'No BOM loaded') {
    el.innerHTML = '<div class="optimize-placeholder error">优化失败: SW 未响应</div>';
    return;
  }

  if (result.error) {
    el.innerHTML = `<div class="optimize-placeholder error">${escHtml(result.error)}</div>`;
    return;
  }

  // Render plans
  const plans = result.plans || [];
  if (!plans.length) {
    el.innerHTML = '<div class="optimize-placeholder">优化器未生成任何方案。请确认零件有价格数据。</div>';
    return;
  }

  const header = `<div class="optimize-meta">
    算法: ${result.algorithm} · ${result.priced_parts} 个零件 · ${result.total_platforms_considered} 个经销商
    ${result.warning ? `<br><span class="warn">⚠ ${escHtml(result.warning)}</span>` : ''}
  </div>`;

  const plansHtml = plans.map(p => {
    const distCols = p.platforms_used.map(d => `<span class="plan-dist">${escHtml(d)}</span>`).join(' ');
    const rows = p.breakdown.map(b => `
      <tr>
        <td>${escHtml(b.part)}</td>
        <td>${b.quantity}</td>
        <td>${escHtml(b.platform)}</td>
        <td class="num">$${b.unit_price.toFixed(2)}</td>
        <td class="num">$${b.subtotal.toFixed(2)}</td>
      </tr>
    `).join('');

    return `
      <div class="plan-card">
        <div class="plan-header">
          <span class="plan-rank">#${p.rank}</span>
          <span class="plan-total">$${p.total.toFixed(2)}</span>
          <span class="plan-detail">零件 $${p.parts_cost} + 运费 $${p.shipping} (${p.num_platforms} 个平台)</span>
        </div>
        <div class="plan-platforms">${distCols}</div>
        <table class="plan-table">
          <thead><tr><th>零件</th><th>数量</th><th>平台</th><th>单价</th><th>小计</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  el.innerHTML = header + plansHtml;
}

// Bind optimize button
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-optimize')?.addEventListener('click', renderOptimizeTab);
});

// ── Helpers ────────────────────────────────────────────────
function escHtml(s) {
  const d = document.createElement('div');
  d.textContent = s;
  return d.innerHTML;
}

function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
