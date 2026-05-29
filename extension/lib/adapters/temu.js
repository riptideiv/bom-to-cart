// Temu Adapter — SiteAdapter implementation for temu.com
// Bridges SearchLoop ↔ content/temu.js primitives via chrome.tabs.sendMessage
// Path: /root/bom-to-cart-extension/lib/adapters/temu.js

import { SiteAdapter } from '/lib/site-adapter.js';

export class TemuAdapter extends SiteAdapter {
  get name() { return 'Temu'; }
  get requiresLogin() { return false; }
  get matchPatterns() { return ['https://www.temu.com/*']; }

  constructor(tabId) {
    super();
    this.tabId = tabId;
  }

  /** Send a message to the content script in the target tab.
   *  Retries if content script hasn't loaded yet (after page navigation). */
  async _send(action, payload = {}, retries = 15) {
    for (let i = 0; i <= retries; i++) {
      try {
        const resp = await new Promise((resolve, reject) => {
          chrome.tabs.sendMessage(this.tabId, { action, payload }, (r) => {
            if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
            else resolve(r);
          });
        });
        if (resp && resp.error) throw new Error(resp.error);
        return resp;
      } catch (err) {
        const msg = err.message || '';
        if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection') || msg.includes('message port closed')) {
          if (i === retries) throw err;
          await new Promise(r => setTimeout(r, 2000));
        } else {
          throw err;
        }
      }
    }
  }

  /** Wait for the tab to fully load and content script to be injected.
   *  Detects CAPTCHA redirect early to avoid unnecessary timeout. */
  async _waitForTab() {
    for (let i = 0; i < 20; i++) {
      try {
        const tab = await chrome.tabs.get(this.tabId);
        if (!tab) throw new Error('Tab not found');

        // Early detection: CAPTCHA redirect — return immediately so search-loop can handle it
        const url = tab.url || '';
        if (url.includes('bgn_verification.html')) {
          console.log('[TemuAdapter] CAPTCHA redirect detected, returning early');
          return;
        }

        if (tab.status === 'complete') {
          const snap = await this._send('temu:getPageSnapshot', {}, 3);
          if (snap && snap.url) return;
        }
      } catch (err) {
        // Content script may not be ready yet — keep waiting
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Tab did not become ready after 20s');
  }

  // ── Search primitives ─────────────────────────────────────

  async search(query) {
    try {
      return await this._send('temu:search', { query }, 3);
    } catch {
      // Page reloaded (content script unloaded) — wait for new page to settle
      // Subsequent detectCaptcha/getSearchResults will use their own _send retries
      await new Promise(r => setTimeout(r, 5000));
      return { action: 'search', query };
    }
  }

  async getSearchResults() {
    return this._send('temu:getSearchResults');
  }

  async detectCaptcha() {
    return this._send('temu:detectCaptcha');
  }

  async getPageSnapshot() {
    return this._send('temu:getPageSnapshot');
  }

  // Temu doesn't have a "Show All" button (infinite scroll instead)
  async showAll() {
    return { clicked: false, reason: 'Temu uses infinite scroll, not Show All' };
  }
}