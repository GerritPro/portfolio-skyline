"""Build a stub universe.json from existing fundamentals + tickers.json
when pull_daily can't run (FMP profile endpoint is legacy-blocked). Only
includes tickers that already have fundamentals data, so the frontend
never sees a ticker without any backing data."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timezone

from pipeline import config
from pipeline.io_utils import read_json, write_json
from pipeline.runner import load_universe_meta

log = logging.getLogger(__name__)


def run() -> dict:
    fundamentals = read_json(config.FUNDAMENTALS_JSON, default={"data": {}}) or {}
    fund_data = fundamentals.get("data") or {}

    existing = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {}
    by_ticker: dict[str, dict] = {}
    for r in existing.get("tickers") or []:
        if isinstance(r, dict) and r.get("ticker"):
            by_ticker[r["ticker"]] = r

    # Override layer: tickers.json metadata (name, sector overrides, currency)
    meta_by_ticker = {m["ticker"]: m for m in load_universe_meta()}

    # Per-ticker sector overrides (from Wikipedia SP500 fetch + manual entries).
    sector_overrides: dict[str, str] = {}
    sector_file = config.PIPELINE_DIR / "sector_overrides.json"
    if sector_file.exists():
        raw = read_json(sector_file, default={}) or {}
        if isinstance(raw, dict):
            sector_overrides = {k.upper(): v for k, v in raw.items() if isinstance(v, str)}

    out: list[dict] = []
    for ticker in fund_data.keys():
        prof = by_ticker.get(ticker)
        meta = meta_by_ticker.get(ticker, {})
        sector = (
            (prof.get("sector") if prof else None)
            or meta.get("manual_sector")
            or sector_overrides.get(ticker.upper())
        )
        if prof:
            row = dict(prof)
            row["sector"] = sector
            # Backfill name from the Wikipedia snapshot when the cached
            # profile only carries the bare ticker symbol — happens when
            # pull_daily's profile endpoint is legacy-blocked.
            existing_name = (row.get("name") or "").strip()
            meta_name = (meta.get("name") or "").strip()
            if meta_name and (not existing_name or existing_name.upper() == ticker.upper()):
                row["name"] = meta_name
        else:
            row = {
                "ticker": ticker,
                "name": meta.get("name") or ticker,
                "sector": sector,
                "industry": None,
                "market_cap": None,
                "country": None,
                "exchange": None,
                "logo_url": None,
                "currency": meta.get("currency") or "USD",
                "source": {"profile": "stub"},
            }
        out.append(row)

    out.sort(key=lambda r: r["ticker"])

    payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "tickers": out,
    }
    write_json(config.UNIVERSE_JSON, payload)
    return {"tickers_written": len(out)}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s :: %(message)s", datefmt="%H:%M:%S")
    print(run())
