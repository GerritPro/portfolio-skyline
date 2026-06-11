"""Typed pydantic models for provider responses. Every provider must validate
its output through these — `dict` payloads never escape a provider boundary."""
from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ProviderName = Literal["fmp", "yfinance", "sector_fallback", "edgar"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PricePoint(_Strict):
    date: date
    close: float
    volume: int = 0


class PriceSeries(_Strict):
    ticker: str
    points: list[PricePoint]
    source: ProviderName
    fetched_at: datetime


class FundamentalsQuarter(_Strict):
    period: str = Field(description='e.g. "2025-Q1"')
    fiscal_date_ending: date
    revenue: float | None = None
    net_income: float | None = None
    eps: float | None = None
    shares_outstanding: float | None = None
    free_cash_flow: float | None = None
    total_debt: float | None = None
    cash: float | None = None
    operating_margin: float | None = None
    gross_profit: float | None = None
    operating_income: float | None = None
    total_assets: float | None = None
    total_equity: float | None = None


class Fundamentals(_Strict):
    ticker: str
    quarters: list[FundamentalsQuarter]
    source: ProviderName
    fetched_at: datetime


class Peer(_Strict):
    ticker: str
    name: str | None = None


class Peers(_Strict):
    ticker: str
    peers: list[Peer]
    source: ProviderName
    fetched_at: datetime


class Profile(_Strict):
    ticker: str
    name: str
    sector: str | None = None
    industry: str | None = None
    market_cap: float | None = None
    country: str | None = None
    exchange: str | None = None
    logo_url: str | None = None
    currency: str | None = None
    source: ProviderName
    fetched_at: datetime
