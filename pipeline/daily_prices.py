"""Daily high-frequency pull — prices, options, FX, insider, derived stats.
Does NOT touch quarterly fundamentals (that's biweekly_fundamentals.py).

Entry point for the GitHub Actions daily workflow."""
from __future__ import annotations

import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import (  # noqa: E402
    build_dashboard_prep,
    compute_brand_colors,
    compute_derived,
    config,
    pull_daily,
    pull_fx,
    pull_insider,
    pull_market_gex,
)
from pipeline.io_utils import setup_logging  # noqa: E402
from pipeline.providers.throttle import FmpThrottle  # noqa: E402
from pipeline.runner import build_router, load_universe  # noqa: E402
from pipeline.state.update_stamp import stamp  # noqa: E402

log = logging.getLogger(__name__)


def main() -> None:
    setup_logging()
    config.load_env()
    mode = config.get_mode()
    router = build_router(mode)
    universe = load_universe()
    log.info("daily_prices · mode=%s · universe=%d", mode, len(universe))

    pull_daily.run(router=router, force=False)
    compute_derived.run()

    try:
        log.info("fx pull: %s", pull_fx.run())
    except Exception as exc:  # noqa: BLE001
        log.warning("fx pull failed (non-fatal): %s", exc)

    try:
        log.info("gex pull: %s", pull_market_gex.run())
    except Exception as exc:  # noqa: BLE001
        log.warning("gex pull failed (non-fatal): %s", exc)

    try:
        log.info("insider pull: %s", pull_insider.run(universe))
    except Exception as exc:  # noqa: BLE001
        log.warning("insider pull failed (non-fatal): %s", exc)

    try:
        log.info("brand colors: %s", compute_brand_colors.run())
    except Exception as exc:  # noqa: BLE001
        log.warning("brand colors failed (non-fatal): %s", exc)

    try:
        log.info("dashboard prep: %s", build_dashboard_prep.run())
    except Exception as exc:  # noqa: BLE001
        log.warning("dashboard prep failed (non-fatal): %s", exc)

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

    stamp("prices")
    log.info("daily_prices done · fmp_calls_used=%d", fmp_used)


if __name__ == "__main__":
    main()
