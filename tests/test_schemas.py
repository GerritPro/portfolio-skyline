"""pydantic round-trip + extra-field rejection."""
from __future__ import annotations

from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from pipeline.providers.schemas import (
    Fundamentals,
    FundamentalsQuarter,
    PricePoint,
    PriceSeries,
    Profile,
)


def test_price_series_round_trip():
    series = PriceSeries(
        ticker="AAPL",
        points=[PricePoint(date=date(2025, 1, 2), close=180.5, volume=1_000_000)],
        source="yfinance",
        fetched_at=datetime(2025, 1, 2, 22, 0, tzinfo=timezone.utc),
    )
    payload = series.model_dump()
    again = PriceSeries.model_validate(payload)
    assert again.points[0].close == 180.5


def test_extra_fields_rejected():
    with pytest.raises(ValidationError):
        PricePoint.model_validate(
            {"date": "2025-01-02", "close": 100.0, "volume": 100, "extra": True}
        )


def test_invalid_source_rejected():
    with pytest.raises(ValidationError):
        Profile.model_validate(
            {
                "ticker": "AAPL",
                "name": "Apple Inc.",
                "source": "bloomberg",
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            }
        )


def test_fundamentals_accepts_missing_optional_fields():
    f = Fundamentals(
        ticker="AAPL",
        quarters=[
            FundamentalsQuarter(period="2025-Q1", fiscal_date_ending=date(2025, 3, 31))
        ],
        source="fmp",
        fetched_at=datetime.now(timezone.utc),
    )
    assert f.quarters[0].revenue is None
    assert f.quarters[0].operating_margin is None
