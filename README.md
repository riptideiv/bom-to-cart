# 🛒 BOM-to-Cart

> Chrome Extension — Parse any BOM, search real-time prices on Octopart, and find the cheapest purchasing plan. AI agent handles the thinking; the extension handles the clicking.

## Disclaimer

This project is an independent browser automation tool for personal use and educational purposes.

Users are responsible for complying with the Terms of Service of any websites they interact with. This project does not bypass CAPTCHAs, authentication systems, or anti-bot protections.

## What It Does

1. **Parse** — Paste your BOM in any format (markdown table, CSV, plain text). An AI agent extracts parts, quantities, and specs into a standardized table.
2. **Search** — Automated search loop extracts pricing from Octopart (inline offer rows) and Temu (search result cards). CAPTCHA pauses are handed off to you.
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
│  ┌───────┐ ┌────────────┐ ┌────────────────┐ │
│  │ BOM   │ │ Optimizer  │ │ Search Monitor │ │
│  └────┬──┘ └──────┬─────┘ └────────┬───────┘ │
│       └───────────┼────────────────┘         │
│                   │ chrome.runtime           │
│            ┌──────▼──────┐                   │
│            │  Background │                   │
│            │ Service Wkr │──► OpenRouter API │
│            └──────┬──────┘    (AI Agent)     │
│                   │                          │
│            ┌──────▼──────┐                   │
│            │   Content   │──►  Search        │
│            │   Scripts   │      Macro        │
│            └─────────────┘                   │
└──────────────────────────────────────────────┘
```

## Installation

1. Clone the repo or download the `extension/` directory
2. Go to `chrome://extensions/`, enable **Developer mode**
3. Click **Load unpacked** → select the `extension/` folder
4. Right-click the extension icon → **Options** → set your OpenRouter API key and desired model
5. Done. Click the icon to open the dashboard.

Get an OpenRouter API key at [openrouter.ai/keys](https://openrouter.ai/keys).

## Usage

### 1. Import Your BOM

Open the dashboard → **BOM 表** tab → **从文本导入** → paste your BOM:

```
Part                          | Qty | Spec
M3 hex standoff               | 12  | 20mm, brass
WS2812B LED strip             | 2   | 1m, 60 LED/m, IP30
JST-XH connector              | 3   | 2-pin, right angle
USB-C breakout board          | 4   | 5V PD trigger
XT60 connector pair           | 5   | male + female
Heat shrink tubing kit        | 1   | assorted diameters
18 AWG silicone wire          | 10m | red/black
PLA filament                  | 2   | black, 1kg spool
Acrylic sheet                 | 3   | clear, 300x300x3mm
Birch plywood plank           | 4   | 1/4in x 6in x 24in
Aluminum angle bracket        | 12  | 20x20mm L connector
Corner brace                  | 8   | stainless steel, 90 degree
Wood screw assortment         | 1   | #6 and #8
Self-tapping screws           | 50  | M3 x 8mm
VHB double-sided tape         | 2   | 20mm width
Rubber feet                   | 16  | adhesive, black
Vinyl sticker paper           | 2   | waterproof, inkjet compatible
Printable holographic vinyl   | 1   | A4 sheets
Neodymium magnet              | 20  | 10mm x 2mm disc
Mini caster wheel             | 4   | swivel, 1in
Drawer slide rail             | 2   | 12in soft-close
Foam padding sheet            | 3   | EVA, 5mm thick
Pegboard hook set             | 1   | assorted sizes
Zip ties                      | 200 | black, 8in
Velcro cable straps           | 20  | reusable
Microfiber cloth pack         | 2   | lint-free
Isopropyl alcohol             | 1   | 99%, 500mL
Cutting mat                   | 1   | A3 self-healing
Precision hobby knife         | 1   | aluminum handle
Super glue gel                | 3   | medium viscosity
Spray paint                   | 2   | matte black
Masking tape                  | 4   | painter's tape, 1in
Storage organizer bin         | 6   | stackable, small
Label maker tape              | 3   | 12mm black on white
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
| **Generic parts** — Screws, nuts, wire, buttons not indexed | Marked as "not found." Add AliExpress/Amazon prices manually. |
| **Shipping assumption** — Defaults to $10/platform | Override in optimal plan tab. |

## Changelog

### v0.4.0 (2026-05-28) — Temu support

- **Temu search** — new site adapter with `content/temu.js`. Searches Temu, extracts product names, prices, and sales data from search results
- **Temu CAPTCHA detection** — detects redirect to `bgn_verification.html`, pauses search loop for manual verification
- **Site-agnostic navigation** — search loop now routes to the correct site based on adapter selection

### v0.3.1 (2026-05-28)

- **Price deletion** — hover any price cell in the BOM table to reveal a ✕ button; delete individual distributor price entries without removing the part
- **Agent strictness control** — choose "严格" (strict — requires same component type + matching specs), "标准" (normal), or "宽松" (loose — accepts partial matches) when searching. Prevents the agent from matching keyboard switches to cable/keycap search results
- **Side panel** — extension now opens as a persistent Chrome side panel instead of a popup; stays visible while you browse Octopart
- **File logging** — background search logs written to `logs/` for debugging
- **Fixed** progress bar denominator growing with numerator (0/9 → 1/10 → … now 0/9 → 1/9 → …)

### v0.3.0 (2026-05-28)

- **Optimal plan tab** — combinatorial optimizer finds top 5 cheapest purchasing plans across distributors, balancing unit price vs per-platform shipping. Exhaustive search (≤20 platforms) or greedy (>20).
- Plan cards show per-part breakdown tables with distributor, unit price, and subtotal
- Configurable per-platform shipping cost

### v0.2.0 (2026-05-25)

- **Automated search** — searches Octopart for each BOM part, auto-clicks "Show All" per result, extracts pricing from inline offer rows without navigating to detail pages
- **Agent-based result matching** — AI agent selects the best matching search result for each BOM part based on name and specifications
- **CAPTCHA handling** — pauses search, opens the page for manual verification, resumes on click
- **Real-time console** — live progress bar, per-part status updates, reopen popup to restore state
- **Dynamic distributor columns** — table columns auto-generated from discovered distributors
- Bulk status reset in BOM toolbar

### v0.1.0 (2026-05-23)

- **Rewritten as Chrome Extension** (was a Hermes skill)
- Independent AI agent via OpenRouter API (no gateway dependency)
- Dashboard with 3 tabs: BOM table, optimal plans, search console
- BOM JSON Schema v1.0 with standardized part format
- Octopart content script with atomic search operations
- Agent-based BOM parsing from any text format

### v0.0.0 (pre-extension)

- Original Hermes skill with browser-based Octopart scraping
- Combinatorial optimizer (`optimize.py`)
