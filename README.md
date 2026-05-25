# 🛒 BOM-to-Cart

> Chrome Extension — Parse any BOM, search real-time prices on Octopart, and find the cheapest purchasing plan. AI agent handles the thinking; the extension handles the clicking.

## What It Does

1. **Parse** — Paste your BOM in any format (markdown table, CSV, plain text). An AI agent extracts parts, quantities, and specs into a standardized table.
2. **Search** — Automated search loop extracts pricing directly from Octopart search results (no detail-page navigation). Auto-clicks "Show All" per result.
3. **Optimize** — Combinatorial optimization finds the **top 5 cheapest shopping plans**, balancing unit price vs per-platform shipping.

| Rank | Platforms | Parts Cost | Shipping | **Total** |
|------|-----------|-----------|----------|-----------|
| 1 | AliExpress | $16.24 | $10.00 | **$26.24** |
| 2 | AliExpress + DigiKey | $16.24 | $20.00 | $36.24 |
| 3 | DigiKey + Mouser | $20.56 | $20.00 | $40.56 |

## Architecture

```
┌──────────────────────────────────────────────┐
│  Chrome Extension (Popup Dashboard)          │
│  ┌─────────┐ ┌──────────┐ ┌───────────────┐ │
│  │ BOM 表  │ │ 最优方案  │ │ 搜索控制台     │ │
│  └────┬────┘ └────┬─────┘ └───────┬───────┘ │
│       └───────────┼───────────────┘          │
│                   │ chrome.runtime           │
│            ┌──────▼──────┐                   │
│            │  Background │                   │
│            │ Service Wkr │──► OpenRouter API │
│            └──────┬──────┘    (AI Agent)     │
│                   │                          │
│            ┌──────▼──────┐                   │
│            │   Content   │                   │
│            │   Scripts   │──► Octopart.com   │
│            └─────────────┘                   │
└──────────────────────────────────────────────┘
```

The AI agent calls OpenRouter directly — **no Hermes gateway dependency**. Each agent invocation is stateless and short-lived (parse a BOM, handle a browser exception, etc.).

## Installation

1. Clone the repo or download the `extension/` directory
2. Go to `chrome://extensions/`, enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Right-click the extension icon → **Options** → set your OpenRouter API key
5. Done. Click the icon to open the dashboard.

Get an OpenRouter API key at [openrouter.ai/keys](https://openrouter.ai/keys).

## Usage

### 1. Import Your BOM

Open the dashboard → **BOM 表** tab → **从文本导入** → paste your BOM:

```
Part    | Qty | Spec
M3 hex standoff | 12 | 20mm, brass
WS2812B strip  |  2 | 1m, 60 LED/m
JST-XH connector | 3 | 2-pin, right angle
```

Click **Agent 解析** — the agent extracts parts, flags ambiguities, and populates the table. Edit anything inline if needed.

### 2. Search Prices

Go to **搜索控制台** tab → select a supported site → **启动搜索**. The search loop navigates Octopart, clicks "Show All" on each result, and extracts pricing from inline offer rows. CAPTCHA interrupts are handed off to you. The popup can be closed and reopened — it syncs immediately.

### 3. Find the Best Plan

Switch to **最优方案** tab → set shipping cost → **重新计算**. The optimizer finds the cheapest platform combination.

## Project Structure

```
bom-to-cart/
├── extension/                    # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── background/
│   │   ├── background.js         # SW: message routing + agent handlers
│   │   └── search-loop.js        # State-machine search loop
│   ├── content/
│   │   ├── octopart.js           # Octopart search + pricing extraction
│   │   └── captcha-watcher.js    # Independent CAPTCHA monitor
│   ├── popup/
│   │   ├── popup.html            # 3-tab dashboard UI
│   │   ├── popup.js              # BOM rendering, import flow, search launcher
│   │   └── popup.css
│   ├── lib/
│   │   ├── agent.js              # OpenRouter API client (independent)
│   │   ├── bom-store.js          # chrome.storage.local CRUD
│   │   ├── site-adapter.js       # Base class for shopping site adapters
│   │   └── adapters/
│   │       ├── octopart.js       # Octopart adapter
│   │       └── registry.js       # Adapter registry
│   ├── options/                  # API key + model config page
│   ├── schema/
│   │   └── bom-schema.json       # BOM JSON Schema v1.0
│   └── icons/
├── scripts/
│   └── optimize.py               # Combinatorial optimizer (standalone)
├── references/
│   └── octopart-workflow.md      # Browser scraping reference
├── SKILL.md                      # Hermes skill definition (legacy)
└── README.md
```

## Limitations

| Limitation | Workaround |
|-----------|------------|
| **Octopart CAPTCHA** — PerimeterX fires after ~5-6 searches | Extension pauses, notifies you to solve. Expect 1-2 interruptions per 10-part BOM. |
| **Generic parts** — Screws, nuts, wire, buttons not indexed | Marked as "not found." Add AliExpress/Amazon prices manually. |
| **Shipping assumption** — Defaults to $10/platform | Override in optimal plan tab. |

## Changelog

### v0.2.0 (2026-05-25) — Phase 3: Search Loop

- **State-machine search loop** — 9-state flow with CAPTCHA pause/resume and agent-powered exception handling
- **Direct search-result extraction** — no detail-page navigation needed; pricing extracted from inline `[data-testid="offer-row"]` cells
- **Auto-clicks "Show All"** per search result before extraction
- **Bulk status reset** — debug utility in BOM toolbar
- **Dynamic distributor columns** — each distributor gets its own column in the BOM table
- **Popup reconnection sync** — reopening popup immediately restores console state
- Various bug fixes (infinite retry loop, swallowed CS errors, missing adapter methods)

### v0.1.0 (2026-05-23)

- **Rewritten as Chrome Extension** (was a Hermes skill)
- Independent AI agent via OpenRouter API (no gateway dependency)
- Popup dashboard with 3 tabs: BOM table, optimal plans, search console
- BOM JSON Schema v1.0 with standardized part format
- Octopart content script with atomic search operations
- Agent-based BOM parsing from any text format

### v0.0.0 (pre-extension)

- Original Hermes skill with browser-based Octopart scraping
- Combinatorial optimizer (`optimize.py`)