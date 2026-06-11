"""Shared bootstrapping for entry scripts: env loading, ticker list,
provider construction, profile-cache hydration."""
from __future__ import annotations

import html
import logging
from datetime import datetime, timezone


def _html_unescape(s: str) -> str:
    return html.unescape(s).strip() if s else ""

from . import config
from .io_utils import read_json
from .providers.base import DataProvider
from .providers.edgar_xbrl import EdgarXbrlProvider
from .providers.fmp_provider import FmpProvider
from .providers.router import Router, RoutingMode
from .providers.schemas import Profile
from .providers.throttle import FmpThrottle
from .providers.yfinance_provider import YfinanceProvider

log = logging.getLogger(__name__)


def load_universe() -> list[str]:
    """Returns the flat list of ticker symbols. Both string and object entries
    in tickers.json are supported."""
    return [m["ticker"] for m in load_universe_meta()]


def load_universe_meta() -> list[dict]:
    """Returns enriched metadata per ticker:
       {ticker, currency, name?, manual_sector?}.
    SP100 strings default to USD. Custom entries may be strings (legacy) or
    objects with explicit fields."""
    raw = read_json(config.TICKERS_FILE, default={"sp100": [], "custom": []})
    seen: set[str] = set()
    out: list[dict] = []

    def _push(entry: dict | str, default_currency: str) -> None:
        if isinstance(entry, str):
            t = entry.upper().strip()
            if not t or t in seen:
                return
            seen.add(t)
            out.append({"ticker": t, "currency": default_currency})
            return
        if not isinstance(entry, dict):
            return
        t = str(entry.get("ticker") or "").upper().strip()
        if not t or t in seen:
            return
        seen.add(t)
        normalized: dict = {
            "ticker": t,
            "currency": (entry.get("currency") or default_currency).upper(),
        }
        if entry.get("name"):
            normalized["name"] = entry["name"]
        if entry.get("manual_sector"):
            normalized["manual_sector"] = entry["manual_sector"]
        out.append(normalized)

    # The Wikipedia snapshot carries proper company names + GICS sectors
    # per S&P 500 ticker; merge that in so downstream code (patents
    # candidate matching, brand colours, etc.) sees real names instead
    # of the bare symbol. HTML entities sometimes leak through from
    # Wikipedia (e.g. "AT&amp;T") — unescape them.
    snapshot_by_ticker: dict[str, dict] = {}
    for row in raw.get("sp500_snapshot") or []:
        if not isinstance(row, dict):
            continue
        t = str(row.get("ticker") or "").upper().strip()
        if not t:
            continue
        snapshot_by_ticker[t] = {
            "name": _html_unescape(row.get("name") or "") or None,
            "manual_sector": row.get("sector") or None,
        }

    def _push_with_snapshot(entry: dict | str, default_currency: str) -> None:
        if isinstance(entry, str):
            snap = snapshot_by_ticker.get(entry.upper().strip())
            if snap and (snap.get("name") or snap.get("manual_sector")):
                merged: dict = {"ticker": entry, "currency": default_currency}
                if snap.get("name"):
                    merged["name"] = snap["name"]
                if snap.get("manual_sector"):
                    merged["manual_sector"] = snap["manual_sector"]
                _push(merged, default_currency)
                return
        elif isinstance(entry, dict):
            t = str(entry.get("ticker") or "").upper().strip()
            snap = snapshot_by_ticker.get(t)
            if snap:
                merged = dict(entry)
                if not merged.get("name") and snap.get("name"):
                    merged["name"] = snap["name"]
                if not merged.get("manual_sector") and snap.get("manual_sector"):
                    merged["manual_sector"] = snap["manual_sector"]
                _push(merged, default_currency)
                return
        _push(entry, default_currency)

    for s in raw.get("sp100") or []:
        _push_with_snapshot(s, "USD")
    for s in raw.get("sp500") or []:
        _push_with_snapshot(s, "USD")
    for c in raw.get("custom") or []:
        _push_with_snapshot(c, "USD")
    return out


def build_router(mode: RoutingMode | None = None) -> Router:
    config.load_env()
    mode = mode or config.get_mode()
    api_key = config.get_fmp_key()

    yf: DataProvider = YfinanceProvider()

    fmp: DataProvider | None = None
    if api_key:
        throttle = FmpThrottle(config.FMP_CALL_LOG, config.FMP_DAILY_QUOTA)
        fmp = FmpProvider(api_key, throttle)
    elif mode in {"hybrid", "fmp"}:
        raise RuntimeError(
            f"DATA_PROVIDER={mode} requires FMP_API_KEY in environment"
        )

    # SEC EDGAR XBRL — free, no key, primary source for US fundamentals.
    cik_cache = config.PIPELINE_DIR / ".cik_map.json"
    xbrl: DataProvider = EdgarXbrlProvider(cik_cache_path=cik_cache)

    router = Router(mode, yf=yf, fmp=fmp, xbrl=xbrl)
    _hydrate_profile_cache(router)
    return router


def _hydrate_profile_cache(router: Router) -> None:
    """Load any previously-saved profiles back into the router so that
    sector_fallback peers and incremental runs work without re-fetching."""
    universe_payload = read_json(config.UNIVERSE_JSON, default=None)
    if not isinstance(universe_payload, dict):
        return
    rows = universe_payload.get("tickers") or []
    profiles: dict[str, Profile] = {}
    fetched_at = _parse_dt(universe_payload.get("generated_at"))
    for r in rows:
        if not isinstance(r, dict):
            continue
        try:
            profiles[r["ticker"]] = Profile(
                ticker=r["ticker"],
                name=r.get("name") or r["ticker"],
                sector=r.get("sector"),
                industry=r.get("industry"),
                market_cap=r.get("market_cap"),
                country=r.get("country"),
                exchange=r.get("exchange"),
                logo_url=r.get("logo_url"),
                currency=r.get("currency"),
                source=(r.get("source") or {}).get("profile") or "fmp",
                fetched_at=fetched_at,
            )
        except Exception as exc:  # noqa: BLE001
            log.debug("skip profile-cache row %s: %s", r.get("ticker"), exc)
    router.seed_profile_cache(profiles)


def _parse_dt(s: str | None) -> datetime:
    if not s:
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return datetime.now(timezone.utc)
