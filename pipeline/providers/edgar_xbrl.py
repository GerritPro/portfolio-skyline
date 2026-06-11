"""SEC EDGAR XBRL Company-Facts provider for fundamentals.
Free, no API key, returns 20+ quarters of history for any US-listed filer.

Falls back internally on the canonical us-gaap concept names with backup
tags (Revenues vs RevenueFromContractWith…) since the labeling has drifted
over the years. Derives Q4 values from annual − Q1+Q2+Q3 where the filer
doesn't report Q4 explicitly."""
from __future__ import annotations

import json
import logging
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import DataProvider, ProviderError
from .schemas import (
    Fundamentals,
    FundamentalsQuarter,
    Peer,
    Peers,
    PricePoint,
    PriceSeries,
    Profile,
)

log = logging.getLogger(__name__)

# SEC requires the User-Agent header to identify a real party with a contact
# email (https://www.sec.gov/os/accessing-edgar-data).
USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_FACTS_URL = "https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json"


# Concept tag fallback chains. Order matters — first match wins.
CONCEPTS: dict[str, list[str]] = {
    "revenue": [
        "Revenues",
        "RevenueFromContractWithCustomerExcludingAssessedTax",
        "SalesRevenueNet",
    ],
    "net_income": ["NetIncomeLoss"],
    "eps": ["EarningsPerShareDiluted", "EarningsPerShareBasic"],
    "gross_profit": ["GrossProfit"],
    "operating_income": ["OperatingIncomeLoss"],
    "total_assets": ["Assets"],
    "total_equity": ["StockholdersEquity"],
    "cash": [
        "CashAndCashEquivalentsAtCarryingValue",
        "CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents",
    ],
    "total_debt": ["LongTermDebt", "LongTermDebtNoncurrent"],
    "operating_cash_flow": ["NetCashProvidedByUsedInOperatingActivities"],
    "capex": ["PaymentsToAcquirePropertyPlantAndEquipment"],
    "shares": [
        "CommonStockSharesOutstanding",
        "WeightedAverageNumberOfDilutedSharesOutstanding",
        "WeightedAverageNumberOfSharesOutstandingBasic",
    ],
}

# Concepts that represent FLOWS (sum to annual). The rest are SNAPSHOT
# balance-sheet items where the FY value equals the year-end snapshot.
FLOW_CONCEPTS = {
    "revenue",
    "net_income",
    "eps",
    "gross_profit",
    "operating_income",
    "operating_cash_flow",
    "capex",
}


