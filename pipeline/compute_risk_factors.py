"""Two-factor risk model: market + sector-residual. For each ticker we run
OLS of daily log returns on (1) the equal-weighted universe return and
(2) its sector's mean return minus that universe return — giving an
orthogonal-ish 'sector tilt' factor. Output: betas + idiosyncratic std
+ factor variances so the dashboard can decompose portfolio risk."""
from __future__ import annotations

import logging
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, write_json  # noqa: E402

log = logging.getLogger(__name__)

RISK_FACTORS_JSON = config.DATA_DIR / "risk_factors.json"
WINDOW = config.CORRELATION_WINDOW  # 252 trading days
MIN_OVERLAP = 60  # tickers with fewer overlapping days are skipped


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _sector_map(universe: dict) -> dict[str, str]:
    out: dict[str, str] = {}
    for entry in universe.get("tickers") or []:
        t = entry.get("ticker")
        s = entry.get("sector")
        if t and isinstance(s, str) and s:
            out[t] = s
    return out


def build_risk_factors(prices: dict, universe: dict, *, window: int = WINDOW) -> dict:
    blocks = prices.get("data") or {}
    sector_by_ticker = _sector_map(universe)

    # Collect aligned trailing returns per ticker.
    series: dict[str, dict[str, float]] = {}
    for ticker, block in blocks.items():
        if not isinstance(block, dict):
            continue
        dates = block.get("dates") or []
        closes = block.get("close") or []
        if len(dates) != len(closes) or len(dates) < 2:
            continue
        d = dates[-(window + 1):]
        c = closes[-(window + 1):]
        if len(d) < MIN_OVERLAP:
            continue
        rets: dict[str, float] = {}
        for i in range(1, len(d)):
            p0 = c[i - 1]
            p1 = c[i]
            if p0 and p1 and p0 > 0 and p1 > 0:
                rets[d[i]] = float(np.log(p1 / p0))
        if len(rets) >= MIN_OVERLAP:
            series[ticker] = rets

    if not series:
        return _empty(window)

    # Common date axis = union of dates seen, then we mask missing values
    # as NaN per ticker so we can use one matrix for everything.
    all_dates_set: set[str] = set()
    for r in series.values():
        all_dates_set.update(r.keys())
    dates_sorted = sorted(all_dates_set)[-window:]
    if len(dates_sorted) < MIN_OVERLAP:
        return _empty(window)

    tickers = sorted(series.keys())
    n_t = len(tickers)
    n_d = len(dates_sorted)

    R = np.full((n_t, n_d), np.nan, dtype=float)
    for i, t in enumerate(tickers):
        rets = series[t]
        for j, d in enumerate(dates_sorted):
            v = rets.get(d)
            if v is not None:
                R[i, j] = v

    # Market factor: equal-weighted mean across tickers (ignoring NaN).
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=RuntimeWarning)
        market = np.nanmean(R, axis=0)
    # Replace any NaN day in market (shouldn't happen if any ticker has data) with 0.
    market = np.where(np.isfinite(market), market, 0.0)

    # Sector means → residualised to be ~orthogonal to market.
    sectors_in_use = sorted({sector_by_ticker[t] for t in tickers if t in sector_by_ticker})
    sector_index = {s: i for i, s in enumerate(sectors_in_use)}

    sector_factor = np.zeros((len(sectors_in_use), n_d), dtype=float)
    for s in sectors_in_use:
        rows = [tickers.index(t) for t in tickers if sector_by_ticker.get(t) == s]
        if not rows:
            continue
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", category=RuntimeWarning)
            sec_mean = np.nanmean(R[rows], axis=0)
        sec_mean = np.where(np.isfinite(sec_mean), sec_mean, 0.0)
        # Residualise vs market via simple OLS to remove the market component.
        m_var = float(np.var(market))
        if m_var > 1e-12:
            beta_sm = float(np.cov(sec_mean, market, ddof=0)[0, 1] / m_var)
        else:
            beta_sm = 0.0
        sector_factor[sector_index[s]] = sec_mean - beta_sm * market

    # Per-ticker OLS regression on (market, own sector residual).
    market_var = float(np.var(market))
    factors: dict[str, dict[str, float]] = {}
    for i, ticker in enumerate(tickers):
        row = R[i]
        finite = np.isfinite(row)
        if int(finite.sum()) < MIN_OVERLAP:
            continue
        y = row[finite]
        m = market[finite]

        sec = sector_by_ticker.get(ticker)
        if sec is not None and sec in sector_index:
            s_row = sector_factor[sector_index[sec], finite]
        else:
            s_row = None

        # Build design matrix [1, market, sector_residual?]
        if s_row is not None and float(np.var(s_row)) > 1e-12:
            X = np.column_stack([np.ones_like(y), m, s_row])
        else:
            X = np.column_stack([np.ones_like(y), m])

        try:
            coef, *_ = np.linalg.lstsq(X, y, rcond=None)
        except np.linalg.LinAlgError:
            continue
        alpha = float(coef[0])
        beta_m = float(coef[1])
        beta_s = float(coef[2]) if X.shape[1] == 3 else 0.0
        resid = y - X @ coef
        idio_std = float(np.std(resid, ddof=1)) if len(resid) > 2 else float(np.std(resid))

        # R² for transparency.
        ss_tot = float(np.var(y) * len(y))
        ss_res = float(np.sum(resid * resid))
        r2 = 0.0 if ss_tot <= 1e-12 else max(0.0, 1.0 - ss_res / ss_tot)

        factors[ticker] = {
            "alpha": round(alpha, 8),
            "beta_market": round(beta_m, 4),
            "beta_sector": round(beta_s, 4),
            "idio_std": round(idio_std, 6),
            "r2": round(r2, 4),
            "sector": sec,
            "n": int(finite.sum()),
        }

    # Variances of factors (for the frontend's variance decomp).
    sector_vars: dict[str, float] = {}
    for s, idx in sector_index.items():
        sector_vars[s] = round(float(np.var(sector_factor[idx])), 8)

    payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "as_of": dates_sorted[-1],
        "window_days": window,
        "market_var": round(market_var, 8),
        "market_std": round(float(np.std(market)), 6),
        "sector_var": sector_vars,
        "factors": factors,
    }
    return payload


def _empty(window: int) -> dict:
    return {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "as_of": None,
        "window_days": window,
        "market_var": 0.0,
        "market_std": 0.0,
        "sector_var": {},
        "factors": {},
    }


def run() -> dict:
    universe = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {"tickers": []}
    prices = read_json(config.PRICES_JSON, default={"data": {}}) or {"data": {}}
    payload = build_risk_factors(prices, universe)
    write_json(RISK_FACTORS_JSON, payload)
    return {
        "tickers": len(payload.get("factors") or {}),
        "sectors": len(payload.get("sector_var") or {}),
        "as_of": payload.get("as_of"),
    }


if __name__ == "__main__":
    setup_logging()
    summary = run()
    log.info("risk_factors complete: %s", summary)
