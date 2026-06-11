"""EDINET (Japan Financial Services Agency) daily filings check.

Fetches the list of yesterday's filings from EDINET API v2, filters to
tickers in our universe with .T suffix, and logs matches. Does NOT yet
parse the XBRL bodies — that lives in a future iteration when there are
enough Japan holdings to justify a per-tag mapper.

Requires `EDINET_API_KEY` env var (free registration at
disclosure.edinet-fsa.go.jp). Skips gracefully if missing.

Entry point for the GitHub Actions edinet-daily workflow."""
from __future__ import annotations

import logging
import os
import sys
from datetime import date, timedelta
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import setup_logging  # noqa: E402
from pipeline.runner import load_universe_meta  # noqa: E402
from pipeline.state.update_stamp import stamp  # noqa: E402

log = logging.getLogger(__name__)

EDINET_DOCS_URL = "https://api.edinet-fsa.go.jp/api/v2/documents.json"
USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"


def _japan_tickers() -> list[str]:
    """All universe tickers with `.T` (Tokyo Stock Exchange) suffix."""
    return [m["ticker"] for m in load_universe_meta() if m["ticker"].endswith(".T")]


def _ticker_to_securities_code(ticker: str) -> str:
    """Strip the .T suffix and zero-pad to the 5-char EDINET secCode format.
    Tokyo tickers are 4-digit (e.g., 4901 → '49010')."""
    base = ticker.split(".")[0]
    return base + "0" if len(base) == 4 else base


def fetch_documents_for_date(api_key: str, target_date: date) -> list[dict]:
    r = requests.get(
        EDINET_DOCS_URL,
        params={"date": target_date.isoformat(), "type": "2", "Subscription-Key": api_key},
        headers={"User-Agent": USER_AGENT},
        timeout=30,
    )
    r.raise_for_status()
    data = r.json()
    return data.get("results") or []


def main() -> None:
    setup_logging()
    config.load_env()
    api_key = os.environ.get("EDINET_API_KEY", "").strip()
    if not api_key:
        log.warning("EDINET_API_KEY not set — skipping. Register a free key at disclosure.edinet-fsa.go.jp.")
        stamp("japan")
        return

    jp_tickers = _japan_tickers()
    if not jp_tickers:
        log.info("no Japan tickers in universe — nothing to do")
        stamp("japan")
        return

    sec_codes = {_ticker_to_securities_code(t): t for t in jp_tickers}
    log.info("watching %d Japan tickers: %s", len(jp_tickers), ", ".join(jp_tickers))

    # EDINET lists by filing date. Check today + yesterday to handle the
    # ~01:00 UTC cron firing before Tokyo's late-evening filings post.
    today = date.today()
    matches: list[dict] = []
    for d in (today, today - timedelta(days=1)):
        try:
            docs = fetch_documents_for_date(api_key, d)
        except requests.RequestException as exc:
            log.warning("EDINET fetch failed for %s: %s", d, exc)
            continue
        log.info("EDINET %s: %d documents", d, len(docs))
        for doc in docs:
            sec_code = (doc.get("secCode") or "").strip()
            if sec_code in sec_codes:
                doc_type = doc.get("docDescription") or doc.get("ordinanceCode") or ""
                log.info(
                    "MATCH %s (%s): %s · docID=%s",
                    sec_codes[sec_code], sec_code, doc_type, doc.get("docID"),
                )
                matches.append(doc)

    if matches:
        log.info("found %d matching filings — XBRL parser TODO", len(matches))
    else:
        log.info("no matching Japan filings today")

    stamp("japan")


if __name__ == "__main__":
    main()
