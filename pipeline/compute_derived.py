"""Pure compute step. Reads prices.json + fundamentals.json + universe.json
from disk and writes correlations.json, sectors.json, refreshed
fundamentals.json (with `derived`), per-stock metric splits, and
metadata.json. No network calls."""
from __future__ import annotations

import logging
import statistics
import subprocess
import sys
from collections import defaultdict
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, today_utc, write_json  # noqa: E402

log = logging.getLogger(__name__)

EPS = 1e-9
TAX_RATE_PROXY = 0.21


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


# ---------- correlation ----------

def correlation_matrix(prices: dict, *, window: int = config.CORRELATION_WINDOW) -> dict:
    """Build a Pearson-correlation matrix over the most recent `window`
    overlapping trading days. Returns the JSON shape expected for
    correlations.json."""
    blocks = prices.get("data") or {}

    # Align series on a shared trailing date window.
    series_by_ticker: dict[str, dict[str, float]] = {}
    all_dates: list[set[str]] = []
    for ticker, block in blocks.items():
        if not isinstance(block, dict):
            continue
        dates = block.get("dates") or []
        closes = block.get("close") or []
        if len(dates) != len(closes) or not dates:
            continue
        # Only the trailing window — saves memory and gives recent-correlation focus.
        d = dates[-window:]
        c = closes[-window:]
        series_by_ticker[ticker] = dict(zip(d, c))
        all_dates.append(set(d))

    if not series_by_ticker:
        return {
            "version": config.DATA_VERSION_SCHEMA,
            "generated_at": _now_iso(),
            "as_of": None,
            "window_days": window,
            "tickers": [],
            "matrix": [],
        }

    common = set.intersection(*all_dates) if all_dates else set()
    common_sorted = sorted(common)[-window:]
    if len(common_sorted) < 30:
        log.warning("only %d overlapping price dates — correlations will be noisy", len(common_sorted))

    tickers = sorted(series_by_ticker.keys())
    if not common_sorted or len(tickers) < 2:
        return {
            "version": config.DATA_VERSION_SCHEMA,
            "generated_at": _now_iso(),
            "as_of": common_sorted[-1] if common_sorted else None,
            "window_days": window,
            "tickers": tickers,
            "matrix": [[1.0]] if len(tickers) == 1 else [],
        }

    closes = np.array(
        [[series_by_ticker[t][d] for d in common_sorted] for t in tickers],
        dtype=float,
    )
    # log returns: more stable than raw price correlation.
    returns = np.diff(np.log(closes), axis=1)
    if returns.shape[1] < 2:
        identity = np.eye(len(tickers))
        matrix = identity.tolist()
    else:
        matrix = np.corrcoef(returns).tolist()

    # Round to keep output small and stable.
    matrix = [[round(float(v), 4) for v in row] for row in matrix]
    return {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "as_of": common_sorted[-1],
        "window_days": window,
        "tickers": tickers,
        "matrix": matrix,
    }


# ---------- per-ticker derived ----------

def _ttm_revenue(quarters: list[dict]) -> float | None:
    if len(quarters) < 4:
        return None
    vals = [q.get("revenue") for q in quarters[:4]]
    if any(v is None for v in vals):
        return None
    return float(sum(vals))


def _ttm_net_income(quarters: list[dict]) -> float | None:
    if len(quarters) < 4:
        return None
    vals = [q.get("net_income") for q in quarters[:4]]
    if any(v is None for v in vals):
        return None
    return float(sum(vals))


def _ttm_fcf(quarters: list[dict]) -> float | None:
    if len(quarters) < 4:
        return None
    vals = [q.get("free_cash_flow") for q in quarters[:4]]
    if any(v is None for v in vals):
        return None
    return float(sum(vals))


def _rev_growth_yoy(quarters: list[dict]) -> float | None:
    if len(quarters) < 5:
        return None
    cur = quarters[0].get("revenue")
    prior = quarters[4].get("revenue")
    if cur is None or prior in (None, 0):
        return None
    return round(float(cur) / float(prior) - 1.0, 4)


def _last_close(prices_block: dict | None) -> float | None:
    if not isinstance(prices_block, dict):
        return None
    closes = prices_block.get("close") or []
    return float(closes[-1]) if closes else None


