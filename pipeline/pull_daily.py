"""Daily pull: refresh prices.json + profiles in universe.json. Idempotent —
re-runs on the same calendar day produce zero network calls (assuming the
last close has already been captured)."""
from __future__ import annotations

import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Path-shim so `python pipeline/pull_daily.py` works without `python -m`.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, today_utc, write_json  # noqa: E402
from pipeline.providers.router import Router  # noqa: E402
from pipeline.providers.schemas import PriceSeries, Profile  # noqa: E402
from pipeline.runner import build_router, load_universe  # noqa: E402

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _today_str() -> str:
    return today_utc().isoformat()


def _fetched_today(prices_payload: dict, ticker: str, today: str) -> bool:
    """Idempotency check: did we already pull this ticker's prices today?
    Uses the stored `fetched_at` timestamp, not the last close date — a
    Friday close is still 'fresh' on a Sunday re-run."""
    block = (prices_payload.get("data") or {}).get(ticker)
    if not isinstance(block, dict):
        return False
    fetched_at = block.get("fetched_at") or ""
    return fetched_at[:10] == today


def _serialize_series(series: PriceSeries) -> dict:
    return {
        "source": series.source,
        "fetched_at": series.fetched_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "dates": [p.date.isoformat() for p in series.points],
        "close": [p.close for p in series.points],
        "volume": [p.volume for p in series.points],
    }


def _serialize_profile(profile: Profile) -> dict:
    return {
        "ticker": profile.ticker,
        "name": profile.name,
        "sector": profile.sector,
        "industry": profile.industry,
        "market_cap": profile.market_cap,
        "country": profile.country,
        "exchange": profile.exchange,
        "logo_url": profile.logo_url,
        # Carry currency — the dashboard's FX conversion (EUR totals, weights)
        # depends on it. Previously dropped, which silently treated non-USD
        # holdings (HKD/JPY/CNY…) as USD.
        "currency": (profile.currency or "USD").upper(),
        "source": {"profile": profile.source},
    }


def run(router: Router | None = None, *, force: bool = False) -> dict:
    """Returns a small summary dict for the orchestrator."""
    universe = load_universe()
    router = router or build_router()

    prices_payload = read_json(config.PRICES_JSON, default={"version": 1, "data": {}}) or {}
    prices_data = prices_payload.get("data") or {}
    today = _today_str()

    # Universe rebuild: keep existing profile entries, only refetch ones we
    # don't have yet. We deliberately do NOT refresh profiles daily to spare
    # the FMP quota; pull_quarterly does that.
    universe_payload = read_json(config.UNIVERSE_JSON, default=None)
    existing_profiles: dict[str, dict] = {}
    if isinstance(universe_payload, dict):
        for r in universe_payload.get("tickers") or []:
            if isinstance(r, dict) and r.get("ticker"):
                existing_profiles[r["ticker"]] = r

    new_profile_count = 0
    for ticker in universe:
        if ticker in existing_profiles and not force:
            continue
        try:
            profile = router.get_profile(ticker)
            existing_profiles[ticker] = _serialize_profile(profile)
            new_profile_count += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("profile fetch failed for %s: %s", ticker, exc)

    # Prices: per-ticker idempotency.
    fetched_count = 0
    skipped_count = 0
    failed: list[str] = []
    for ticker in universe:
        if not force and _fetched_today(prices_payload, ticker, today):
            skipped_count += 1
            continue
        try:
            series = router.get_prices(ticker, config.PRICE_HISTORY_DAYS)
        except Exception as exc:  # noqa: BLE001
            log.warning("price fetch failed for %s: %s", ticker, exc)
            failed.append(ticker)
            continue
        if not series.points:
            failed.append(ticker)
            continue
        prices_data[ticker] = _serialize_series(series)
        fetched_count += 1

    prices_payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "range": _range_from(prices_data),
        "data": prices_data,
    }
    write_json(config.PRICES_JSON, prices_payload)

    universe_out = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "tickers": [existing_profiles[t] for t in universe if t in existing_profiles],
    }
    write_json(config.UNIVERSE_JSON, universe_out)

    log.info(
        "pull_daily complete · prices fetched=%d skipped=%d failed=%d · profiles new=%d",
        fetched_count, skipped_count, len(failed), new_profile_count,
    )
    return {
        "prices_fetched": fetched_count,
        "prices_skipped": skipped_count,
        "prices_failed": failed,
        "profiles_new": new_profile_count,
        "provider_counts": router.provider_counts(),
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


if __name__ == "__main__":
    setup_logging()
    summary = run()
    log.info("summary: %s", summary)
