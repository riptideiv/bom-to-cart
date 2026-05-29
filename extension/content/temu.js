// Temu Content Script — handles search, extraction, and CAPTCHA detection
// Injected into https://www.temu.com/* by manifest.json
// Path: /root/bom-to-cart-extension/content/temu.js

(() => {
  const TEMU_ORIGIN = 'https://www.temu.com';
  const SEARCH_URL = `${TEMU_ORIGIN}/search_result.html`;

  // ── Message Listener ──────────────────────────────────────
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    const { action, payload } = msg || {};

    switch (action) {
      case 'temu:search':
        doSearch(payload?.query).then(sendResponse, err => sendResponse({ error: err.message }));
        return true; // async

      case 'temu:getSearchResults':
        getSearchResults().then(sendResponse, err => sendResponse({ error: err.message }));
        return true;

      case 'temu:detectCaptcha':
        detectCaptcha().then(sendResponse);
        return true;

      case 'temu:getPageSnapshot':
        getPageSnapshot().then(sendResponse);
        return true;
    }
  });

  // ── Search ────────────────────────────────────────────────
  async function doSearch(query) {
    // Wait for the search input to be available
    let input;
    try {
      input = await waitFor('#searchInput', 10000);
    } catch {
      // If search input isn't visible (e.g., on homepage with different layout),
      // fall back to URL navigation
      window.location.href = `https://www.temu.com/search_result.html?search_key=${encodeURIComponent(query)}`;
      return { action: 'navigate', query };
    }

    // Focus and clear the search input
    input.focus();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await sleep(500);

    // Type the query
    input.value = query;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    await sleep(500);

    // Save current URL to verify navigation happened
    const beforeUrl = window.location.href;

    // Press Enter — full keydown/keypress/keyup sequence
    const enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
    input.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
    input.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
    input.dispatchEvent(new KeyboardEvent('keyup', enterOpts));

    // Fallback: submit enclosing form
    const form = input.closest('form');
    if (form) {
      try { form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); } catch {}
    }

    // Wait for results to appear (up to 15s).
    // Temu is a SPA — no full page reload, results render dynamically.
    const start = Date.now();
    while (Date.now() - start < 15000) {
      // Check for CAPTCHA redirect
      if (window.location.href.includes('bgn_verification.html')) {
        return { action: 'search', query, captcha: true };
      }
      // Check for search result cards
      const card = document.querySelector('[role="group"]');
      if (card) {
        return { action: 'search', query };
      }
      await sleep(500);
    }

    // Timeout: check if navigation happened at all
    if (window.location.href === beforeUrl && !document.querySelector('[role="group"]')) {
      return { error: `搜索未生效 — 页面没有变化 (Enter 可能未被处理)` };
    }

    return { action: 'search', query, timedOut: true };
  }

  // ── Extract Search Results ────────────────────────────────
  async function getSearchResults() {
    const results = [];
    const url = window.location.href;

    // Check for CAPTCHA first
    if (url.includes('bgn_verification.html')) {
      return { url, results, total: 0, captcha: true };
    }

    // Wait for product cards to render
    try {
      await waitFor('[role="group"]', 10000);
    } catch {
      // No results? Return empty
      return { url, results, total: 0 };
    }

    // Allow lazy images to load
    await sleep(1500);

    // Extract from product cards
    const cards = document.querySelectorAll('[role="group"]');
    for (const card of cards) {
      try {
        // Product link: feature /g-<id>.html
        const link = card.querySelector('a[href*="-g-"][href$=".html"]');
        if (!link) continue;
        const href = link.getAttribute('href');
        if (!href) continue;

        // Full URL
        const fullHref = href.startsWith('http') ? href : TEMU_ORIGIN + href;

        // Product name — from the goodName annotation or link text
        let name = '';
        const nameContainer = card.querySelector('[data-tooltip^="goodName-"]');
        if (nameContainer) {
          name = nameContainer.textContent?.trim() || '';
        } else {
          name = link.textContent?.trim() || '';
        }
        // Clean: Temu titles append "在新标签页中打开。" — strip it
        name = name.replace(/\s*在新标签页中打开。\s*$/, '').substring(0, 200);

        // Price — use the _2XgTiMJi span (avoids aria-hidden duplicate content in [data-type="price"])
        let price = null;
        const priceContainer = card.querySelector('[data-type="price"]');
        if (priceContainer) {
          const priceSpan = priceContainer.querySelector('._2XgTiMJi');
          const priceText = (priceSpan || priceContainer).textContent?.trim() || '';
          const match = priceText.match(/\$?([\d,]+\.?\d*)/);
          if (match) price = parseFloat(match[1].replace(/,/g, ''));
        }

        // Sales
        let sales = '';
        const salesEl = card.querySelector('[data-type="saleTips"]');
        if (salesEl) {
          sales = salesEl.textContent?.trim() || '';
        }

        // Market / original price
        let marketPrice = null;
        const marketEl = card.querySelector('[data-type="marketPrice"]');
        if (marketEl) {
          const marketText = marketEl.textContent?.trim() || '';
          const match = marketText.match(/\$?([\d,]+\.?\d*)/);
          if (match) marketPrice = parseFloat(match[1].replace(/,/g, ''));
        }

        // Build specs string from the title (Temu titles are descriptive)
        const specs = name;

        // Pricing: Temu has a single seller (itself), so one price entry
        const pricing = [];
        if (price !== null && !isNaN(price)) {
          pricing.push({
            distributor: 'Temu',
            unit_price: price,
            market_price: marketPrice,
            sales,
          });
        }

        results.push({
          href: fullHref,
          name,
          specs,
          pricing,
        });

      } catch (e) {
        // Skip malformed cards
        continue;
      }
    }

    return { url, results, total: results.length };
  }

  // ── CAPTCHA Detection ─────────────────────────────────────
  function detectCaptcha() {
    const url = window.location.href;
    const isCaptcha = url.includes('bgn_verification.html');
    return {
      captcha: isCaptcha,
      indicators: isCaptcha ? ['Redirected to bgn_verification.html'] : [],
      url,
    };
  }

  // ── Page Snapshot ─────────────────────────────────────────
  function getPageSnapshot() {
    const bodyText = document.body?.textContent || '';
    return {
      url: window.location.href,
      title: document.title,
      bodyPreview: bodyText.substring(0, 500),
      readyState: document.readyState,
    };
  }

  // ── Helpers ────────────────────────────────────────────────
  async function waitFor(selector, timeout = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const el = document.querySelector(selector);
      if (el) return el;
      await sleep(500);
    }
    throw new Error(`Timeout waiting for "${selector}" on ${window.location.href}`);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
})();
