// BOM Store — chrome.storage.local wrapper for BOM CRUD
// Path: /root/bom-to-cart-extension/lib/bom-store.js

const BOM_STORE_KEY = 'bom-data';

// Naive UUID v4 generator (no crypto dependency)
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

export const BOMStore = {
  /** Load current BOM from storage. Returns null if none exists. */
  async load() {
    const result = await chrome.storage.local.get(BOM_STORE_KEY);
    return result[BOM_STORE_KEY] || null;
  },

  /** Save (replace) entire BOM. Automatically stamps updated_at. */
  async save(bom) {
    bom.updated_at = new Date().toISOString();
    if (!bom.created_at) bom.created_at = bom.updated_at;
    if (!bom.version) bom.version = '1.0';
    if (bom.shipping_per_platform === undefined) bom.shipping_per_platform = 10.0;
    await chrome.storage.local.set({ [BOM_STORE_KEY]: bom });
    return bom;
  },

  /** Create a fresh empty BOM. */
  async createNew() {
    const bom = {
      version: '1.0',
      parts: [],
      shipping_per_platform: 10.0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await this.save(bom);
    return bom;
  },

  /** Add a part to the BOM. Returns the created part. */
  async addPart(partData) {
    const bom = (await this.load()) || (await this.createNew());
    const part = {
      id: uuid(),
      name: partData.name || '',
      quantity: partData.quantity || 1,
      specs: partData.specs || {},
      notes: partData.notes || '',
      status: partData.status || 'pending',
      prices: partData.prices || {},
      octopart_url: partData.octopart_url || null,
      selected_platform: partData.selected_platform || null
    };
    bom.parts.push(part);
    await this.save(bom);
    return part;
  },

  /** Update specific fields of a part by id. */
  async updatePart(id, changes) {
    const bom = await this.load();
    if (!bom) throw new Error('No BOM loaded');
    const idx = bom.parts.findIndex(p => p.id === id);
    if (idx === -1) throw new Error(`Part ${id} not found`);
    Object.assign(bom.parts[idx], changes);
    await this.save(bom);
    return bom.parts[idx];
  },

  /** Remove a part by id. */
  async removePart(id) {
    const bom = await this.load();
    if (!bom) throw new Error('No BOM loaded');
    bom.parts = bom.parts.filter(p => p.id !== id);
    await this.save(bom);
  },

  /** Delete a specific distributor price from a part. */
  async deletePrice(partId, distributor) {
    const bom = await this.load();
    if (!bom) throw new Error('No BOM loaded');
    const part = bom.parts.find(p => p.id === partId);
    if (!part) throw new Error(`Part ${partId} not found`);
    if (part.prices && part.prices[distributor] !== undefined) {
      delete part.prices[distributor];
    }
    await this.save(bom);
    return part;
  },

  /** Replace entire parts array. Used after agent returns parsed BOM. */
  async replaceParts(parts) {
    const bom = (await this.load()) || (await this.createNew());
    bom.parts = parts.map(p => ({
      id: p.id || uuid(),
      name: p.name || '',
      quantity: p.quantity || 1,
      specs: p.specs || {},
      notes: p.notes || '',
      status: p.status || 'pending',
      prices: p.prices || {},
      octopart_url: p.octopart_url || null,
      selected_platform: p.selected_platform || null
    }));
    await this.save(bom);
    return bom;
  },

  /** Bulk-set status for all parts (debug/util). Resets prices+url when setting to pending. */
  async bulkSetStatus(status) {
    const bom = await this.load();
    if (!bom) return 0;
    let count = 0;
    for (const p of bom.parts) {
      if (p.status !== status || (status === 'pending' && (Object.keys(p.prices || {}).length > 0 || p.octopart_url))) {
        p.status = status;
        if (status === 'pending') { p.prices = {}; p.octopart_url = null; }
        count++;
      }
    }
    if (count > 0) await this.save(bom);
    return count;
  },
  async stats() {
    const bom = await this.load();
    if (!bom || !bom.parts.length) return { total: 0, priced: 0, pending: 0, not_found: 0 };
    return {
      total: bom.parts.length,
      priced: bom.parts.filter(p => p.status === 'priced').length,
      pending: bom.parts.filter(p => p.status === 'pending').length,
      searching: bom.parts.filter(p => p.status === 'searching').length,
      not_found: bom.parts.filter(p => p.status === 'not_found').length,
      skipped: bom.parts.filter(p => p.status === 'skipped').length
    };
  },

  /** Clear all BOM data */
  async clear() {
    await chrome.storage.local.remove(BOM_STORE_KEY);
  }
};
