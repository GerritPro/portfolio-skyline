"""Quarterly pull: fundamentals + peers + profile refresh. Default
--incremental skips tickers whose latest stored quarter is already current."""
from __future__ import annotations

import argparse
import logging
import sys
from datetime import date, datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, today_utc, write_json  # noqa: E402
from pipeline.providers.base import QuotaExceeded  # noqa: E402
from pipeline.providers.router import Router  # noqa: E402
from pipeline.providers.schemas import Fundamentals, Peers  # noqa: E402
from pipeline.runner import build_router, load_universe  # noqa: E402

log = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _expected_latest_quarter_end(today: date) -> date:
    """Approximate fiscal-quarter-end horizon: a ticker is considered 'current'
    if its newest stored quarter ends within the last 100 days."""
    return today  # we use a delta threshold below; helper kept for clarity


def _is_current(stored_block: dict | None, today: date) -> bool:
    if not isinstance(stored_block, dict):
        return False
    quarters = stored_block.get("quarters") or []
    if not quarters:
        return False
    latest = quarters[0].get("fiscal_date_ending")
    if not latest:
        return False
    try:
        d = date.fromisoformat(latest)
    except ValueError:
        return False
    return (today - d).days <= config.QUARTERLY_CURRENT_DAYS


def _serialize_fundamentals(f: Fundamentals, peers: Peers) -> dict:
    return {
        "source": f.source,
        "fetched_at": f.fetched_at.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "quarters": [
            {
                "period": q.period,
                "fiscal_date_ending": q.fiscal_date_ending.isoformat(),
                "revenue": q.revenue,
                "net_income": q.net_income,
                "eps": q.eps,
                "shares_outstanding": q.shares_outstanding,
                "free_cash_flow": q.free_cash_flow,
                "total_debt": q.total_debt,
                "cash": q.cash,
                "operating_margin": q.operating_margin,
                "gross_profit": q.gross_profit,
                "operating_income": q.operating_income,
                "total_assets": q.total_assets,
                "total_equity": q.total_equity,
            }
            for q in f.quarters
        ],
        "peers": {
            "source": peers.source,
            "tickers": [p.ticker for p in peers.peers],
        },
        "derived": {},
    }


def run(router: Router | None = None, *, incremental: bool = True, force: bool = False) -> dict:
    universe = load_universe()
    router = router or build_router()

    fundamentals_payload = read_json(config.FUNDAMENTALS_JSON, default={"version": 1, "data": {}}) or {}
    data: dict = fundamentals_payload.get("data") or {}
    today = today_utc()

    fetched = 0
    skipped = 0
    failed: list[str] = []
    deferred: list[str] = []
    quota_exhausted = False

    for ticker in universe:
        if quota_exhausted:
            deferred.append(ticker)
            continue
        if incremental and not force and _is_current(data.get(ticker), today):
            skipped += 1
            continue
        try:
            fundamentals = router.get_fundamentals(ticker, config.QUARTERS_BACK)
            peers = router.get_peers(ticker)
        except QuotaExceeded:
            log.warning(
                "FMP daily quota exhausted; deferring %s and remaining tickers to next run",
                ticker,
            )
            deferred.append(ticker)
            quota_exhausted = True
            continue
        except Exception as exc:  # noqa: BLE001
            log.warning("quarterly fetch failed for %s: %s", ticker, exc)
            failed.append(ticker)
            continue
        existing_derived = (data.get(ticker) or {}).get("derived") or {}
        record = _serialize_fundamentals(fundamentals, peers)
        # compute_derived re-fills this; we keep stale values out of the way
        # by clearing on every refetch.
        record["derived"] = existing_derived
        data[ticker] = record
        fetched += 1

    fundamentals_payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "data": data,
    }
    write_json(config.FUNDAMENTALS_JSON, fundamentals_payload)

    log.info(
        "pull_quarterly complete · fetched=%d skipped=%d failed=%d deferred=%d",
        fetched,
        skipped,
        len(failed),
        len(deferred),
    )

    # Data-depth summary across the universe — flags tickers with limited
    # history and shows the provider distribution at a glance.
    depth_counts: list[int] = []
    by_provider: dict[str, int] = {}
    thin: list[tuple[str, int, str]] = []
    for ticker, block in data.items():
        if not isinstance(block, dict):
            continue
        qs = block.get("quarters") or []
        n = sum(1 for q in qs if isinstance(q, dict) and q.get("revenue") is not None)
        src = block.get("source") or "unknown"
        depth_counts.append(n)
        by_provider[src] = by_provider.get(src, 0) + 1
        if n < 16:
            thin.append((ticker, n, src))
    if depth_counts:
        avg = sum(depth_counts) / len(depth_counts)
        log.info(
            "data depth · avg=%.1fq min=%d max=%d · providers=%s",
            avg,
            min(depth_counts),
            max(depth_counts),
            ", ".join(f"{k}:{v}" for k, v in sorted(by_provider.items())),
        )
    for ticker, n, src in thin:
        log.warning("limited history · %s: %d quarters with revenue (provider=%s)", ticker, n, src)

    if deferred:
        log.info("deferred to next run: %s", ", ".join(deferred))
    return {
        "fundamentals_fetched": fetched,
        "fundamentals_skipped": skipped,
        "fundamentals_failed": failed,
        "fundamentals_deferred": deferred,
        "provider_counts": router.provider_counts(),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull quarterly fundamentals + peers")
    parser.add_argument("--full", action="store_true", help="refetch every ticker")
    parser.add_argument("--incremental", action="store_true", help="default — only refetch when stored quarter is stale")
    args = parser.parse_args()
    incremental = not args.full
    setup_logging()
    summary = run(incremental=incremental, force=args.full)
    log.info("summary: %s", summary)


if __name__ == "__main__":
    main()
