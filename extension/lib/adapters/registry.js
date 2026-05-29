// Adapter Registry — maps site IDs to Adapter classes
// Path: /root/bom-to-cart-extension/lib/adapters/registry.js

import { OctopartAdapter } from '/lib/adapters/octopart.js';
import { TemuAdapter } from '/lib/adapters/temu.js';

const _adapters = {
  octopart: OctopartAdapter,
  temu: TemuAdapter,
};

/** Get an adapter instance for the given site and tab. */
export function getAdapter(siteId, tabId) {
  const AdapterClass = _adapters[siteId];
  if (!AdapterClass) throw new Error(`Unknown site: ${siteId}`);
  return new AdapterClass(tabId);
}

/** List all registered adapters (for popup dropdown). */
export function listAdapters() {
  const proto = (Cls) => new Cls(-1); // dummy tabId
  return Object.entries(_adapters).map(([id, Cls]) => {
    const p = proto(Cls);
    return {
      id,
      name: p.name,
      requiresLogin: p.requiresLogin,
      matchPatterns: p.matchPatterns
    };
  });
}

/**
 * Find which adapter supports a given URL.
 * @returns {string|null} siteId or null
 */
export function findAdapterForUrl(url) {
  for (const [id, Cls] of Object.entries(_adapters)) {
    const p = new Cls(-1);
    for (const pattern of p.matchPatterns) {
      if (urlMatch(pattern, url)) return id;
    }
  }
  return null;
}

function urlMatch(pattern, url) {
  // Simple glob match: https://octopart.com/* → matches https://octopart.com/...
  const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return re.test(url);
}