def _pe_history(quarters: list[dict], prices_block: dict | None, window_quarters: int) -> list[float]:
    """Reconstructs a rolling PE series. For each quarter in the lookback,
    PE = current_close (we approximate with the close on quarter-end date) /
    TTM-EPS-as-of-that-quarter. Quarters with missing inputs are skipped."""
    if not isinstance(prices_block, dict):
        return []
    dates = prices_block.get("dates") or []
    closes = prices_block.get("close") or []
    if len(dates) != len(closes) or not dates:
        return []
    close_by_date = dict(zip(dates, closes))
    history: list[float] = []
    for i in range(min(window_quarters, len(quarters) - 4)):
        # TTM EPS sum of quarters i..i+3
        ttm_eps_parts = [q.get("eps") for q in quarters[i : i + 4]]
        if any(v is None for v in ttm_eps_parts):
            continue
        ttm_eps = sum(ttm_eps_parts)
        if abs(ttm_eps) < EPS:
            continue
        q_end = quarters[i].get("fiscal_date_ending")
        # Find nearest available close on/before q_end.
        c = _close_on_or_before(close_by_date, q_end)
        if c is None:
            continue
        history.append(c / ttm_eps)
    return history


def _close_on_or_before(close_by_date: dict[str, float], target: str | None) -> float | None:
    if not target:
        return None
    if target in close_by_date:
        return close_by_date[target]
    # Linear scan for a date string match — small N, no need for bisect.
    candidates = [d for d in close_by_date if d <= target]
    if not candidates:
        return None
    return close_by_date[max(candidates)]


def derive_for_ticker(quarters: list[dict], prices_block: dict | None) -> dict:
    ttm_rev = _ttm_revenue(quarters)
    ttm_ni = _ttm_net_income(quarters)
    ttm_fcf_v = _ttm_fcf(quarters)
    last_close = _last_close(prices_block)
    shares = quarters[0].get("shares_outstanding") if quarters else None
    eps_ttm = (ttm_ni / shares) if (ttm_ni is not None and shares) else None
    pe_ttm = (last_close / eps_ttm) if (last_close is not None and eps_ttm and abs(eps_ttm) > EPS) else None

    pe_hist = _pe_history(quarters, prices_block, window_quarters=20)
    pe_z = None
    if pe_ttm is not None and len(pe_hist) >= 5:
        mean = statistics.fmean(pe_hist)
        try:
            stdev = statistics.stdev(pe_hist)
        except statistics.StatisticsError:
            stdev = 0
        if stdev > EPS:
            pe_z = round((pe_ttm - mean) / stdev, 4)

    return {
        "pe_ttm": round(pe_ttm, 4) if pe_ttm is not None else None,
        "pe_z_score_5y": pe_z,
        "rev_growth_yoy": _rev_growth_yoy(quarters),
        "fcf_margin": (round(ttm_fcf_v / ttm_rev, 4) if (ttm_fcf_v is not None and ttm_rev) else None),
        "ttm_revenue": ttm_rev,
        "ttm_net_income": ttm_ni,
        "ttm_fcf": ttm_fcf_v,
        "eps_ttm": round(eps_ttm, 4) if eps_ttm is not None else None,
    }


# ---------- sector aggregates ----------

def sector_aggregates(universe: dict, fundamentals: dict) -> dict:
    rows = (universe or {}).get("tickers") or []
    by_sector: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        if not isinstance(r, dict):
            continue
        sector = r.get("sector")
        if not sector:
            continue
        block = (fundamentals.get("data") or {}).get(r["ticker"]) or {}
        derived = block.get("derived") or {}
        by_sector[sector].append(
            {
                "ticker": r["ticker"],
                "market_cap": r.get("market_cap") or 0,
                "pe_ttm": derived.get("pe_ttm"),
                "rev_growth_yoy": derived.get("rev_growth_yoy"),
            }
        )

    out_sectors: dict[str, dict] = {}
    for sector, members in by_sector.items():
        pes = [m["pe_ttm"] for m in members if m["pe_ttm"] is not None and m["pe_ttm"] > 0]
        growths = [m["rev_growth_yoy"] for m in members if m["rev_growth_yoy"] is not None]
        weighted_mc = sum(m["market_cap"] for m in members)
        out_sectors[sector] = {
            "members": sorted(m["ticker"] for m in members),
            "median_pe_ttm": round(statistics.median(pes), 2) if pes else None,
            "median_pe_5y": None,  # historical sector medians require more memory; punt for v1
            "weighted_market_cap": weighted_mc,
            "median_rev_growth_yoy": round(statistics.median(growths), 4) if growths else None,
        }
    return {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "as_of": today_utc().isoformat(),
        "sectors": out_sectors,
    }


