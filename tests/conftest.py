"""Shared fixtures: fake providers and synthetic data so tests never touch
real APIs."""
from __future__ import annotations

import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest

# Make `pipeline` importable when pytest is invoked from any cwd.
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from pipeline.providers.base import DataProvider  # noqa: E402
from pipeline.providers.schemas import (  # noqa: E402
    Fundamentals,
    FundamentalsQuarter,
    Peer,
    Peers,
    PricePoint,
    PriceSeries,
    Profile,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def make_price_series(ticker: str, *, source: str = "yfinance", days: int = 300, start_price: float = 100.0) -> PriceSeries:
    today = date.today()
    points: list[PricePoint] = []
    for i in range(days):
        d = today - timedelta(days=days - i - 1)
        # deterministic synthetic walk
        price = start_price + (i * 0.10) + ((i % 7) - 3) * 0.5
        points.append(PricePoint(date=d, close=round(price, 2), volume=1_000_000 + i))
    return PriceSeries(ticker=ticker, points=points, source=source, fetched_at=_now())


def make_fundamentals(ticker: str, *, source: str = "fmp", quarters: int = 8, base_revenue: float = 1e9) -> Fundamentals:
    today = date.today()
    qs: list[FundamentalsQuarter] = []
    for i in range(quarters):
        # newest first; step back in 90-day chunks
        d = today - timedelta(days=90 * i)
        rev = base_revenue * (1 + 0.02 * (quarters - i))
        ni = rev * 0.20
        qs.append(
            FundamentalsQuarter(
                period=f"{d.year}-Q{((d.month - 1) // 3) + 1}",
                fiscal_date_ending=d,
                revenue=rev,
                net_income=ni,
                eps=ni / 1_000_000_000,
                shares_outstanding=1_000_000_000,
                free_cash_flow=ni * 0.85,
                total_debt=2e9,
                cash=1e9,
                operating_margin=0.25,
            )
        )
    return Fundamentals(ticker=ticker, quarters=qs, source=source, fetched_at=_now())


def make_profile(ticker: str, *, source: str = "fmp", sector: str = "Information Technology") -> Profile:
    return Profile(
        ticker=ticker,
        name=f"{ticker} Inc.",
        sector=sector,
        industry="Software",
        market_cap=1.5e12,
        country="US",
        exchange="NASDAQ",
        logo_url=None,
        source=source,
        fetched_at=_now(),
    )


def make_peers(ticker: str, peers: list[str], *, source: str = "fmp") -> Peers:
    return Peers(
        ticker=ticker,
        peers=[Peer(ticker=p) for p in peers],
        source=source,
        fetched_at=_now(),
    )


class CountingProvider(DataProvider):
    """Fake provider that records every call so tests can assert routing."""

    def __init__(self, name: str) -> None:
        self.name = name
        self.calls: dict[str, list[Any]] = {
            "get_prices": [], "get_fundamentals": [], "get_peers": [], "get_profile": [],
        }

    def get_prices(self, ticker: str, days: int) -> PriceSeries:
        self.calls["get_prices"].append((ticker, days))
        return make_price_series(ticker, source="yfinance" if self.name == "yfinance" else "fmp")

    def get_fundamentals(self, ticker: str, quarters: int) -> Fundamentals:
        self.calls["get_fundamentals"].append((ticker, quarters))
        return make_fundamentals(ticker, source="yfinance" if self.name == "yfinance" else "fmp")

    def get_peers(self, ticker: str) -> Peers:
        self.calls["get_peers"].append(ticker)
        if self.name == "yfinance":
            return make_peers(ticker, [], source="yfinance")
        return make_peers(ticker, ["PEER1", "PEER2"], source="fmp")

    def get_profile(self, ticker: str) -> Profile:
        self.calls["get_profile"].append(ticker)
        return make_profile(ticker, source="yfinance" if self.name == "yfinance" else "fmp")


@pytest.fixture
def yf_provider() -> CountingProvider:
    return CountingProvider("yfinance")


@pytest.fixture
def fmp_provider() -> CountingProvider:
    return CountingProvider("fmp")
