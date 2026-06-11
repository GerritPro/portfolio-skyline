# Portfolio Skyline

A finance dashboard for analysing an equity portfolio through interchangeable
**lenses** — Performance (equity curve, drawdown, contribution), Risk
(market/sector/idiosyncratic decomposition), Valuation, Movement, Network
(correlation), and Market (gamma exposure). Built on Next.js 16 + React 19,
backed by a Python market-data pipeline that emits static JSON.

Multi-currency aware: positions in USD / EUR / HKD / JPY / CNY / … are
converted to EUR via daily ECB rates for correct totals and weights.

---

## Setup

**Prerequisites**

- [Node.js](https://nodejs.org) **20 LTS or newer**
- [Python](https://www.python.org) **3.12** + [uv](https://docs.astral.sh/uv/) — for the data pipeline
- [Git](https://git-scm.com)

**Clone & run**

```powershell
git clone https://github.com/GerritPro/portfolio-skyline.git
cd portfolio-skyline

npm install                                    # JS dependencies → node_modules
uv sync                                         # Python venv from uv.lock → .venv

# create the local env file (no secret needed for the yfinance provider)
'DATA_PROVIDER=yfinance' | Out-File -Encoding utf8 .env.local

npm run dev                                     # → http://localhost:3000
```

The repo ships a precomputed `public/data` snapshot, so the dashboard runs
immediately after a clone — **no pipeline run required**.

> macOS / Linux: replace the `.env.local` line with
> `echo "DATA_PROVIDER=yfinance" > .env.local`

---

## Keeping data fresh

The header shows a freshness badge (e.g. *“Stale · 3 weeks ago”*) graded in
trading days. To refresh prices/FX/derived data, run the pipeline (needs
internet; yfinance + the free Frankfurter FX API):

```powershell
uv run python -m pipeline.pull_daily          # prices + profiles
uv run python -m pipeline.compute_derived     # correlations, sectors, stock pages
uv run python -m pipeline.compute_risk_factors
uv run python -m pipeline.build_dashboard_prep
uv run python -m pipeline.pull_fx             # EUR-based FX rates + history
```

Then **restart the dev server** — the dashboard caches `dashboard_prep.json`
and `prices.json` in memory, so data-file changes are picked up on restart.

### Add a ticker to the universe

1. Append it to `pipeline/tickers.json` → `custom` (use the real Yahoo symbol,
   e.g. `OLED`, `002050.SZ`), with `currency`, `name`, `manual_sector`.
2. Fetch + merge just the new names, then rebuild:

   ```powershell
   uv run python -m pipeline.add_tickers
   uv run python -m pipeline.compute_derived
   uv run python -m pipeline.compute_risk_factors
   uv run python -m pipeline.build_dashboard_prep
   ```

---

## Project layout

```
app/            Next.js routes (dashboard, /stock/[ticker], /api/*)
components/     UI — lens panels, cards, charts (Recharts), header
lib/            client/server logic (performance, freshness, formatting, FX)
pipeline/       Python data pipeline (yfinance / EDGAR / Frankfurter)
public/data/    precomputed JSON snapshot the app reads
```

## Scripts

| Command          | What it does                              |
| ---------------- | ----------------------------------------- |
| `npm run dev`    | start the dev server (Turbopack)          |
| `npm run build`  | production build                          |
| `npm run lint`   | ESLint                                    |
| `npm start`      | serve the production build                |
| `uv run pytest`  | pipeline tests                            |

## Syncing across machines

```powershell
git pull                                   # get changes from the other PC
git add -A; git commit -m "…"; git push    # push your own
```