# ---------- per-stock metric pages ----------

METRIC_CATALOG: list[tuple[str, str, str, str, bool]] = [
    # (key, label, category, format, is_flow)
    ("revenue", "Revenue", "Growth", "currency", True),
    ("net_income", "Net Income", "Growth", "currency", True),
    ("eps", "EPS", "Growth", "perShare", True),
    ("gross_margin", "Gross Margin", "Profitability", "percent", False),
    ("op_margin", "Op Margin", "Profitability", "percent", False),
    ("net_margin", "Net Margin", "Profitability", "percent", False),
    ("roe", "ROE", "Returns", "percent", False),
    ("roa", "ROA", "Returns", "percent", False),
    ("roic", "ROIC", "Returns", "percent", False),
    ("fcf", "Free Cash Flow", "Quality", "currency", True),
    ("pe", "P/E", "Valuation", "ratio", False),
]


def _safe_div(num: float | None, den: float | None) -> float | None:
    if num is None or den is None or not isinstance(den, (int, float)) or den == 0:
        return None
    return num / den


def _sum_nonnull(values: list[float | None]) -> float | None:
    s = 0.0
    for v in values:
        if v is None:
            return None
        s += v
    return s


def _quarter_value(q: dict, key: str, oldest_to_newest_window: list[dict]) -> float | None:
    """Compute the value of a given metric at this quarter.
    oldest_to_newest_window is the slice of the 4 most recent quarters
    relative to this one (inclusive), used for TTM-based ratios."""
    if key == "revenue":
        return q.get("revenue")
    if key == "net_income":
        return q.get("net_income")
    if key == "eps":
        return q.get("eps")
    if key == "fcf":
        return q.get("free_cash_flow")
    if key == "gross_margin":
        return _safe_div(q.get("gross_profit"), q.get("revenue"))
    if key == "op_margin":
        return q.get("operating_margin")
    if key == "net_margin":
        return _safe_div(q.get("net_income"), q.get("revenue"))
    if key == "roe":
        if len(oldest_to_newest_window) < 4:
            return None
        ni_ttm = _sum_nonnull([w.get("net_income") for w in oldest_to_newest_window])
        return _safe_div(ni_ttm, q.get("total_equity"))
    if key == "roa":
        if len(oldest_to_newest_window) < 4:
            return None
        ni_ttm = _sum_nonnull([w.get("net_income") for w in oldest_to_newest_window])
        return _safe_div(ni_ttm, q.get("total_assets"))
    if key == "roic":
        if len(oldest_to_newest_window) < 4:
            return None
        op_ttm = _sum_nonnull([w.get("operating_income") for w in oldest_to_newest_window])
        nopat = None if op_ttm is None else op_ttm * (1 - TAX_RATE_PROXY)
        eq = q.get("total_equity")
        debt = q.get("total_debt")
        cash = q.get("cash")
        invested = (
            eq + debt - cash
            if eq is not None and debt is not None and cash is not None
            else None
        )
        return _safe_div(nopat, invested)
    return None


