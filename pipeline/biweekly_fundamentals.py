"""Biweekly fundamentals pull with smart change-detection.

Pre-check each ticker's latest 10-K / 10-Q via SEC Submissions API. Skip
tickers whose newest filing date matches the cached state — outside earnings
seasons that's 80%+ of the universe. Only those with new filings get the
full 3-statement pull. Saves quota dramatically.

Entry point for the GitHub Actions biweekly workflow (1st + 15th of month)."""
from __future__ import annotations

import json
import logging
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import (  # noqa: E402
    build_dashboard_prep,
    compute_derived,
    config,
    pull_quarterly,
)
from pipeline.io_utils import read_json, setup_logging, write_json  # noqa: E402
from pipeline.providers.edgar_xbrl import EdgarXbrlProvider  # noqa: E402
from pipeline.providers.throttle import FmpThrottle  # noqa: E402
from pipeline.runner import build_router, load_universe  # noqa: E402
from pipeline.segments.edgar_submissions import USER_AGENT  # noqa: E402
from pipeline.state.update_stamp import stamp  # noqa: E402

log = logging.getLogger(__name__)

STATE_FILE = config.PIPELINE_DIR / "state" / "last_fundamentals.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"


def _latest_filing_date(cik: str, session: requests.Session) -> str | None:
    """Return the most recent 10-K or 10-Q filing date, or None on error."""
    try:
        r = session.get(SUBMISSIONS_URL.format(cik=cik), timeout=20)
        r.raise_for_status()
        recent = (r.json().get("filings") or {}).get("recent") or {}
        forms = recent.get("form") or []
        dates = recent.get("filingDate") or []
        for f, d in zip(forms, dates):
            if f in {"10-K", "10-Q"}:
                return d
    except requests.RequestException as exc:
        log.warning("submissions fetch failed (cik=%s): %s", cik, exc)
    return None


def _load_state() -> dict:
    if not STATE_FILE.exists():
        return {}
    try:
        raw = json.loads(STATE_FILE.read_text("utf-8"))
        return raw if isinstance(raw, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_state(state: dict) -> None:
    STATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATE_FILE.write_text(json.dumps(state, indent=2, sort_keys=True), encoding="utf-8")


def main() -> None:
    setup_logging()
    config.load_env()
    mode = config.get_mode()
    router = build_router(mode)
    universe = load_universe()
    log.info("biweekly_fundamentals · universe=%d", len(universe))

    cik_cache = config.PIPELINE_DIR / ".cik_map.json"
    xbrl = EdgarXbrlProvider(cik_cache_path=cik_cache)
    cik_map = xbrl._load_cik_map()

    state = _load_state()
    session = requests.Session()
    session.headers["User-Agent"] = USER_AGENT

    needs_pull: list[str] = []
    today_iso = date.today().isoformat()
    for ticker in universe:
        cik = cik_map.get(ticker.upper())
        if not cik:
            # Non-US tickers are pulled via yfinance fallback regardless of state.
            needs_pull.append(ticker)
            continue
        latest = _latest_filing_date(cik, session)
        if latest is None:
            log.info("%s: submissions failed, pulling defensively", ticker)
            needs_pull.append(ticker)
            continue
        cached = (state.get(ticker) or {}).get("last_filing_date")
        if cached and latest <= cached:
            continue
        log.info("%s: new filing %s (was %s)", ticker, latest, cached or "—")
        needs_pull.append(ticker)
        state.setdefault(ticker, {})["cik"] = cik
        state[ticker]["last_filing_date"] = latest
        state[ticker]["checked_at"] = today_iso

    log.info("change-detection: %d / %d tickers need fundamentals refresh", len(needs_pull), len(universe))

    if needs_pull:
        # pull_quarterly's per-ticker idempotency check uses fiscal_date_ending
        # within QUARTERLY_CURRENT_DAYS — we already filtered to "new filings"
        # so force=True to bypass that secondary check.
        pull_quarterly.run(router=router, incremental=False, force=True)
        compute_derived.run()
        try:
            log.info("dashboard prep: %s", build_dashboard_prep.run())
        except Exception as exc:  # noqa: BLE001
            log.warning("dashboard prep failed (non-fatal): %s", exc)
        for t in needs_pull:
            quarters = _count_quarters(t)
            state.setdefault(t, {})["quarters_count"] = quarters
    else:
        log.info("no new filings — skipping fundamentals pull")

    _save_state(state)

    fmp_used = 0
    if router.fmp is not None:
        throttle = FmpThrottle(config.FMP_CALL_LOG, config.FMP_DAILY_QUOTA)
        fmp_used = throttle.used_today()

    stamp("fundamentals")
    log.info(
        "biweekly_fundamentals done · pulled=%d skipped=%d fmp_used=%d",
        len(needs_pull),
        len(universe) - len(needs_pull),
        fmp_used,
    )


def _count_quarters(ticker: str) -> int:
    block_path = config.DATA_DIR / "stocks" / ticker / "metrics" / "revenue.json"
    if not block_path.exists():
        return 0
    try:
        d = json.loads(block_path.read_text("utf-8"))
        views = d.get("views") or {}
        q = views.get("quarterly") or {}
        series = q.get("series") or []
        return sum(1 for x in series if isinstance(x, dict) and x.get("value") is not None)
    except (json.JSONDecodeError, OSError):
        return 0


if __name__ == "__main__":
    main()
