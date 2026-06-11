"""Precompute everything the Dashboard server needs into a single JSON.

The 50MB prices.json + 7MB fundamentals.json + computeDetails O(N²) sector
loop combine to take 25-45s per request in dev. Most of that work is the
same across requests — we ship a precomputed `dashboard_prep.json` that
the server reads with one JSON.parse.

Output fields mirror what DashboardServer would otherwise compute live."""
from __future__ import annotations

import json
import logging
import math
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, write_json  # noqa: E402

log = logging.getLogger(__name__)

DASHBOARD_PREP = config.DATA_DIR / "dashboard_prep.json"


def _last_close(prices_block: dict | None) -> float | None:
    if not isinstance(prices_block, dict):
        return None
    closes = prices_block.get("close") or []
    if not closes:
        return None
    for c in reversed(closes):
        if isinstance(c, (int, float)) and math.isfinite(c) and c > 0:
            return float(c)
    return None


def _return_over_days(prices_block: dict | None, days: int) -> float | None:
    if not isinstance(prices_block, dict):
        return None
    closes = prices_block.get("close") or []
    if len(closes) < days + 1:
        return None
    past = closes[-(days + 1)]
    now = closes[-1]
    if past is None or now is None or past == 0:
        return None
    return now / past - 1


def _trailing_pe_series(
    ticker: str,
    prices_block: dict | None,
    fundamentals_block: dict | None,
) -> tuple[float | None, float, float, float]:
    """Returns (current_pe, ownMean, ownStd, zScore) using TTM EPS history."""
    if fundamentals_block is None or prices_block is None:
        return None, 0.0, 0.0, 0.0
    quarters = fundamentals_block.get("quarters") or []
    if not quarters:
        return None, 0.0, 0.0, 0.0
    dates = prices_block.get("dates") or []
    closes = prices_block.get("close") or []
    close_by_date = dict(zip(dates, closes))

    pes: list[float] = []
    quarters_newest_first = quarters
    for i, q in enumerate(quarters_newest_first):
        parts = [quarters_newest_first[j].get("eps") for j in range(i, min(i + 4, len(quarters_newest_first)))]
        if any(p is None for p in parts) or len(parts) < 4:
            continue
        ttm_eps = sum(parts)
        if abs(ttm_eps) < 1e-9:
            continue
        end = q.get("fiscal_date_ending")
        if not end:
            continue
        candidates = [d for d in close_by_date if d <= end]
        if not candidates:
            continue
        c = close_by_date[max(candidates)]
        if c is None:
            continue
        pe = c / ttm_eps
        if math.isfinite(pe):
            pes.append(pe)
    if not pes:
        return None, 0.0, 0.0, 0.0
    mean = sum(pes) / len(pes)
    var = sum((p - mean) ** 2 for p in pes) / len(pes)
    std = math.sqrt(var)
    current = pes[0]  # newest quarter
    z = (current - mean) / std if std > 1e-9 else 0.0
    return current, mean, std, z


def run() -> dict:
    universe = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {}
    prices = read_json(config.PRICES_JSON, default={"data": {}}) or {}
    fundamentals = read_json(config.FUNDAMENTALS_JSON, default={"data": {}}) or {}

    p_data = prices.get("data") or {}
    f_data = fundamentals.get("data") or {}

    # Per-ticker derived metrics — used by the dashboard and z-score chart.
    by_ticker: dict[str, dict] = {}
    last_close: dict[str, float] = {}
    by_sector: dict[str, list[str]] = defaultdict(list)
    universe_tickers = []

    for prof in universe.get("tickers") or []:
        if not isinstance(prof, dict) or not prof.get("ticker"):
            continue
        t = prof["ticker"]
        prices_block = p_data.get(t)
        fund_block = f_data.get(t)
        cur_pe, own_mean, own_std, z = _trailing_pe_series(t, prices_block, fund_block)
        lc = _last_close(prices_block)
        if lc is not None and lc > 0:
            last_close[t] = lc
        by_ticker[t] = {
            "currentPe": cur_pe,
            "ownMean": own_mean,
            "ownStd": own_std,
            "zScore": z,
            "return1d": _return_over_days(prices_block, 1),
            "return1m": _return_over_days(prices_block, 21),
            "return1y": _return_over_days(prices_block, 252),
            "return5y": _return_over_days(prices_block, 252 * 5),
        }
        sec = prof.get("sector")
        if sec:
            by_sector[sec].append(t)
        universe_tickers.append(prof)

    payload = {
        "universeTickers": universe_tickers,
        "byTicker": by_ticker,
        "lastClose": last_close,
        "tickersBySector": dict(by_sector),
    }
    write_json(DASHBOARD_PREP, payload)
    log.info(
        "dashboard_prep: %d tickers, %d sectors, %d with last_close",
        len(by_ticker),
        len(by_sector),
        len(last_close),
    )
    return {"tickers": len(by_ticker), "with_close": len(last_close)}


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s :: %(message)s", datefmt="%H:%M:%S")
    print(run())
