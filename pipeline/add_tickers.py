"""Targeted ticker add.

`pull_daily` keys idempotency off `fetched_at == today`, so on any day the
existing data wasn't pulled it re-fetches the *entire* universe — wasteful
and rate-limit-prone when all you want is to onboard one or two new names.

This script fetches profile + prices + fundamentals for only the universe
tickers that are missing price data (or an explicit subset), via yfinance,
and merges them into universe/prices/fundamentals.json without touching the
existing rows. It also drops any universe.json rows that are no longer in
the configured ticker list (e.g. a corrected/removed symbol).

Run the derived steps afterwards to finish integration:
    uv run python -m pipeline.add_tickers
    uv run python -m pipeline.compute_derived
    uv run python -m pipeline.compute_risk_factors
    uv run python -m pipeline.build_dashboard_prep
    uv run python -m pipeline.pull_fx
"""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, write_json  # noqa: E402
from pipeline.providers.schemas import Fundamentals, PriceSeries, Profile  # noqa: E402
from pipeline.providers.yfinance_provider import YfinanceProvider  # noqa: E402
from pipeline.runner import load_universe_meta  # noqa: E402

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _serialize_series(series: PriceSeries) -> dict:
    return {
        "source": series.source,
        "fetched_at": series.fetched_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "dates": [p.date.isoformat() for p in series.points],
        "close": [p.close for p in series.points],
        "volume": [p.volume for p in series.points],
    }


def _serialize_profile(profile: Profile, currency: str | None) -> dict:
    return {
        "ticker": profile.ticker,
        "name": profile.name,
        "sector": profile.sector,
        "industry": profile.industry,
        "market_cap": profile.market_cap,
        "country": profile.country,
        "exchange": profile.exchange,
        "logo_url": profile.logo_url,
        # Carry currency explicitly — the dashboard's FX conversion depends on
        # it and pull_daily's profile serializer drops it.
        "currency": (currency or profile.currency or "USD").upper(),
        "source": {"profile": profile.source},
    }


def _serialize_fundamentals(f: Fundamentals) -> dict:
    return {
        "source": f.source,
        "fetched_at": f.fetched_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "quarters": [q.model_dump(mode="json") for q in f.quarters],
        "peers": {"source": "sector_fallback", "tickers": []},
        # compute_derived fills this in; keep the key present for schema parity.
        "derived": {},
    }


def _range_from(prices_data: dict) -> dict[str, str | None]:
    starts: list[str] = []
    ends: list[str] = []
    for block in prices_data.values():
        if not isinstance(block, dict):
            continue
        d = block.get("dates") or []
        if d:
            starts.append(d[0])
            ends.append(d[-1])
    return {"start": min(starts) if starts else None, "end": max(ends) if ends else None}


def run(only: list[str] | None = None) -> dict:
    meta = load_universe_meta()
    order = [m["ticker"] for m in meta]
    ccy_by = {m["ticker"]: m.get("currency") for m in meta}

    prices_payload = read_json(config.PRICES_JSON, default={"data": {}}) or {"data": {}}
    prices_data = prices_payload.get("data") or {}

    universe_payload = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {"tickers": []}
    profiles_by: dict[str, dict] = {}
    for r in universe_payload.get("tickers") or []:
        if isinstance(r, dict) and r.get("ticker"):
            profiles_by[r["ticker"]] = r

    fund_payload = read_json(config.FUNDAMENTALS_JSON, default={"data": {}}) or {"data": {}}
    fund_data = fund_payload.get("data") or {}

    if only:
        targets = [t.upper() for t in only]
    else:
        targets = [t for t in order if t not in prices_data]

    log.info("add_tickers · %d target(s): %s", len(targets), targets)

    yf = YfinanceProvider()
    added: list[str] = []
    failed: list[str] = []

    for t in targets:
        try:
            profile = yf.get_profile(t)
            series = yf.get_prices(t, config.PRICE_HISTORY_DAYS)
        except Exception as exc:  # noqa: BLE001
            log.warning("fetch failed for %s: %s", t, exc)
            failed.append(t)
            continue
        if not series.points:
            log.warning("no price points for %s — skipping", t)
            failed.append(t)
            continue

        prices_data[t] = _serialize_series(series)
        profiles_by[t] = _serialize_profile(profile, ccy_by.get(t))

        # Fundamentals are best-effort — a thin/empty result (common for some
        # non-US listings) still leaves a usable price-only ticker.
        try:
            fundamentals = yf.get_fundamentals(t, config.QUARTERS_BACK)
            if fundamentals.quarters:
                fund_data[t] = _serialize_fundamentals(fundamentals)
                log.info("  %s · %d price pts · %d quarters", t, len(series.points), len(fundamentals.quarters))
            else:
                log.info("  %s · %d price pts · no fundamentals", t, len(series.points))
        except Exception as exc:  # noqa: BLE001
            log.warning("fundamentals failed for %s (non-fatal): %s", t, exc)

        added.append(t)

    # Rebuild universe in canonical order, dropping rows no longer configured.
    universe_out = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "tickers": [profiles_by[t] for t in order if t in profiles_by],
    }
    dropped = [t for t in profiles_by if t not in set(order)]
    write_json(config.UNIVERSE_JSON, universe_out)

    prices_out = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "range": _range_from(prices_data),
        "data": prices_data,
    }
    write_json(config.PRICES_JSON, prices_out)

    fund_out = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "data": fund_data,
    }
    write_json(config.FUNDAMENTALS_JSON, fund_out)

    summary = {"added": added, "failed": failed, "dropped": dropped, "universe_size": len(universe_out["tickers"])}
    log.info("add_tickers complete · %s", summary)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch + merge new universe tickers (yfinance)")
    parser.add_argument("tickers", nargs="*", help="explicit tickers; default = universe tickers missing prices")
    args = parser.parse_args()
    setup_logging()
    run(only=args.tickers or None)


if __name__ == "__main__":
    main()
