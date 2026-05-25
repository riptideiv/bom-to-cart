// Octopart Adapter — SiteAdapter implementation for octopart.com
// Bridges SearchLoop ↔ content/octopart.js primitives via chrome.tabs.sendMessage
// All pricing is extracted from search results page — no detail page navigation.
// Path: /root/bom-to-cart-extension/lib/adapters/octopart.js

import { SiteAdapter } from '/lib/site-adapter.js';

export class OctopartAdapter extends SiteAdapter {
  get name() { return 'Octopart'; }
  get requiresLogin() { return false; }
  get matchPatterns() { return ['https://octopart.com/*']; }

  constructor(tabId) {
    super();
    this.tabId = tabId;
  }

  /** Send a message to the content script in the target tab.
   *  Retries if content script hasn't loaded yet (after page navigation).
   *  Throws on both connection errors AND content-script-reported errors. */
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
          await new Promise(r => setTimeout(r, 1500));
        } else {
          throw err;
        }
      }
    }
  }

  /** Wait for the tab to fully load (content script injected). Call after navigation. */
  async _waitForTab() {
    for (let i = 0; i < 20; i++) {
      try {
        const tab = await chrome.tabs.get(this.tabId);
        if (!tab) throw new Error('Tab not found');
        if (tab.status === 'complete') {
          const snap = await this._send('octopart:getPageSnapshot', {}, 3);
          if (snap && snap.url) return;
        }
      } catch (err) {
        // Keep waiting
      }
      await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('Tab did not become ready after 20s');
  }

  async search(query) {
    const result = await this._send('octopart:search', { query }, 5);
    await this._waitForTab();
    return result;
  }

  async getSearchResults() {
    return this._send('octopart:getSearchResults');
  }

  async detectCaptcha() {
    return this._send('octopart:detectCaptcha');
  }

  async getPageSnapshot() {
    return this._send('octopart:getPageSnapshot');
  }
}
