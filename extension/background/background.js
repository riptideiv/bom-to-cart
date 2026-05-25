// Background Service Worker (ES module)
// Routes messages between popup, content scripts, and Agent.
// Path: /root/bom-to-cart-extension/background/background.js

import { BOMStore } from '/lib/bom-store.js';
import { Agent } from '/lib/agent.js';
import { SearchLoop } from '/background/search-loop.js';
import { getAdapter } from '/lib/adapters/registry.js';

// ── Search Loop State ──────────────────────────────────────
let currentLoop = null;

// ── Message Router ──────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const { type, payload } = msg || {};

  // Wrap handlers to catch and log errors
  const safeHandler = (handlerFn) => {
    handlerFn().then(sendResponse, err => {
      console.error(`[BOM-to-Cart] Handler ${type} error:`, err);
      sendResponse({ error: err.message });
    });
  };

  switch (type) {
    // Agent calls
    case 'agent:parse-bom':
      safeHandler(() => handleParseBOM(payload));
      return true; // async

    case 'agent:clarify':
      safeHandler(() => handleClarify(payload));
      return true;

    case 'agent:handle-exception':
      safeHandler(() => handleException(payload));
      return true;

    // BOM CRUD (delegated to BOMStore)
    case 'bom:load':
      safeHandler(() => BOMStore.load());
      return true;

    case 'bom:save':
      safeHandler(() => BOMStore.save(payload));
      return true;

    case 'bom:add-part':
      safeHandler(() => BOMStore.addPart(payload));
      return true;

    case 'bom:update-part':
      safeHandler(() => BOMStore.updatePart(payload.id, payload.changes));
      return true;

    case 'bom:remove-part':
      safeHandler(() => BOMStore.removePart(payload));
      return true;

    case 'bom:replace-parts':
      safeHandler(() => BOMStore.replaceParts(payload));
      return true;

    case 'bom:stats':
      safeHandler(() => BOMStore.stats());
      return true;

    // ── BOM Manager (multi-BOM) ─────────────────────────────
    case 'bom:list':
      safeHandler(handleBOMList);
      return true;

    case 'bom:switch':
      safeHandler(() => handleBOMSwitch(payload));
      return true;

    case 'bom:new':
      safeHandler(() => handleBOMNew(payload));
      return true;

    case 'bom:save-as':
      safeHandler(() => handleBOMSaveAs(payload));
      return true;

    case 'bom:delete-bom':
      safeHandler(() => handleBOMDelete(payload));
      return true;

    // Bulk status (debug)
    case 'bom:bulk-status':
      safeHandler(() => BOMStore.bulkSetStatus(payload.status));
      return true;

    // Agent config
    case 'agent:get-config':
      safeHandler(() => Agent.getConfig());
      return true;

    case 'agent:set-config':
      safeHandler(() => Agent.setConfig(payload));
      return true;

    case 'agent:is-configured':
      safeHandler(() => Agent.isConfigured());
      return true;

    case 'agent:call':
      safeHandler(() => Agent.call(payload));
      return true;

    // ── Search Loop Control ──────────────────────────────────
    case 'search:start':
      safeHandler(() => handleSearchStart(payload, sender));
      return true;

    case 'search:pause':
      currentLoop?.pause();
      sendResponse({ ok: true });
      return false;

    case 'search:stop':
      currentLoop?.stop();
      currentLoop = null;
      sendResponse({ ok: true });
      return false;

    case 'search:resume':
      currentLoop?.resume();
      sendResponse({ ok: true });
      return false;

    case 'search:status':
      sendResponse(currentLoop ? currentLoop.getStatus() : { state: 'idle' });
      return false;

    case 'captcha:detected':
      handleCaptchaDetected(payload, sender);
      sendResponse({ ok: true });
      return false;

    default:
      sendResponse({ error: `Unknown message type: ${type}` });
      return false;
  }
});

// ── Agent Handlers ──────────────────────────────────────────

