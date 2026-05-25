// Site Adapter — base class for shopping site integrations
// Each supported site (Octopart, Amazon, AliExpress, etc.) extends this.
// Path: /root/bom-to-cart-extension/lib/site-adapter.js

export class SiteAdapter {
  /** Human-readable site name (e.g. "Octopart") */
  get name() { return 'base'; }

  /** Whether user must be logged into the site before searching */
  get requiresLogin() { return false; }

  /** Match patterns for content script injection */
  get matchPatterns() { return []; }

  // ── Login ─────────────────────────────────────────────────

  /** Check if user is logged into this site.
   *  @returns {{ loggedIn: boolean, username?: string }} */
  async loginDetect() {
    return { loggedIn: !this.requiresLogin };
  }

  // ── Search Primitives (each site implements) ─────────────

  /** Navigate to search page / execute search for the given query.
   *  @param {string} query
   *  @returns {{ action: string, url: string }} */
  async search(query) {
    throw new Error(`${this.name}: search() not implemented`);
  }

  /** Get search results from the current search page.
   *  @returns {{ results: Array<{href: string, title: string, subtitle?: string}>, total: number }} */
  async getSearchResults() {
    throw new Error(`${this.name}: getSearchResults() not implemented`);
  }

  /** Navigate to a product detail page.
   *  @param {string} url */
  async navigateToPart(url) {
    throw new Error(`${this.name}: navigateToPart() not implemented`);
  }

  /** Extract pricing from the current product detail page.
   *  @returns {{ suppliers: Array<{distributor: string, unit_price: number}>, count: number, url: string }} */
  async getPricing() {
    throw new Error(`${this.name}: getPricing() not implemented`);
  }

  // ── Page Inspection ──────────────────────────────────────

  /** Detect if a CAPTCHA / security challenge is present.
   *  @returns {{ captcha: boolean, indicators: string[], url: string }} */
  async detectCaptcha() {
    return { captcha: false, indicators: [], url: window.location.href };
  }

  /** Get a text snapshot of the current page (for Agent diagnostics).
   *  @returns {{ url: string, title: string, bodyPreview: string, readyState: string }} */
  async getPageSnapshot() {
    throw new Error(`${this.name}: getPageSnapshot() not implemented`);
  }

  /** Wait for the page to be fully interactive.
   *  @param {number} timeout ms
   *  @returns {{ ready: boolean, url: string }} */
  async waitForReady(timeout = 10000) {
    throw new Error(`${this.name}: waitForReady() not implemented`);
  }

  /** Click "show all" / "load more" button if present.
   *  @returns {{ clicked: boolean, reason?: string }} */
  async showAll() {
    return { clicked: false, reason: 'not supported' };
  }
}