def _pe_series_oldest_to_newest(
    quarters_newest_first: list[dict], prices_block: dict | None
) -> list[dict]:
    """For each quarter, compute close-on-quarter-end / TTM-EPS-ending-at-that-quarter."""
    def _empty(q: dict) -> dict:
        return {"period": q.get("period"), "fiscalDate": q.get("fiscal_date_ending"), "value": None}

    if not isinstance(prices_block, dict):
        return [_empty(q) for q in reversed(quarters_newest_first)]
    dates = prices_block.get("dates") or []
    closes = prices_block.get("close") or []
    if len(dates) != len(closes) or not dates:
        return [_empty(q) for q in reversed(quarters_newest_first)]
    close_by_date = dict(zip(dates, closes))

    out_newest_first: list[dict] = []
    for i, q in enumerate(quarters_newest_first):
        period = q.get("period")
        # TTM EPS at this quarter sums quarters[i..i+3] (this + 3 older).
        parts = [quarters_newest_first[j].get("eps") for j in range(i, min(i + 4, len(quarters_newest_first)))]
        ttm_eps = _sum_nonnull(parts) if len(parts) == 4 else None
        c = _close_on_or_before(close_by_date, q.get("fiscal_date_ending"))
        pe = None
        if ttm_eps is not None and abs(ttm_eps) > EPS and c is not None:
            pe = c / ttm_eps
        out_newest_first.append({
            "period": period,
            "fiscalDate": q.get("fiscal_date_ending"),
            "value": pe,
        })
    out_newest_first.reverse()
    return out_newest_first


def _metric_series_oldest_to_newest(
    key: str, quarters_newest_first: list[dict], prices_block: dict | None
) -> list[dict]:
    if key == "pe":
        return _pe_series_oldest_to_newest(quarters_newest_first, prices_block)
    ordered = list(reversed(quarters_newest_first))  # oldest → newest
    out: list[dict] = []
    for i, q in enumerate(ordered):
        window = ordered[max(0, i - 3) : i + 1]
        value = _quarter_value(q, key, window)
        out.append({
            "period": q.get("period"),
            "fiscalDate": q.get("fiscal_date_ending"),
            "value": value,
        })
    return out


def _ttm_series(series: list[dict], is_flow: bool) -> list[dict]:
    """Build a parallel oldest→newest series where each value is the rolling
    last-4-quarter aggregate of the underlying quarterly series. Flow metrics
    sum, ratios/margins average. The first 3 entries are null (not enough
    history) but keep their period/fiscalDate so the chart still anchors
    them to the date-axis."""
    out: list[dict] = []
    for i, point in enumerate(series):
        window_vals = [p.get("value") for p in series[max(0, i - 3) : i + 1]]
        if i < 3 or any(v is None for v in window_vals):
            value: float | None = None
        elif is_flow:
            value = sum(window_vals)  # type: ignore[arg-type]
        else:
            value = sum(window_vals) / 4  # type: ignore[operator]
        out.append({
            "period": point.get("period"),
            "fiscalDate": point.get("fiscalDate"),
            "value": value,
        })
    return out


def _compute_stats(series: list[dict], is_flow: bool) -> dict:
    """Computes current, qoq, yoy, cagr5y, avg5y, peak, low, started
    from an oldest→newest series."""
    n = len(series)
    empty = {
        "current": None,
        "qoq": None,
        "yoy": None,
        "cagr5y": None,
        "avg5y": None,
        "peak": None,
        "low": None,
        "started": None,
    }
    if n == 0:
        return empty

    current = series[-1]["value"]
    prev = series[-2]["value"] if n >= 2 else None
    yoy_ref = series[-5]["value"] if n >= 5 else None

    def _ratio(a: float | None, b: float | None) -> float | None:
        if a is None or b is None or b == 0:
            return None
        return a / b - 1

    qoq = _ratio(current, prev)
    yoy = _ratio(current, yoy_ref)

    non_null_points = [p for p in series if p["value"] is not None]
    non_null_values = [p["value"] for p in non_null_points]

    cagr5y: float | None = None
    if len(non_null_values) >= 8:
        first = non_null_values[0]
        last = non_null_values[-1]
        if first > 0 and last > 0:
            years = (len(non_null_values) - 1) / 4
            if years > 0:
                cagr5y = (last / first) ** (1 / years) - 1

    avg5y = (
        sum(non_null_values) / len(non_null_values) if non_null_values else None
    )

    peak_pt: dict | None = None
    low_pt: dict | None = None
    started_pt: dict | None = None
    if non_null_points:
        peak_pt = max(non_null_points, key=lambda p: p["value"])
        low_pt = min(non_null_points, key=lambda p: p["value"])
        started_pt = non_null_points[0]

    return {
        "current": current,
        "qoq": qoq,
        "yoy": yoy,
        "cagr5y": cagr5y,
        "avg5y": avg5y,
        "peak": {"period": peak_pt["period"], "value": peak_pt["value"]} if peak_pt else None,
        "low": {"period": low_pt["period"], "value": low_pt["value"]} if low_pt else None,
        "started": {"period": started_pt["period"], "value": started_pt["value"]} if started_pt else None,
    }