const BOM_PARSE_SYSTEM = `You are a purchasing assistant that parses Bills of Materials into structured JSON.

Given a user's BOM in any format (markdown table, CSV, plain text, bullet list), extract each distinct part and return a JSON object matching this schema:

{
  "version": "1.0",
  "parts": [
    {
      "id": "uuid-string",
      "name": "Part name with key specs",
      "quantity": integer,
      "specs": {"key": "value"},
      "notes": "any clarifications needed or empty string",
      "status": "pending",
      "prices": {}
    }
  ]
}

Rules:
- Each part.id must be a unique UUID v4.
- Include key specifications in the name (e.g., "M3 hex standoff, 20mm, brass").
- Put additional specs in the specs object.
- Set notes to "" if no clarification needed. If a part is ambiguous (missing size/length/material etc.), note the ambiguity in "notes" and make your best guess for the specs.
- quantity must be a positive integer. Default to 1 if not specified.
- DO NOT include markdown code fences. Output raw JSON only.
- If the BOM is empty or unparseable, return {"version":"1.0","parts":[]}.`;

async function handleParseBOM({ bomText }) {
  const result = await Agent.call({
    systemPrompt: BOM_PARSE_SYSTEM,
    userMessage: `Parse this BOM into structured JSON:\n\n${bomText}`,
    jsonMode: true,
    temperature: 0.05
  });

  let parsed;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    const match = result.content.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (match) {
      parsed = JSON.parse(match[1]);
    } else {
      throw new Error('Agent returned invalid JSON');
    }
  }

  parsed.parts = (parsed.parts || []).map(p => ({
    id: p.id || uuid(),
    name: p.name || 'Unknown Part',
    quantity: Math.max(1, parseInt(p.quantity) || 1),
    specs: p.specs || {},
    notes: p.notes || '',
    status: 'pending',
    prices: {},
    octopart_url: null,
    selected_platform: null
  }));

  parsed.version = '1.0';
  return { bom: parsed, rawResponse: result };
}

function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

async function handleClarify({ bom, question }) {
  const result = await Agent.call({
    systemPrompt: BOM_PARSE_SYSTEM,
    userMessage: `Previous BOM parsing result:\n${JSON.stringify(bom, null, 2)}\n\nUser clarification: ${question}\n\nReturn updated parts array only (as JSON array, no wrapper).`,
    jsonMode: true,
    temperature: 0.1
  });
  return { clarification: result.content };
}

const EXCEPTION_SYSTEM = `You are a browser automation debugger. You are helping a Chrome extension that is trying to search for electronic parts on a shopping website (like Octopart). The automation hit an unexpected state.

Given:
- The current step it was trying to perform
- A description of what went wrong
- The current page URL

Respond with ONE of these actions as JSON:
{"action": "retry", "reason": "..."} — try the same step again
{"action": "skip", "reason": "..."} — skip this part, mark as not_found
{"action": "wait", "seconds": N, "reason": "..."} — wait N seconds then retry
{"action": "captcha", "reason": "..."} — a CAPTCHA is blocking, needs user
{"action": "navigate", "url": "...", "reason": "..."} — navigate to a different URL
{"action": "abort", "reason": "..."} — unrecoverable, stop the search loop

Be decisive. Prefer retry for transient issues (slow page load, popup). Prefer captcha when you see "security check", "CAPTCHA", "verify you're human".`;

async function handleException({ step, error, url, pageInfo }) {
  const result = await Agent.call({
    systemPrompt: EXCEPTION_SYSTEM,
    userMessage: [
      `Step being attempted: ${step}`,
      `Error/Issue: ${error}`,
      `Current URL: ${url}`,
      `Additional page info: ${pageInfo || 'none'}`
    ].join('\n'),
    jsonMode: true,
    temperature: 0.2
  });

  try {
    return { action: JSON.parse(result.content), rawResponse: result };
  } catch {
    return { action: { action: 'abort', reason: 'Could not parse agent response' }, rawResponse: result };
  }
}

// ── Search Loop Handlers ───────────────────────────────────

