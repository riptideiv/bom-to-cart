# BOM-to-Cart

Chrome Extension — AI-powered BOM purchasing assistant. Parse any Bill of Materials, search real-time prices across electronic component distributors, and find optimal purchasing plans.

## How It Works

1. **Import BOM** — paste any format (Markdown table, CSV, plain text) → Agent parses into structured parts
2. **Search** — automated search loop extracts pricing directly from Octopart search results
3. **Optimize** — find the cheapest combination of distributors for your BOM

## Project Structure

```
bom-to-cart/
├── README.md
├── LICENSE
└── extension/          # Chrome Extension (MV3)
    ├── manifest.json
    ├── background/     # Service Worker: search loop, agent, BOM manager
    ├── content/        # Content scripts: Octopart extraction, CAPTCHA watcher
    ├── lib/            # Agent, BOMStore, adapters
    ├── popup/          # Dashboard UI
    ├── options/        # API key config
    └── schema/         # BOM JSON Schema
```

## Tech Stack

- **Chrome Extension MV3** — Service Worker, content scripts
- **OpenRouter API** — Claude for BOM parsing + exception decisions
- **No framework** — vanilla JS, IIFE content scripts, ES modules

## Status

Phase 3 (search loop) ✓ — automated Octopart price extraction from search results.

## License

MIT