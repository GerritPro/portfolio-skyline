"""One-shot helper: fetch the current S&P 500 constituent list from Wikipedia
and write the ticker symbols + GICS sectors + canonical company names. Writes
the ticker list to pipeline/tickers.json (key `sp500`) and a per-ticker
sector map to pipeline/sector_overrides.json. Idempotent; rerun to refresh.

The Wikipedia table column header for Yahoo-style symbols changed over the
years — we read the first column of the constituents table and normalise
class shares (BRK.B / BF.B form preserved because SEC EDGAR uses dots).
"""
from __future__ import annotations

import json
import logging
import re
import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402

log = logging.getLogger(__name__)

WIKI_URL = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"
SECTOR_OVERRIDES_FILE = config.PIPELINE_DIR / "sector_overrides.json"


def fetch_sp500() -> list[dict]:
    log.info("fetching SP500 constituents from Wikipedia")
    r = requests.get(WIKI_URL, headers={"User-Agent": USER_AGENT}, timeout=20)
    r.raise_for_status()
    html = r.text

    table_match = re.search(r'<table[^>]*class="[^"]*wikitable[^"]*"[^>]*>(.*?)</table>', html, re.DOTALL)
    if not table_match:
        raise RuntimeError("could not locate constituents table in Wikipedia HTML")
    table_html = table_match.group(1)

    rows = re.findall(r"<tr.*?>(.*?)</tr>", table_html, re.DOTALL)
    out: list[dict] = []
    for row in rows:
        cells = re.findall(r"<t[hd][^>]*>(.*?)</t[hd]>", row, re.DOTALL)
        if len(cells) < 4:
            continue
        symbol = _strip_html(cells[0]).strip()
        name = _strip_html(cells[1]).strip()
        # Wikipedia columns: 0=Symbol, 1=Security, 2=GICS Sector, 3=GICS
        # Sub-Industry (older revisions had SEC filings col at index 2). Pick
        # the first cell among 2..4 that looks like a sector name.
        sector_candidates = [
            _strip_html(cells[i]).strip() for i in range(2, min(5, len(cells)))
        ]
        sector: str | None = None
        for cand in sector_candidates:
            if not cand:
                continue
            low = cand.lower()
            if "filing" in low or "report" in low:
                continue
            sector = cand
            break
        if not symbol or symbol == "Symbol":
            continue
        # Strip ALL whitespace (including the U+00A0 non-breaking space that
        # Wikipedia occasionally injects between letters).
        symbol = re.sub(r"\s+", "", symbol).upper()
        out.append({"ticker": symbol, "name": name, "sector": sector})
    return out


def _strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s)
    return s.strip()


def run() -> dict:
    rows = fetch_sp500()
    if not rows:
        raise RuntimeError("SP500 fetch returned zero rows")

    payload = json.loads(config.TICKERS_FILE.read_text("utf-8"))
    payload["sp500"] = [r["ticker"] for r in rows]
    payload["sp500_snapshot"] = rows
    payload["sp500_fetched_from"] = WIKI_URL
    config.TICKERS_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    # Read existing overrides so manual entries (international + edge-case
    # tickers) survive the refresh.
    overrides: dict[str, str] = {}
    if SECTOR_OVERRIDES_FILE.exists():
        try:
            overrides = json.loads(SECTOR_OVERRIDES_FILE.read_text("utf-8")) or {}
        except json.JSONDecodeError:
            overrides = {}
    # Wikipedia data wins for the SP500 entries.
    for r in rows:
        if r.get("sector"):
            overrides[r["ticker"]] = r["sector"]
    SECTOR_OVERRIDES_FILE.write_text(json.dumps(overrides, indent=2, sort_keys=True), encoding="utf-8")

    log.info(
        "wrote %d SP500 tickers + %d sector mappings",
        len(rows),
        sum(1 for r in rows if r.get("sector")),
    )
    return {"count": len(rows), "sectors_mapped": sum(1 for r in rows if r.get("sector"))}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s", datefmt="%H:%M:%S")
    print(run())
