"""SPY options-chain pull + GEX computation. Writes public/data/market/gex.json.
Non-fatal failure: orchestrate.py catches and logs; dashboard graceful-degrades."""
from __future__ import annotations

import logging
import math
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import compute_gex, config  # noqa: E402
from pipeline.io_utils import setup_logging, today_utc, write_json  # noqa: E402

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _is_third_friday(d: date) -> bool:
    return d.weekday() == 4 and 15 <= d.day <= 21


def _filter_expiries(
    raw: tuple[str, ...] | list[str], today: date
) -> list[str]:
    """Keep monthly (3rd Friday) expirations within 0-90 days, plus next
    ~3 quarterly (Mar/Jun/Sep/Dec) expirations beyond 90d."""
    monthlies: list[str] = []
    quarterlies: list[str] = []
    for s in raw:
        try:
            d = date.fromisoformat(s)
        except ValueError:
            continue
        if not _is_third_friday(d):
            continue
        days = (d - today).days
        if days <= 0:
            continue
        if days <= 90:
            monthlies.append(s)
        elif d.month in (3, 6, 9, 12):
            quarterlies.append(s)
    monthlies.sort()
    quarterlies.sort()
    return monthlies + quarterlies[:3]


def _risk_free_rate() -> float:
    """13-week T-bill yield (^IRX) as decimal. Falls back to 0.045 on failure."""
    try:
        import yfinance

        hist = yfinance.Ticker("^IRX").history(period="5d")
        if hist is None or hist.empty:
            return 0.045
        close = float(hist["Close"].iloc[-1])
        if not math.isfinite(close) or close <= 0:
            return 0.045
        return close / 100.0
    except Exception as exc:  # noqa: BLE001
        log.warning("^IRX fetch failed (%s); using fallback 4.5%%", exc)
        return 0.045


def _spot() -> float:
    import yfinance

    hist = yfinance.Ticker("SPY").history(period="2d")
    if hist is None or hist.empty:
        raise RuntimeError("SPY history empty")
    return float(hist["Close"].iloc[-1])


def _collect_contracts(today: date) -> tuple[list[dict], list[str]]:
    import yfinance

    tk = yfinance.Ticker("SPY")
    expiries = _filter_expiries(tk.options or [], today)
    if not expiries:
        return [], []

    out: list[dict] = []
    for expiry in expiries:
        T = (date.fromisoformat(expiry) - today).days / 365.25
        if T <= 0:
            continue
        try:
            chain = tk.option_chain(expiry)
        except Exception as exc:  # noqa: BLE001
            log.warning("chain fetch failed for %s: %s", expiry, exc)
            continue
        for typ, df in (("call", chain.calls), ("put", chain.puts)):
            if df is None or df.empty:
                continue
            for _, row in df.iterrows():
                oi = row.get("openInterest")
                iv = row.get("impliedVolatility")
                if oi is None or oi < 100:
                    continue
                try:
                    iv_f = float(iv)
                except (TypeError, ValueError):
                    continue
                if not math.isfinite(iv_f) or iv_f <= 0:
                    continue
                try:
                    strike = float(row.get("strike"))
                except (TypeError, ValueError):
                    continue
                out.append(
                    {
                        "strike": strike,
                        "type": typ,
                        "oi": int(oi),
                        "iv": iv_f,
                        "T": T,
                        "expiry": expiry,
                    }
                )
    return out, expiries


def run() -> dict:
    today = today_utc()
    spot = _spot()
    rate = _risk_free_rate()
    contracts, expiries = _collect_contracts(today)
    if not contracts:
        log.warning("no SPY contracts passed filters; skipping GEX write")
        return {"strikes": 0, "expirations": 0, "aggregate_gex": None}

    profile = compute_gex.aggregate_profile(contracts, spot, rate, bucket=5.0)
    aggregate = sum(p["gex_total"] for p in profile)
    flip = compute_gex.find_flip_level(profile, spot)
    call_wall = compute_gex.find_call_wall(profile, spot)
    put_wall = compute_gex.find_put_wall(profile, spot)

    payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "as_of": today.isoformat(),
        "fetched_at": _now_iso(),
        "spy_spot": round(spot, 2),
        "risk_free_rate": round(rate, 4),
        "aggregate_gex": aggregate,
        "flip_level": round(flip, 2) if flip is not None else None,
        "call_wall": call_wall,
        "put_wall": put_wall,
        "profile": [
            {
                "strike": p["strike"],
                "gex_total": p["gex_total"],
                "gex_call": p["gex_call"],
                "gex_put": p["gex_put"],
            }
            for p in profile
        ],
        "expirations_used": expiries,
    }
    config.MARKET_DIR.mkdir(parents=True, exist_ok=True)
    write_json(config.MARKET_GEX_JSON, payload)

    log.info(
        "gex pull complete · strikes=%d expirations=%d aggregate=%.2e",
        len(profile),
        len(expiries),
        aggregate,
    )
    return {
        "strikes": len(profile),
        "expirations": len(expiries),
        "aggregate_gex": aggregate,
        "flip_level": payload["flip_level"],
    }


def main() -> None:
    setup_logging()
    summary = run()
    log.info("summary: %s", summary)


if __name__ == "__main__":
    main()
