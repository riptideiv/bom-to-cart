// Octopart Content Script (IIFE)
// Search page extraction + CAPTCHA watcher for octopart.com
// Extracts pricing directly from search results — no detail page navigation needed.
// Path: /root/bom-to-cart-extension/content/octopart.js

(() => {
  'use strict';

  // ── CAPTCHA Watcher ───────────────────────────────────────
  const pageAdapter = {
    name: 'octopart',
    async detectCaptcha() {
      const body = document.body;
      if (!body) return { captcha: false, indicators: [], url: window.location.href };
      const clone = body.cloneNode(true);
      clone.querySelectorAll('script, style, noscript, [aria-hidden="true"], .hidden').forEach(el => el.remove());
      const pageText = clone.textContent?.toLowerCase() || '';
      const indicators = [
        'one more step', 'security check', 'complete the security',
        'press & hold', 'verify you are human', 'please verify you are human', 'captcha'
      ];
      const found = indicators.filter(ind => pageText.includes(ind));
      return { captcha: found.length > 0, indicators: found, url: window.location.href };
    }
  };

  const captchaWatcher = new CaptchaWatcher(pageAdapter, {
    pollInterval: 2000,
    cooldown: 30000
  });

  captchaWatcher.onCaptcha((result) => {
    chrome.runtime.sendMessage({
      type: 'captcha:detected',
      payload: { indicators: result.indicators, url: result.url }
    }).catch(() => {});
  });

  captchaWatcher.start();

  // ── Message handler ────────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const { action, payload } = msg || {};
    if (!action || !action.startsWith('octopart:')) return;

    const op = action.replace('octopart:', '');
    const handlers = {
      search: doSearch,
      getSearchResults: getSearchResults,
      detectCaptcha: () => pageAdapter.detectCaptcha(),
      getPageSnapshot: getPageSnapshot
    };

    const fn = handlers[op];
    if (fn) {
      fn(payload).then(sendResponse, e => sendResponse({ error: e.message }));
      return true;
    }
  });

  // ── Operations ─────────────────────────────────────────────

  async function doSearch({ query, currency = 'USD' }) {
    const url = `https://octopart.com/search?q=${encodeURIComponent(query)}&currency=${currency}&specs=0`;
    window.location.href = url;
    return { action: 'navigated', url };
  }

  async function getSearchResults() {
    // Wait for result cards to appear
    try {
      await waitForSelector('[data-testid="part-header"]', 8000);
    } catch {
      return { url: window.location.href, results: [], total: 0 };
    }

    const results = [];
    const headers = document.querySelectorAll('[data-testid="part-header"]');

    for (const header of headers) {
      const link = header.querySelector('a[href*="/part/"]');
      const href = link?.getAttribute('href') || '';
      const name = header.textContent?.trim()?.substring(0, 120) || '';

      // Extract specs from the div containing <em> (inside part-header)
      let specs = '';
      const divs = header.querySelectorAll('div');
      for (const div of divs) {
        if (div.querySelector('em')) {
          specs = div.textContent.trim().substring(0, 400);
          break;
        }
      }

      // Container: [0]=header, [1]=pricing-table, [2]=toolbar (with "Show All" button)
      const container = header.parentElement;
      const pricingTable = container?.children[1];
      const toolbar = container?.children[2];

      // Click "Show All" to expand pricing before extraction
      if (toolbar) {
        const showAllBtn = toolbar.querySelector('[data-testid="show-all-button"]');
        if (showAllBtn) {
          showAllBtn.click();
          await sleep(2000); // wait for rows to load
        }
      }

      // Extract pricing rows
      const pricing = [];
      if (pricingTable) {
        const offerRows = pricingTable.querySelectorAll('[data-testid="offer-row"]');
        for (const row of offerRows) {
          const distEl = row.querySelector('[class*="__distributor"]');
          const distributor = distEl?.textContent?.trim();
          if (!distributor) continue;

          // Price: cells between __bulkPricing and __updated (first = qty 1)
          const bulkEl = row.querySelector('[class*="__bulkPricing"]');
          if (!bulkEl) continue;

          let unitPrice = null;
          let sibling = bulkEl.nextElementSibling;
          while (sibling) {
            if ((sibling.className || '').includes('__updated')) break;
            const txt = sibling.textContent?.trim();
            if (txt && !isNaN(parseFloat(txt))) {
              unitPrice = parseFloat(txt);
              break;
            }
            sibling = sibling.nextElementSibling;
          }

          if (unitPrice !== null && !isNaN(unitPrice)) {
            const stockEl = row.querySelector('[class*="__stock"]');
            const moqEl = row.querySelector('[class*="__moq"]');
            pricing.push({
              distributor,
              unit_price: unitPrice,
              stock: stockEl?.textContent?.trim() || '',
              moq: moqEl?.textContent?.trim() || '1'
            });
          }
        }
      }

      results.push({ href, name, specs, pricing });
    }

    return { url: window.location.href, results, total: results.length };
  }

  async function getPageSnapshot() {
    return {
      url: window.location.href,
      title: document.title,
      bodyPreview: (document.body?.textContent || '').trim().substring(0, 500),
      readyState: document.readyState
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  async function waitForSelector(selector, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(300);
    }
    throw new Error(`Timeout waiting for "${selector}" on ${window.location.href}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
