"""Abstract DataProvider — the only interface the orchestration layer talks to.

Every concrete provider returns the typed models in `schemas.py`. Raw dicts
must not cross this boundary."""
from __future__ import annotations

from abc import ABC, abstractmethod
from typing import ClassVar

from .schemas import Fundamentals, Peers, PriceSeries, Profile


class DataProvider(ABC):
    name: ClassVar[str]

    @abstractmethod
    def get_prices(self, ticker: str, days: int) -> PriceSeries:
        """Daily close prices for the last `days` calendar days."""

    @abstractmethod
    def get_fundamentals(self, ticker: str, quarters: int) -> Fundamentals:
        """Most-recent `quarters` of quarterly fundamentals, newest first."""

    @abstractmethod
    def get_peers(self, ticker: str) -> Peers:
        """Comparable companies. Empty list = provider has no opinion."""

    @abstractmethod
    def get_profile(self, ticker: str) -> Profile:
        """Static company metadata: sector, industry, market cap, etc."""


class ProviderError(RuntimeError):
    """Anything a provider can't recover from after retries."""


class QuotaExceeded(ProviderError):
    """Raised by FMP when the daily 250-call free-tier ceiling is hit."""