async function handleSearchStart({ site }, sender) {
  if (currentLoop && currentLoop.getStatus().state !== 'done') {
    throw new Error('Search loop already running. Stop it first.');
  }

  if (!site) throw new Error('No site specified');

  // Get the active tab for the target site
  let tabId = sender.tab?.id;
  if (!tabId) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) tabId = tab.id;
  }
  if (!tabId) throw new Error('No active tab found');

  // Check if the tab is on a supported site
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url || '';

  // Navigate to Octopart if not already there (for non-login-required sites)
  // For login-required sites, this would check loginDetect() instead
  const adapter = getAdapter(site, tabId);
  if (adapter.requiresLogin) {
    const loginStatus = await adapter.loginDetect().catch(() => ({ loggedIn: false }));
    if (!loginStatus.loggedIn) {
      throw new Error(`Please log into ${adapter.name} first, then try again.`);
    }
  }

  // Ensure we're on the right site
  if (!url.includes('octopart.com') && site === 'octopart') {
    await chrome.tabs.update(tabId, { url: 'https://octopart.com' });
    await new Promise(r => setTimeout(r, 2000));
  }

  currentLoop = new SearchLoop(adapter, {
    stepDelay: 3000,
    maxRetries: 2,
    onAgentException: (payload) => handleException(payload)
  });

  // Wire callbacks
  currentLoop.onLog((entry) => {
    // Push log to any open popup
    chrome.runtime.sendMessage({ type: 'search:log', data: entry }).catch(() => {});
  });

  currentLoop.onStateChange((status) => {
    chrome.runtime.sendMessage({ type: 'search:state-change', data: status }).catch(() => {});
  });

  currentLoop.onCaptcha(() => {
    chrome.runtime.sendMessage({ type: 'search:captcha', data: {} }).catch(() => {});
    // System notification — visible even when popup is closed
    try {
      chrome.notifications.create('captcha-' + Date.now(), {
        type: 'basic',
        iconUrl: '/icons/icon-48.png',
        title: 'BOM-to-Cart — CAPTCHA',
        message: `${adapter.name} 需要人机验证，请打开页面完成验证后在搜索控制台点"继续"。`,
        priority: 2
      });
    } catch {}
  });

  // Fire and forget — search runs independently
  currentLoop.start().catch(err => {
    console.error('[SearchLoop] Fatal error:', err);
    chrome.runtime.sendMessage({ type: 'search:state-change', data: { state: 'done', error: err.message } }).catch(() => {});
  });

  return { ok: true, message: `Search started on ${adapter.name}` };
}

function handleCaptchaDetected(payload, sender) {
  if (!currentLoop) return;

  console.log('[BOM-to-Cart] CAPTCHA detected from content script:', payload);

  // Notify popup
  chrome.runtime.sendMessage({
    type: 'search:captcha',
    data: { indicators: payload.indicators, url: payload.url }
  }).catch(() => {});

// System notification
  try {
    chrome.notifications.create('captcha-' + Date.now(), {
      type: 'basic',
      iconUrl: '/icons/icon-48.png',
      title: 'BOM-to-Cart — CAPTCHA',
      message: '人机验证已触发，请在页面完成验证后在搜索控制台点击"继续"。',
      priority: 2
    });
  } catch {}

  // Pause the search loop — it will wait
  currentLoop.pause();
}

console.log('[BOM-to-Cart] Background SW ready');

// ── BOM Manager Handlers ───────────────────────────────────

const BOM_LIST_KEY = 'bom-list';
const BOM_ACTIVE_KEY = 'bom-active-id';

async function getBOMList() {
  const r = await chrome.storage.local.get(BOM_LIST_KEY);
  return r[BOM_LIST_KEY] || [];
}

async function saveBOMList(list) {
  await chrome.storage.local.set({ [BOM_LIST_KEY]: list });
}

async function getActiveBOMId() {
  const r = await chrome.storage.local.get(BOM_ACTIVE_KEY);
  return r[BOM_ACTIVE_KEY] || null;
}

async function setActiveBOMId(id) {
  await chrome.storage.local.set({ [BOM_ACTIVE_KEY]: id });
}

