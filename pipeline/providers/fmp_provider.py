"""FinancialModelingPrep provider. Reads FMP_API_KEY from env, throttles to
the 250/day free-tier ceiling via FmpThrottle, retries with exponential
backoff on transient errors."""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from .base import DataProvider, ProviderError, QuotaExceeded  # noqa: F401
from .schemas import (
    Fundamentals,
    FundamentalsQuarter,
    Peer,
    Peers,
    PricePoint,
    PriceSeries,
    Profile,
)
from .throttle import FmpThrottle

log = logging.getLogger(__name__)

BASE_URL = "https://financialmodelingprep.com/api/v3"
STABLE_URL = "https://financialmodelingprep.com/stable"


class FmpHttpError(ProviderError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quarter_label(d: date) -> str:
    return f"{d.year}-Q{((d.month - 1) // 3) + 1}"


class FmpProvider(DataProvider):
    name = "fmp"

    def __init__(self, api_key: str, throttle: FmpThrottle, *, session: requests.Session | None = None) -> None:
        if not api_key:
            raise ValueError("FmpProvider needs a non-empty api_key")
        self.api_key = api_key
        self.throttle = throttle
        self.session = session or requests.Session()
        self.session.headers.setdefault("User-Agent", "portfolio-skyline-pipeline/0.1")

    # ---------- HTTP plumbing ----------

    def _request(self, url: str, params: dict[str, Any] | None = None) -> Any:
        self.throttle.consume(1)
        try:
            resp = self._do_request(url, params or {})
        except ProviderError:
            self.throttle.force_refund(1)
            raise
        except Exception as exc:
            self.throttle.force_refund(1)
            # Wrap non-provider exceptions (e.g. requests.HTTPError 402/403/5xx)
            # as FmpHttpError so the Router's fallback catches them.
            raise FmpHttpError(f"FMP request failed: {exc}") from exc
        if isinstance(resp, dict) and "Error Message" in resp:
            msg = resp["Error Message"]
            if "limit reach" in msg.lower():
                raise QuotaExceeded(f"FMP responded with quota error: {msg}")
            raise FmpHttpError(f"FMP error: {msg}")
        return resp

    @retry(
        retry=retry_if_exception_type((requests.RequestException,)),
        stop=stop_after_attempt(4),
        wait=wait_exponential(multiplier=1, min=1, max=20),
        reraise=True,
    )
    def _do_request(self, url: str, params: dict[str, Any]) -> Any:
        merged = {**params, "apikey": self.api_key}
        log.debug("FMP GET %s params=%s", url, {k: v for k, v in params.items() if k != "apikey"})
        resp = self.session.get(url, params=merged, timeout=30)
        if resp.status_code == 429:
            raise QuotaExceeded(f"HTTP 429 from FMP at {url}")
        resp.raise_for_status()
        return resp.json()

    # ---------- public API ----------

    def get_prices(self, ticker: str, days: int) -> PriceSeries:
        url = f"{BASE_URL}/historical-price-full/{ticker}"
        params = {"timeseries": days}
        payload = self._request(url, params)
        rows = payload.get("historical", []) if isinstance(payload, dict) else []
        # FMP returns newest first.
        points: list[PricePoint] = []
        for r in reversed(rows):
            try:
                points.append(
                    PricePoint(
                        date=date.fromisoformat(r["date"]),
                        close=float(r.get("adjClose") or r.get("close")),
                        volume=int(r.get("volume") or 0),
                    )
                )
            except (KeyError, TypeError, ValueError):
                continue
        return PriceSeries(ticker=ticker, points=points, source="fmp", fetched_at=_now())

    def get_fundamentals(self, ticker: str, quarters: int) -> Fundamentals:
        # Always pull 20 quarters from FMP — that's what the UI's 5Y toggle
        # expects. The `quarters` param caps it for tests passing tighter
        # limits. We use the v3 path-param endpoints; `/stable/*` returns
        # HTTP 402 on the free tier.
        limit = min(20, quarters) if quarters > 0 else 20
        income = self._request(
            f"{BASE_URL}/income-statement/{ticker}",
            {"period": "quarter", "limit": limit},
        ) or []
        balance = self._request(
            f"{BASE_URL}/balance-sheet-statement/{ticker}",
            {"period": "quarter", "limit": limit},
        ) or []
        cash = self._request(
            f"{BASE_URL}/cash-flow-statement/{ticker}",
            {"period": "quarter", "limit": limit},
        ) or []

        bal_by_date = {row.get("date"): row for row in balance if isinstance(row, dict)}
        cash_by_date = {row.get("date"): row for row in cash if isinstance(row, dict)}

        out: list[FundamentalsQuarter] = []
        for inc in income:
            if not isinstance(inc, dict):
                continue
            d_str = inc.get("date")
            try:
                fde = date.fromisoformat(d_str)
            except (TypeError, ValueError):
                continue
            b = bal_by_date.get(d_str, {})
            c = cash_by_date.get(d_str, {})
            revenue = inc.get("revenue")
            op_income = inc.get("operatingIncome")
            ocf = c.get("operatingCashFlow")
            capex = c.get("capitalExpenditure")
            if ocf is not None and capex is not None:
                fcf = ocf - capex
            else:
                fcf = c.get("freeCashFlow")
            op_margin = (op_income / revenue) if revenue and op_income is not None else None
            out.append(
                FundamentalsQuarter(
                    period=_quarter_label(fde),
                    fiscal_date_ending=fde,
                    revenue=revenue,
                    net_income=inc.get("netIncome"),
                    eps=inc.get("eps") or inc.get("epsdiluted"),
                    shares_outstanding=inc.get("weightedAverageShsOut"),
                    free_cash_flow=fcf,
                    total_debt=b.get("totalDebt"),
                    cash=b.get("cashAndShortTermInvestments") or b.get("cashAndCashEquivalents"),
                    operating_margin=op_margin,
                    gross_profit=inc.get("grossProfit"),
                    operating_income=op_income,
                    total_assets=b.get("totalAssets"),
                    total_equity=b.get("totalStockholdersEquity"),
                )
            )
        return Fundamentals(ticker=ticker, quarters=out, source="fmp", fetched_at=_now())

    def get_peers(self, ticker: str) -> Peers:
        url = f"{STABLE_URL}/stock-peers"
        try:
            payload = self._request(url, {"symbol": ticker})
        except FmpHttpError:
            payload = []
        peer_tickers: list[str] = []
        if isinstance(payload, list) and payload:
            head = payload[0] if isinstance(payload[0], dict) else {}
            raw = head.get("peersList") or head.get("peers") or []
            if isinstance(raw, str):
                raw = [s.strip() for s in raw.split(",") if s.strip()]
            peer_tickers = [str(p).upper() for p in raw if p]
        elif isinstance(payload, dict):
            raw = payload.get("peersList") or payload.get("peers") or []
            if isinstance(raw, str):
                raw = [s.strip() for s in raw.split(",") if s.strip()]
            peer_tickers = [str(p).upper() for p in raw if p]
        return Peers(
            ticker=ticker,
            peers=[Peer(ticker=t) for t in peer_tickers[:8]],
            source="fmp",
            fetched_at=_now(),
        )

    def get_profile(self, ticker: str) -> Profile:
        payload = self._request(f"{BASE_URL}/profile/{ticker}")
        row = payload[0] if isinstance(payload, list) and payload else {}
        if not isinstance(row, dict):
            row = {}
        return Profile(
            ticker=ticker,
            name=row.get("companyName") or ticker,
            sector=row.get("sector"),
            industry=row.get("industry"),
            market_cap=row.get("mktCap"),
            country=row.get("country"),
            exchange=row.get("exchangeShortName") or row.get("exchange"),
            logo_url=row.get("image"),
            currency=row.get("currency"),
            source="fmp",
            fetched_at=_now(),
        )
