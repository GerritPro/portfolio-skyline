"""Build per-ticker segments.json by parsing recent SEC XBRL filings.

For each ticker: list 10-K + 10-Q filings, download the iXBRL instance,
extract segment-tagged Revenue facts (ProductOrServiceAxis,
StatementBusinessSegmentsAxis, StatementGeographicalAxis), accumulate
per-segment time series, and pick the dominant axis.

Writes:
  /public/data/stocks/{ticker}/segments.json

Skips tickers with no segment-reporting (no JSON written).
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Optional

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import setup_logging, write_json  # noqa: E402
from pipeline.providers.edgar_xbrl import EdgarXbrlProvider  # noqa: E402
from pipeline.segments.edgar_submissions import list_filings, Filing  # noqa: E402
from pipeline.segments.xbrl_fetcher import fetch_instance  # noqa: E402
from pipeline.segments.xbrl_parser import parse, Fact  # noqa: E402

log = logging.getLogger(__name__)

# Axes we treat as "segment" axes in priority order. The first axis that has
# at least 3 distinct members across the time window wins.
SEGMENT_AXES = [
    ("ProductOrServiceAxis", "Product"),
    ("StatementBusinessSegmentsAxis", "Operating"),
    ("StatementGeographicalAxis", "Geographic"),
]

REVENUE_CONCEPTS = {
    "Revenues",
    "RevenueFromContractWithCustomerExcludingAssessedTax",
    "RevenueFromContractWithCustomerIncludingAssessedTax",
    "SalesRevenueNet",
}

# Limit number of filings to fetch per ticker (10-K + 10-Q combined).
# 12 covers ~3 years of quarterly history; SP500 large caps usually have
# enough at 16-20 for cleaner stacked chart.
DEFAULT_FILING_LIMIT = 16

# Concurrent filing downloads per ticker. SEC EDGAR's fair-use limit is
# 10 req/s — we cap at 4 workers and gate every request through a shared
# token-style limiter to stay under that ceiling.
FILING_WORKERS = 4
SEC_MIN_GAP_S = 0.12  # ~8 req/s ceiling across all workers


class _RateLimiter:
    """Thread-safe minimum-gap rate limiter. `gate()` blocks until the next
    request slot is free, then claims it. Conservative — does not implement
    a true token bucket, just an inter-call floor."""

    def __init__(self, min_gap_s: float) -> None:
        self.min_gap_s = min_gap_s
        self.last_call = 0.0
        self.lock = threading.Lock()

    def gate(self) -> None:
        with self.lock:
            now = time.monotonic()
            wait = self.min_gap_s - (now - self.last_call)
            if wait > 0:
                time.sleep(wait)
            self.last_call = time.monotonic()

# Aggregate "parent" members that are sums of granular siblings. We drop
# them only when granular siblings exist. ProductMember is an aggregate of
# iPhone/Mac/iPad/Wearables. ServiceMember is a peer (Services), not an
# aggregate, so we keep it.
PARENT_MEMBERS_TO_DROP = {"ProductMember"}


def _is_quarterly_period(start: Optional[str], end: Optional[str]) -> bool:
    if not start or not end:
        return False
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except ValueError:
        return False
    days = (e - s).days
    return 75 <= days <= 100


def _quarter_label(end_iso: str) -> str:
    try:
        d = date.fromisoformat(end_iso)
    except ValueError:
        return end_iso
    # 4-4-5 fiscal calendars push end-dates 1-2 days into the next calendar
    # quarter; shift back to label by the dominant quarter of the period.
    from datetime import timedelta
    adjusted = d - timedelta(days=14)
    q = ((adjusted.month - 1) // 3) + 1
    return f"{adjusted.year}-Q{q}"


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _build_for_ticker(
    ticker: str,
    cik: str,
    session: requests.Session,
    filing_limit: int,
    limiter: _RateLimiter,
) -> Optional[dict]:
    """Returns the segments-payload dict, or None if no usable data."""
    try:
        limiter.gate()
        filings = list_filings(cik, session=session, limit=filing_limit)
    except Exception as exc:  # noqa: BLE001
        log.warning("submissions failed for %s: %s", ticker, exc)
        return None
    if not filings:
        return None

    def _fetch_and_parse(f: Filing) -> tuple[Filing, list[Fact] | None]:
        try:
            limiter.gate()
            xml = fetch_instance(cik, f.accession_nodashes, f.primary_document, session=session)
        except Exception as exc:  # noqa: BLE001
            log.warning("instance fetch failed for %s %s: %s", ticker, f.accession, exc)
            return f, None
        if xml is None:
            return f, None
        try:
            return f, parse(xml)
        except Exception as exc:  # noqa: BLE001
            log.warning("xbrl parse failed for %s %s: %s", ticker, f.accession, exc)
            return f, None

    # Collect facts across all filings. Key uniquely by (concept, end-date,
    # axis, member, period-length) so the same fact reported in adjacent 10-Q
    # and 10-K filings deduplicates. Parallel fetch (4 workers) with a shared
    # rate limiter — pushes a ticker from ~50s to ~13s while staying under
    # SEC's 10 req/s fair-use ceiling.
    seen_keys: set[tuple] = set()
    by_axis_period: dict[str, dict[str, dict[str, float]]] = defaultdict(lambda: defaultdict(dict))
    with ThreadPoolExecutor(max_workers=FILING_WORKERS) as ex:
        futures = [ex.submit(_fetch_and_parse, f) for f in filings]
        for fut in as_completed(futures):
            _f, facts = fut.result()
            if facts is None:
                continue
            for fact in facts:
                if fact.concept not in REVENUE_CONCEPTS:
                    continue
                if "usd" not in fact.unit.lower():
                    continue
                if not _is_quarterly_period(fact.period_start, fact.period_end):
                    continue
                if not fact.dimensions:
                    continue
                for axis_local, _label in SEGMENT_AXES:
                    if axis_local not in fact.dimensions:
                        continue
                    member = fact.dimensions[axis_local]
                    period = _quarter_label(fact.period_end or "")
                    key = (axis_local, member, period, fact.concept)
                    if key in seen_keys:
                        continue
                    seen_keys.add(key)
                    existing = by_axis_period[axis_local][period].get(member)
                    if existing is None:
                        by_axis_period[axis_local][period][member] = fact.value

    # Pick the dominant axis: one with the highest member-count × period-count.
    best_axis: Optional[str] = None
    best_label = ""
    best_score = 0
    for axis_local, label in SEGMENT_AXES:
        periods = by_axis_period.get(axis_local) or {}
        members = {m for p in periods.values() for m in p.keys()}
        score = len(members) * len(periods)
        if score > best_score:
            best_score = score
            best_axis = axis_local
            best_label = label
    if not best_axis or best_score < 6:
        # Less than ~3 members × 2 periods = not enough to render.
        return None

    periods_map = by_axis_period[best_axis]
    all_members = sorted({m for p in periods_map.values() for m in p.keys()})
    # Drop "Product"/"Service" aggregate parents if we have more granular siblings.
    has_granular = any(
        m not in PARENT_MEMBERS_TO_DROP for m in all_members
    )
    if has_granular:
        all_members = [m for m in all_members if m not in PARENT_MEMBERS_TO_DROP]

    # Build time series per member; sort periods oldest→newest.
    sorted_periods = sorted(periods_map.keys())
    segments_payload: list[dict] = []
    for member in all_members:
        history = []
        for period in sorted_periods:
            v = periods_map[period].get(member)
            history.append({"period": period, "value": float(v) if v is not None else None})
        segments_payload.append({
            "name": member,
            "label": _humanize_member(member),
            "history": history,
        })

    return {
        "axisType": best_label.lower(),
        "axisLabel": best_label,
        "axis": best_axis,
        "periods": sorted_periods,
        "segments": segments_payload,
        "generatedAt": _now_iso(),
    }


def _humanize_member(member: str) -> str:
    """Strip Member suffix + CamelCase to spaced label.
    IPhoneMember → iPhone, GreaterChinaMember → Greater China, AmericasSegmentMember → Americas Segment."""
    s = member
    if s.endswith("Member"):
        s = s[: -len("Member")]
    # Insert spaces between lowercase→uppercase transitions.
    out = []
    for i, ch in enumerate(s):
        if i > 0 and ch.isupper() and s[i - 1].islower():
            out.append(" ")
        out.append(ch)
    label = "".join(out)
    # Apple-specific lowercase exception.
    if label == "I Phone":
        return "iPhone"
    if label == "I Pad":
        return "iPad"
    if label == "Mac":
        return "Mac"
    return label


def run(
    tickers: list[str],
    filing_limit: int = DEFAULT_FILING_LIMIT,
    gap_s: float = SEC_MIN_GAP_S,
) -> dict:
    """Pull segments for the given tickers. Returns summary stats."""
    config.load_env()
    cik_cache = config.PIPELINE_DIR / ".cik_map.json"
    xbrl = EdgarXbrlProvider(cik_cache_path=cik_cache)
    cik_map = xbrl._load_cik_map()  # warm + access

    session = requests.Session()
    out_root = config.DATA_DIR / "stocks"
    limiter = _RateLimiter(gap_s)

    written = 0
    skipped: list[str] = []
    failed: list[str] = []
    for t in tickers:
        cik = cik_map.get(t.upper())
        if not cik:
            log.info("%s: no CIK, skipping segment pull", t)
            skipped.append(t)
            continue
        try:
            payload = _build_for_ticker(t, cik, session, filing_limit, limiter)
        except Exception as exc:  # noqa: BLE001
            log.warning("segments build failed for %s: %s", t, exc)
            failed.append(t)
            continue
        if payload is None:
            log.info("%s: no segment data", t)
            skipped.append(t)
            continue
        target = out_root / t / "segments.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        write_json(target, payload)
        log.info(
            "%s: %s axis · %d segments · %d periods",
            t,
            payload["axisLabel"],
            len(payload["segments"]),
            len(payload["periods"]),
        )
        written += 1
    return {"written": written, "skipped": len(skipped), "failed": failed}


def main() -> None:
    parser = argparse.ArgumentParser(description="Pull SEC XBRL segment data")
    parser.add_argument("tickers", nargs="*", help="Ticker symbols. Omit when using --all.")
    parser.add_argument("--all", action="store_true",
                        help="Pull segments for every ticker in universe.json")
    parser.add_argument("--filings", type=int, default=DEFAULT_FILING_LIMIT,
                        help=f"Filings per ticker (default {DEFAULT_FILING_LIMIT})")
    parser.add_argument("--skip-existing", action="store_true",
                        help="Skip tickers that already have segments.json (resumable)")
    parser.add_argument("--shard", type=str, default=None,
                        help="N/M — process only every M-th ticker starting at offset N (1-indexed). "
                             "E.g. 1/3 processes tickers 0,3,6,...; 2/3 processes 1,4,7,...")
    parser.add_argument("--gap-ms", type=int, default=int(SEC_MIN_GAP_S * 1000),
                        help=f"Inter-request gap in ms (default {int(SEC_MIN_GAP_S*1000)}ms). "
                             "Bump when running parallel shards to share SEC's 10 req/s ceiling.")
    args = parser.parse_args()
    setup_logging()

    if args.all:
        from pipeline.io_utils import read_json

        universe = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {}
        tickers = [r["ticker"] for r in universe.get("tickers") or [] if isinstance(r, dict) and r.get("ticker")]
    else:
        tickers = [t.upper() for t in args.tickers]
    if not tickers:
        parser.error("specify tickers or --all")

    if args.skip_existing:
        before = len(tickers)
        tickers = [
            t for t in tickers
            if not (config.DATA_DIR / "stocks" / t / "segments.json").exists()
        ]
        log.info("skip-existing: %d / %d remaining", len(tickers), before)

    if args.shard:
        try:
            n_str, m_str = args.shard.split("/")
            n = int(n_str) - 1  # to 0-indexed
            m = int(m_str)
        except ValueError:
            parser.error("--shard must be in form N/M, e.g. 1/3")
        if not (0 <= n < m and m >= 1):
            parser.error("--shard N/M requires 1 <= N <= M")
        before = len(tickers)
        tickers = [t for i, t in enumerate(tickers) if i % m == n]
        log.info("shard %d/%d: %d / %d tickers", n + 1, m, len(tickers), before)

    gap_s = max(0.0, args.gap_ms / 1000)
    summary = run(tickers, filing_limit=args.filings, gap_s=gap_s)
    print(summary)


if __name__ == "__main__":
    main()