/** Migrate: if bom-data exists with no bom-list, create default entry */
async function ensureBOMList() {
  const list = await getBOMList();
  if (list.length > 0) return list;

  const r = await chrome.storage.local.get('bom-data');
  if (r['bom-data'] && r['bom-data'].parts) {
    const id = uuid();
    const name = r['bom-data'].name || 'Default BOM';
    const entry = { id, name, updated_at: r['bom-data'].updated_at || new Date().toISOString() };
    await saveBOMList([entry]);
    await setActiveBOMId(id);
    return [entry];
  }
  return [];
}

async function handleBOMList() {
  const list = await ensureBOMList();
  const activeId = await getActiveBOMId();
  return { list, activeId };
}

async function handleBOMSwitch({ id }) {
  // Save current BOM to archive
  const activeId = await getActiveBOMId();
  if (activeId) {
    const r = await chrome.storage.local.get('bom-data');
    if (r['bom-data']) {
      await chrome.storage.local.set({ [`bom-data-${activeId}`]: r['bom-data'] });
    }
  }

  // Load target BOM
  const r = await chrome.storage.local.get(`bom-data-${id}`);
  if (!r[`bom-data-${id}`]) {
    // New empty BOM
    const bom = { version: '1.0', parts: [], name: '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    await chrome.storage.local.set({ 'bom-data': bom });
  } else {
    await chrome.storage.local.set({ 'bom-data': r[`bom-data-${id}`] });
  }
  await setActiveBOMId(id);

  // Update list timestamp
  const list = await getBOMList();
  const entry = list.find(e => e.id === id);
  if (entry) {
    entry.updated_at = new Date().toISOString();
    await saveBOMList(list);
  }

  return { ok: true, id };
}

async function handleBOMNew({ name }) {
  const id = uuid();
  const bomName = name || 'Untitled BOM';
  const entry = { id, name: bomName, updated_at: new Date().toISOString() };

  // Save current
  const activeId = await getActiveBOMId();
  if (activeId) {
    const r = await chrome.storage.local.get('bom-data');
    if (r['bom-data']) {
      await chrome.storage.local.set({ [`bom-data-${activeId}`]: r['bom-data'] });
    }
  }

  // Create new
  const bom = { version: '1.0', parts: [], name: bomName, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  await chrome.storage.local.set({ 'bom-data': bom });
  await setActiveBOMId(id);

  const list = await getBOMList();
  list.push(entry);
  await saveBOMList(list);

  return { ok: true, id, name: bomName };
}

async function handleBOMSaveAs({ name }) {
  const r = await chrome.storage.local.get('bom-data');
  if (!r['bom-data']) throw new Error('No active BOM');

  const id = uuid();
  const bomName = name || 'Untitled BOM';
  const entry = { id, name: bomName, updated_at: new Date().toISOString() };

  const bom = { ...r['bom-data'], name: bomName };
  await chrome.storage.local.set({ [`bom-data-${id}`]: bom, 'bom-data': bom });
  await setActiveBOMId(id);

  const list = await getBOMList();
  list.push(entry);
  await saveBOMList(list);

  return { ok: true, id, name: bomName };
}

async function handleBOMDelete({ id }) {
  // Remove from list
  let list = await getBOMList();
  list = list.filter(e => e.id !== id);
  await saveBOMList(list);

  // Remove data
  await chrome.storage.local.remove(`bom-data-${id}`);

  // If deleted active, switch to first remaining or create new
  const activeId = await getActiveBOMId();
  if (activeId === id) {
    if (list.length > 0) {
      return handleBOMSwitch({ id: list[0].id });
    } else {
      // No BOMs left, clear
      await chrome.storage.local.remove('bom-data');
      await setActiveBOMId(null);
      return { ok: true, cleared: true };
    }
  }

  return { ok: true };
}
self.addEventListener('error', (e) => {
  console.error('[BOM-to-Cart] SW unhandled error:', e.error || e.message);
});
self.addEventListener('unhandledrejection', (e) => {
  console.error('[BOM-to-Cart] SW unhandled rejection:', e.reason);
});
