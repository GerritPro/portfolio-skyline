"""Frankfurter API daily FX pull. Writes public/data/fx.json with current
EUR-based rates + 5y history. No API key, no rate-limit stress."""
from __future__ import annotations

import json
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import setup_logging, today_utc, write_json  # noqa: E402

log = logging.getLogger(__name__)

PAIRS: list[str] = ["USD", "GBP", "JPY", "HKD", "CHF", "CAD", "AUD", "CNY"]
USER_AGENT = "portfolio-skyline-pipeline (contact: github.com/gelle/portfolio-skyline)"


@retry(
    retry=retry_if_exception_type(requests.RequestException),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
def _http_get_json(url: str) -> dict:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT}, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run() -> dict:
    today: date = today_utc()
    rates: dict[str, float] = {"EUR": 1.0}
    history: dict[str, list[dict]] = {}

    for src in PAIRS:
        try:
            latest = _http_get_json(f"https://api.frankfurter.app/latest?from={src}&to=EUR")
            rate = float(latest.get("rates", {}).get("EUR"))
        except Exception as exc:  # noqa: BLE001
            log.warning("FX latest failed for %s/EUR: %s", src, exc)
            continue
        rates[src] = rate

        try:
            start = (today - timedelta(days=5 * 365)).isoformat()
            end = today.isoformat()
            hist_resp = _http_get_json(
                f"https://api.frankfurter.app/{start}..{end}?from={src}&to=EUR"
            )
            entries = sorted((hist_resp.get("rates") or {}).items())
            history[src] = [
                {"date": d, "rate": float(vals.get("EUR"))}
                for d, vals in entries
                if isinstance(vals, dict) and vals.get("EUR") is not None
            ]
        except Exception as exc:  # noqa: BLE001
            log.warning("FX history failed for %s/EUR: %s", src, exc)
            history[src] = []

    payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "as_of": today.isoformat(),
        "fetched_at": _now_iso(),
        "base": "EUR",
        "rates": rates,
        "history": history,
    }
    write_json(config.FX_JSON, payload)
    log.info("fx pull complete · rates=%d history=%d", len(rates), len(history))
    return {"rates": len(rates), "currencies": list(rates.keys())}


def main() -> None:
    setup_logging()
    summary = run()
    log.info("summary: %s", summary)


if __name__ == "__main__":
    main()


# Import-only side-effect avoidance for python -c imports.
__all__ = ["run"]

# Defensive: json import used by retry edge-cases that paste JSON into logs.
_JSON_USED = json