class EdgarXbrlProvider(DataProvider):
    name = "edgar"

    def __init__(self, *, cik_cache_path: Path) -> None:
        self.cik_cache_path = cik_cache_path
        self._cik_map: dict[str, str] | None = None
        self._session = requests.Session()
        self._session.headers["User-Agent"] = USER_AGENT
        self._facts_cache: dict[str, dict] = {}

    # ---------- public API ----------

    def get_prices(self, ticker: str, days: int) -> PriceSeries:
        raise ProviderError("EDGAR XBRL provider does not serve prices")

    def get_peers(self, ticker: str) -> Peers:
        raise ProviderError("EDGAR XBRL provider does not serve peers")

    def get_profile(self, ticker: str) -> Profile:
        raise ProviderError("EDGAR XBRL provider does not serve profiles")

    def get_fundamentals(self, ticker: str, quarters: int) -> Fundamentals:
        cik = self._cik_for(ticker)
        if cik is None:
            raise ProviderError(f"EDGAR: no CIK for {ticker}")
        facts = self._fetch_facts(cik)
        us_gaap = ((facts.get("facts") or {}).get("us-gaap") or {})
        if not us_gaap:
            raise ProviderError(f"EDGAR: no us-gaap facts for {ticker}")

        # Per-concept lookup: {end_date: value} for quarterlies + {end_date: value} for annuals.
        quarterly: dict[str, dict[str, float]] = defaultdict(dict)
        annual: dict[str, dict[str, float]] = defaultdict(dict)

        # Track YTD cumulative entries (start-of-fiscal-year through end-of-period)
        # so we can derive Q3 = YTD9m − YTD6m for filers like Apple that only
        # report cumulative numbers in some quarters.
        ytd: dict[str, dict[str, tuple[int, float]]] = defaultdict(dict)
        # Per (end_iso) → fiscal_year from XBRL entries; needed to group quarters
        # of the same fiscal year for YTD-derivation (filers' FYs don't align
        # with calendar year).
        end_to_fy: dict[str, int] = {}

        for our_key, tag_chain in CONCEPTS.items():
            # Merge across ALL tags in the chain — companies switch concept
            # names over time (e.g. AAPL "Revenues" → "RevenueFromContract…").
            for tag in tag_chain:
                node = us_gaap.get(tag)
                if not isinstance(node, dict):
                    continue
                for unit_key, entries in (node.get("units") or {}).items():
                    if unit_key not in {"USD", "USD/shares", "shares"}:
                        continue
                    for e in entries:
                        if not isinstance(e, dict):
                            continue
                        end_iso = e.get("end")
                        val = e.get("val")
                        if not end_iso or val is None:
                            continue
                        form = e.get("form") or ""
                        fy_val = e.get("fy")
                        if isinstance(fy_val, int):
                            end_to_fy.setdefault(end_iso, fy_val)
                        days = _period_days(e.get("start"), end_iso)
                        if days is None:
                            # Instant-fact (balance-sheet snapshot, no `start`):
                            # use directly for snapshot concepts.
                            if our_key not in FLOW_CONCEPTS:
                                if our_key not in quarterly[end_iso]:
                                    quarterly[end_iso][our_key] = float(val)
                            continue
                        if 80 <= days <= 100:
                            # Pure quarterly entry.
                            quarterly[end_iso][our_key] = float(val)
                        elif 170 <= days <= 200 or 260 <= days <= 290:
                            # YTD 6m or 9m cumulative — store for derivation.
                            ytd[end_iso][our_key] = (days, float(val))
                        elif 350 <= days <= 380 and form.startswith("10-K"):
                            annual[end_iso][our_key] = float(val)
                        elif our_key not in FLOW_CONCEPTS:
                            # Snapshot concept with any duration; treat as snapshot.
                            if our_key not in quarterly[end_iso]:
                                quarterly[end_iso][our_key] = float(val)

        # Derive pure-quarter values from YTD cumulative when filers skipped
        # the pure-quarter entry. Use XBRL's own `fy` field (preserved in
        # `end_to_fy`) for bucketing — calendar-year heuristics break for
        # filers like Apple whose FY ends late-September.
        sorted_q_dates = sorted(set(quarterly.keys()) | set(ytd.keys()))
        by_fy: dict[int, list[str]] = defaultdict(list)
        unknown_fy: list[str] = []
        for q_end in sorted_q_dates:
            fy = end_to_fy.get(q_end)
            if fy is None:
                unknown_fy.append(q_end)
            else:
                by_fy[fy].append(q_end)
        for fy_ends in by_fy.values():
            fy_ends.sort()
            running_sum: dict[str, float] = defaultdict(float)
            for end_iso in fy_ends:
                for concept in FLOW_CONCEPTS:
                    if concept in quarterly.get(end_iso, {}):
                        running_sum[concept] += quarterly[end_iso][concept]
                        continue
                    ytd_entry = ytd.get(end_iso, {}).get(concept)
                    if ytd_entry is None:
                        continue
                    _days, ytd_val = ytd_entry
                    derived = ytd_val - running_sum[concept]
                    quarterly[end_iso][concept] = derived
                    running_sum[concept] = ytd_val

        # Derive final-quarter values for FLOW concepts: annual − sum of the
        # three quarterlies that PRECEDE fy_end. Must only walk backwards
        # — abs() distance matched future quarters too, which broke the count.
        for fy_end, fy_vals in annual.items():
            try:
                fy_end_d = date.fromisoformat(fy_end)
            except ValueError:
                continue
            for concept, fy_val in fy_vals.items():
                if concept not in FLOW_CONCEPTS:
                    continue
                q_sum = 0.0
                count = 0
                for q_end, q_vals in quarterly.items():
                    if concept not in q_vals:
                        continue
                    try:
                        q_end_d = date.fromisoformat(q_end)
                    except ValueError:
                        continue
                    delta_days = (fy_end_d - q_end_d).days
                    if 60 <= delta_days <= 320:  # trailing ~9 months
                        q_sum += q_vals[concept]
                        count += 1
                if count == 3:
                    derived = fy_val - q_sum
                    if concept not in quarterly[fy_end]:
                        quarterly[fy_end][concept] = derived

        # Build final list sorted newest first, limited to `quarters`.
        sorted_ends = sorted(quarterly.keys(), reverse=True)[:quarters]
        out: list[FundamentalsQuarter] = []
        for end_iso in sorted_ends:
            vals = quarterly[end_iso]
            try:
                fde = date.fromisoformat(end_iso)
            except ValueError:
                continue
            revenue = vals.get("revenue")
            net_income = vals.get("net_income")
            eps = vals.get("eps")
            op_income = vals.get("operating_income")
            op_margin = (op_income / revenue) if (revenue and op_income is not None) else None
            ocf = vals.get("operating_cash_flow")
            capex = vals.get("capex")
            fcf = (ocf - capex) if (ocf is not None and capex is not None) else None
            out.append(
                FundamentalsQuarter(
                    period=_quarter_label(fde),
                    fiscal_date_ending=fde,
                    revenue=revenue,
                    net_income=net_income,
                    eps=eps,
                    shares_outstanding=vals.get("shares"),
                    free_cash_flow=fcf,
                    total_debt=vals.get("total_debt"),
                    cash=vals.get("cash"),
                    operating_margin=op_margin,
                    gross_profit=vals.get("gross_profit"),
                    operating_income=op_income,
                    total_assets=vals.get("total_assets"),
                    total_equity=vals.get("total_equity"),
                )
            )
        if not out:
            raise ProviderError(f"EDGAR: no quarterly facts extracted for {ticker}")
        # Quality gate: if fewer than half the returned quarters carry a
        # revenue figure, the filer is using exotic tags we don't recognize
        # — let the router fall back to yfinance, which will at least have a
        # handful of recent quarters with revenue.
        with_revenue = sum(1 for q in out if q.revenue is not None)
        if with_revenue * 2 < len(out):
            raise ProviderError(
                f"EDGAR: only {with_revenue}/{len(out)} quarters have revenue for {ticker}"
            )
        return Fundamentals(
            ticker=ticker, quarters=out, source="edgar", fetched_at=_now()
        )

    # ---------- internals ----------

    @retry(
        retry=retry_if_exception_type(requests.RequestException),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=10),
        reraise=True,
    )
    def _http_get_json(self, url: str) -> Any:
        resp = self._session.get(url, timeout=30)
        resp.raise_for_status()
        return resp.json()

    def _load_cik_map(self) -> dict[str, str]:
        if self._cik_map is not None:
            return self._cik_map
        if self.cik_cache_path.exists():
            try:
                self._cik_map = json.loads(self.cik_cache_path.read_text("utf-8"))
                if isinstance(self._cik_map, dict) and self._cik_map:
                    return self._cik_map
            except Exception:  # noqa: BLE001
                pass
        try:
            raw = self._http_get_json(SEC_TICKERS_URL)
        except Exception as exc:
            raise ProviderError(f"EDGAR: CIK map fetch failed: {exc}") from exc
        out: dict[str, str] = {}
        for entry in raw.values() if isinstance(raw, dict) else []:
            t = (entry.get("ticker") or "").upper()
            cik = entry.get("cik_str")
            if t and cik is not None:
                out[t] = str(cik).zfill(10)
        if out:
            self.cik_cache_path.write_text(json.dumps(out), encoding="utf-8")
        self._cik_map = out
        return out

    def _cik_for(self, ticker: str) -> str | None:
        return self._load_cik_map().get(ticker.upper())

    def _fetch_facts(self, cik: str) -> dict:
        if cik in self._facts_cache:
            return self._facts_cache[cik]
        try:
            data = self._http_get_json(SEC_FACTS_URL.format(cik=cik))
        except Exception as exc:
            raise ProviderError(f"EDGAR: company-facts fetch failed for {cik}: {exc}") from exc
        self._facts_cache[cik] = data
        return data


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quarter_label(d: date) -> str:
    # 4-4-5 fiscal calendars (Apple, retailers) often push the period-end a
    # day or two into the next calendar quarter (e.g. FY-Q3 ends 2023-07-01,
    # covering Apr-Jun). Shift back 2 weeks so the label reflects the
    # dominant calendar quarter of the period itself.
    adjusted = d - timedelta(days=14)
    q = ((adjusted.month - 1) // 3) + 1
    return f"{adjusted.year}-Q{q}"


def _period_days(start: str | None, end: str | None) -> int | None:
    if not start or not end:
        return None
    try:
        s = date.fromisoformat(start)
        e = date.fromisoformat(end)
    except ValueError:
        return None
    return (e - s).days


def _date_diff_days(a: str, b: str) -> int | None:
    try:
        da = date.fromisoformat(a)
        db = date.fromisoformat(b)
    except ValueError:
        return None
    return abs((db - da).days)


def _prefer_later(_new: dict, *, prev_form: str | None) -> bool:
    """Always prefer the newer entry. Real implementations might compare
    `filed` dates; we keep the most recently iterated value, which is the
    later one in SEC's chronological response order."""
    return True
