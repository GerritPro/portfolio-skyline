"""Entry point. Default: pull_daily + compute_derived. With --quarterly:
pull_quarterly + compute_derived. Always writes metadata.json last."""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import (  # noqa: E402
    compute_brand_colors,
    compute_derived,
    compute_risk_factors,
    config,
    pull_daily,
    pull_fx,
    pull_insider,
    pull_market_gex,
    pull_patents,
    pull_quarterly,
)
from pipeline.io_utils import setup_logging  # noqa: E402
from pipeline.providers.throttle import FmpThrottle  # noqa: E402
from pipeline.runner import build_router, load_universe  # noqa: E402

log = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Daily orchestration entry point")
    parser.add_argument("--quarterly", action="store_true", help="run pull_quarterly instead of pull_daily")
    parser.add_argument("--full", action="store_true", help="bypass per-ticker idempotency caches")
    parser.add_argument("--quarterly-full", action="store_true", help="for --quarterly, refetch every ticker")
    parser.add_argument(
        "--patents",
        action="store_true",
        help="also pull patents (slow — patents grant weekly so daily is wasteful)",
    )
    parser.add_argument(
        "--patents-only",
        action="store_true",
        help="run only the patents pull, skip every other step",
    )
    args = parser.parse_args()

    setup_logging()
    config.load_env()
    mode = config.get_mode()
    router = build_router(mode)
    universe = load_universe()
    log.info("orchestrate · mode=%s · universe=%d tickers", mode, len(universe))

    if args.patents_only:
        try:
            patents_summary = pull_patents.run()
            log.info("patents pull complete: %s", patents_summary)
        except Exception as exc:  # noqa: BLE001
            log.warning("patents pull failed (non-fatal): %s", exc)
        return

    if args.quarterly:
        pull_quarterly.run(router=router, incremental=not args.quarterly_full, force=args.quarterly_full)
    else:
        pull_daily.run(router=router, force=args.full)

    compute_derived.run()

    try:
        risk_summary = compute_risk_factors.run()
        log.info("risk factors complete: %s", risk_summary)
    except Exception as exc:  # noqa: BLE001
        log.warning("risk factor computation failed (non-fatal): %s", exc)

    try:
        brand_summary = compute_brand_colors.run()
        log.info("brand colors complete: %s", brand_summary)
    except Exception as exc:  # noqa: BLE001
        log.warning("brand color extraction failed (non-fatal): %s", exc)

    try:
        fx_summary = pull_fx.run()
        log.info("fx pull complete: %s", fx_summary)
    except Exception as exc:  # noqa: BLE001
        log.warning("fx pull failed (non-fatal): %s", exc)

    try:
        gex_summary = pull_market_gex.run()
        log.info("gex pull complete: %s", gex_summary)
    except Exception as exc:  # noqa: BLE001
        log.warning("gex pull failed (non-fatal): %s", exc)

    try:
        insider_summary = pull_insider.run(universe)
        log.info("insider pull complete: %s", insider_summary)
    except Exception as exc:  # noqa: BLE001
        log.warning("insider pull failed (non-fatal): %s", exc)

    if args.patents:
        try:
            patents_summary = pull_patents.run()
            log.info("patents pull complete: %s", patents_summary)
        except Exception as exc:  # noqa: BLE001
            log.warning("patents pull failed (non-fatal): %s", exc)

    fmp_used = 0
    if router.fmp is not None:
        throttle = FmpThrottle(config.FMP_CALL_LOG, config.FMP_DAILY_QUOTA)
        fmp_used = throttle.used_today()

    compute_derived.write_metadata(
        mode=mode,
        provider_counts=router.provider_counts(),
        fmp_used=fmp_used,
        ticker_count=len(universe),
    )

    log.info("orchestrate done · fmp_calls_used=%d", fmp_used)


if __name__ == "__main__":
    main()