def write_stock_pages(
    universe: dict, fundamentals: dict, prices: dict
) -> dict:
    """Write per-ticker metadata + per-metric JSON files under public/data/stocks/."""
    out_root = config.DATA_DIR / "stocks"
    out_root.mkdir(parents=True, exist_ok=True)

    f_data = fundamentals.get("data") or {}
    p_data = prices.get("data") or {}
    profiles_by_ticker = {
        r["ticker"]: r for r in (universe.get("tickers") or []) if isinstance(r, dict)
    }

    # Load tickers.json overrides (manual_sector + declared currency).
    overrides: dict[str, dict] = {}
    try:
        from pipeline.runner import load_universe_meta

        for entry in load_universe_meta():
            overrides[entry["ticker"]] = entry
    except Exception as exc:  # noqa: BLE001
        log.warning("ticker overrides load failed: %s", exc)

    # Load per-ticker sector overrides (GICS sectors fetched from Wikipedia
    # for the SP500 + manual entries for international holdings).
    sector_overrides: dict[str, str] = {}
    sector_file = config.PIPELINE_DIR / "sector_overrides.json"
    if sector_file.exists():
        try:
            raw = read_json(sector_file, default={}) or {}
            if isinstance(raw, dict):
                sector_overrides = {k.upper(): v for k, v in raw.items() if isinstance(v, str)}
        except Exception as exc:  # noqa: BLE001
            log.warning("sector_overrides load failed: %s", exc)

    written = 0
    for ticker, block in f_data.items():
        if not isinstance(block, dict):
            continue
        quarters = block.get("quarters") or []
        prices_block = p_data.get(ticker)
        profile = profiles_by_ticker.get(ticker, {})
        derived = block.get("derived") or {}

        # Per-ticker metadata.json
        last_close = _last_close(prices_block)
        return1d = _return_over_days(prices_block, 1)
        return1m = _return_over_days(prices_block, 21)
        return1y = _return_over_days(prices_block, 252)
        return5y = _return_over_days(prices_block, 252 * 5)
        ticker_dir = out_root / ticker
        (ticker_dir / "metrics").mkdir(parents=True, exist_ok=True)
        override = overrides.get(ticker, {})
        sector = (
            profile.get("sector")
            or override.get("manual_sector")
            or sector_overrides.get(ticker.upper())
        )
        if not sector:
            log.warning("no sector for %s — falling back to Unknown", ticker)
        currency = profile.get("currency") or override.get("currency") or "USD"
        # Preserve brand_color + logo_path from a prior compute_brand_colors
        # run, since this helper rewrites metadata.json from scratch each
        # time. Without this, brand colour gets wiped on every re-run.
        existing = read_json(ticker_dir / "metadata.json", default=None) or {}
        quarters_with_revenue = sum(
            1 for q in quarters if isinstance(q, dict) and q.get("revenue") is not None
        )
        new_metadata: dict = {
            "ticker": ticker,
            "name": profile.get("name") or override.get("name") or ticker,
            "sector": sector,
            "industry": profile.get("industry"),
            "marketCap": profile.get("market_cap"),
            "currency": currency,
            "price": last_close,
            "return1d": return1d,
            "return1m": return1m,
            "return1y": return1y,
            "return5y": return5y,
            "currentPe": derived.get("pe_ttm"),
            "lastUpdate": today_utc().isoformat(),
            "quartersAvailable": quarters_with_revenue,
            "provider": block.get("source") or "unknown",
        }
        for k in ("brand_color", "logo_path"):
            if k in existing:
                new_metadata[k] = existing[k]
        write_json(ticker_dir / "metadata.json", new_metadata)

        # Ship the full daily price series as a per-ticker file so the chart
        # can render a true daily line client-side with range-aware
        # downsampling. The metric JSONs no longer carry priceSeries.
        if isinstance(prices_block, dict):
            dates = prices_block.get("dates") or []
            closes = prices_block.get("close") or []
            if dates and closes and len(dates) == len(closes):
                write_json(
                    ticker_dir / "prices.json",
                    {
                        "ticker": ticker,
                        "dates": dates,
                        "close": [float(c) if c is not None else None for c in closes],
                    },
                )

        # One file per metric, with both quarterly + TTM views nested under
        # `views` so the frontend toggles between them without recomputing.
        for key, label, category, fmt, is_flow in METRIC_CATALOG:
            quarterly_series = _metric_series_oldest_to_newest(key, quarters, prices_block)
            ttm_series = _ttm_series(quarterly_series, is_flow)
            quarterly_stats = _compute_stats(quarterly_series, is_flow)
            ttm_stats = _compute_stats(ttm_series, is_flow)
            last_reported = quarters[0].get("fiscal_date_ending") if quarters else None
            write_json(
                ticker_dir / "metrics" / f"{key}.json",
                {
                    "metric": key,
                    "label": label,
                    "category": category,
                    "format": fmt,
                    "isFlow": is_flow,
                    "currency": currency,
                    "lastReportedDate": last_reported,
                    "views": {
                        "quarterly": {**quarterly_stats, "series": quarterly_series},
                        "ttm": {**ttm_stats, "series": ttm_series},
                    },
                },
            )
        written += 1

    return {"stock_pages_written": written}


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


