// CaptchaWatcher — independent async CAPTCHA monitor (IIFE, no module)
// Runs in content script context. Uses MutationObserver + periodic polling.
// Path: /root/bom-to-cart-extension/content/captcha-watcher.js

(() => {
  'use strict';

  window.CaptchaWatcher = class CaptchaWatcher {
    /**
     * @param {object} adapter - must have detectCaptcha() → { captcha, indicators, url }
     * @param {object} config
     */
    constructor(adapter, config = {}) {
      this.adapter = adapter;
      this.pollInterval = config.pollInterval || 2000;
      this.mutationDebounce = config.mutationDebounce || 500;
      this.cooldown = config.cooldown || 30000;

      this._running = false;
      this._checking = false;
      this._pollTimer = null;
      this._debounceTimer = null;
      this._observer = null;
      this._onCaptcha = null;
      this._lastCaptchaTime = 0;
    }

    start() {
      if (this._running) return;
      this._running = true;
      this._pollTimer = setInterval(() => this._check(), this.pollInterval);
      try {
        if (document.body) {
          this._observer = new MutationObserver(() => this._debouncedCheck());
          this._observer.observe(document.body, { childList: true, subtree: true });
        }
      } catch {}
      this._check();
    }

    stop() {
      this._running = false;
      if (this._pollTimer) { clearInterval(this._pollTimer); this._pollTimer = null; }
      if (this._debounceTimer) { clearTimeout(this._debounceTimer); this._debounceTimer = null; }
      if (this._observer) { this._observer.disconnect(); this._observer = null; }
    }

    onCaptcha(callback) { this._onCaptcha = callback; }

    async _check() {
      if (this._checking || !this._running) return;
      this._checking = true;
      try {
        if (!this._observer && document.body) {
          this._observer = new MutationObserver(() => this._debouncedCheck());
          this._observer.observe(document.body, { childList: true, subtree: true });
        }
        const result = await this.adapter.detectCaptcha();
        if (result.captcha && this._onCaptcha) {
          const now = Date.now();
          if (now - this._lastCaptchaTime > this.cooldown) {
            this._lastCaptchaTime = now;
            this._onCaptcha(result);
          }
        }
      } catch {}
      finally { this._checking = false; }
    }

    _debouncedCheck() {
      if (!this._running) return;
      clearTimeout(this._debounceTimer);
      this._debounceTimer = setTimeout(() => this._check(), this.mutationDebounce);
    }
  };
})();