# ---------- orchestration of the compute step ----------

def run() -> dict:
    universe = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {"tickers": []}
    prices = read_json(config.PRICES_JSON, default={"data": {}}) or {"data": {}}
    fundamentals = read_json(config.FUNDAMENTALS_JSON, default={"data": {}}) or {"data": {}}

    # Derived per-ticker block.
    f_data = fundamentals.get("data") or {}
    p_data = prices.get("data") or {}
    for ticker, block in f_data.items():
        if not isinstance(block, dict):
            continue
        block["derived"] = derive_for_ticker(block.get("quarters") or [], p_data.get(ticker))
    fundamentals = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "data": f_data,
    }
    write_json(config.FUNDAMENTALS_JSON, fundamentals)

    # Correlation matrix.
    corr = correlation_matrix(prices)
    write_json(config.CORRELATIONS_JSON, corr)

    # Sector aggregates.
    sectors = sector_aggregates(universe, fundamentals)
    write_json(config.SECTORS_JSON, sectors)

    # Per-stock metric pages.
    stock_summary = write_stock_pages(universe, fundamentals, prices)

    return {
        "tickers_with_derived": sum(
            1 for b in f_data.values() if isinstance(b, dict) and b.get("derived")
        ),
        "correlation_pairs": len(corr.get("tickers") or []),
        "sectors": len(sectors.get("sectors") or {}),
        **stock_summary,
    }


# ---------- metadata.json ----------

def write_metadata(*, mode: str, provider_counts: dict, fmp_used: int, ticker_count: int) -> None:
    payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "data_version": today_utc().isoformat(),
        "ticker_count": ticker_count,
        "mode": mode,
        "providers": provider_counts,
        "fmp_calls_used_today": fmp_used,
        "fmp_quota_daily": config.FMP_DAILY_QUOTA,
        "next_quarterly_due": _next_quarterly_due(),
        "git_sha": _git_sha(),
    }
    write_json(config.METADATA_JSON, payload)


def _next_quarterly_due() -> str:
    today = today_utc()
    if today.month == 12:
        nxt = date(today.year + 1, 1, 1)
    else:
        nxt = date(today.year, today.month + 1, 1)
    return nxt.isoformat()


def _git_sha() -> str | None:
    try:
        out = subprocess.run(
            ["git", "rev-parse", "--short", "HEAD"],
            capture_output=True, text=True, timeout=5, cwd=str(config.REPO_ROOT),
        )
        if out.returncode == 0:
            return out.stdout.strip()
    except (OSError, subprocess.TimeoutExpired):
        pass
    return None


if __name__ == "__main__":
    setup_logging()
    summary = run()
    log.info("compute_derived summary: %s", summary)
