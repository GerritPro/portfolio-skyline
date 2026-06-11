"""Pure-compute tests: correlation, derived ratios, sector aggregates."""
from __future__ import annotations

import math
from datetime import date, timedelta

import numpy as np
import pytest

from pipeline.compute_derived import (
    correlation_matrix,
    derive_for_ticker,
    sector_aggregates,
)


def _series(start_price: float, drift: float, days: int = 300) -> tuple[list[str], list[float]]:
    today = date.today()
    dates = [(today - timedelta(days=days - i - 1)).isoformat() for i in range(days)]
    closes = [start_price + drift * i + math.sin(i * 0.4) * 0.5 for i in range(days)]
    return dates, closes


def test_correlation_perfectly_correlated_pair():
    dates, c = _series(100.0, 0.10)
    prices = {
        "data": {
            "A": {"dates": dates, "close": c},
            # Same series scaled — log returns identical → corr 1.0
            "B": {"dates": dates, "close": [v * 2 for v in c]},
        }
    }
    out = correlation_matrix(prices, window=200)
    assert out["tickers"] == ["A", "B"]
    assert pytest.approx(out["matrix"][0][1], abs=0.01) == 1.0


def test_correlation_uncorrelated_pair():
    rng = np.random.default_rng(42)
    today = date.today()
    days = 250
    dates = [(today - timedelta(days=days - i - 1)).isoformat() for i in range(days)]
    a = (rng.normal(0, 0.01, days).cumsum() + 100).tolist()
    b = (rng.normal(0, 0.01, days).cumsum() + 100).tolist()
    prices = {"data": {"A": {"dates": dates, "close": a}, "B": {"dates": dates, "close": b}}}
    out = correlation_matrix(prices)
    # not anchored to a fixed value but should be far from 1.0
    assert abs(out["matrix"][0][1]) < 0.5


def test_correlation_handles_single_ticker():
    dates, c = _series(100.0, 0.05, days=50)
    prices = {"data": {"A": {"dates": dates, "close": c}}}
    out = correlation_matrix(prices)
    assert out["tickers"] == ["A"]
    assert out["matrix"] == [[1.0]]


def test_derive_for_ticker_computes_pe_and_growth():
    today = date.today()
    quarters = [
        {
            "fiscal_date_ending": (today - timedelta(days=90 * i)).isoformat(),
            "revenue": 1_000_000_000 * (1 + 0.05 * (8 - i)),
            "net_income": 200_000_000,
            "eps": 0.20,
            "shares_outstanding": 1_000_000_000,
            "free_cash_flow": 180_000_000,
        }
        for i in range(8)
    ]
    prices_block = {
        "dates": [(today - timedelta(days=d)).isoformat() for d in range(800, -1, -1)],
        "close": [100.0 + 0.01 * d for d in range(801)],
    }
    derived = derive_for_ticker(quarters, prices_block)
    assert derived["pe_ttm"] is not None and derived["pe_ttm"] > 0
    # YoY growth between quarter 0 and quarter 4: revenues are 1*(1+0.05*8) and 1*(1+0.05*4)
    expected_growth = (1 + 0.05 * 8) / (1 + 0.05 * 4) - 1
    assert pytest.approx(derived["rev_growth_yoy"], abs=0.001) == round(expected_growth, 4)
    assert derived["ttm_revenue"] == sum(q["revenue"] for q in quarters[:4])


def test_derive_handles_missing_data():
    derived = derive_for_ticker(
        [{"fiscal_date_ending": date.today().isoformat(), "revenue": None}],
        None,
    )
    assert derived["pe_ttm"] is None
    assert derived["rev_growth_yoy"] is None


def test_sector_aggregates_groups_by_sector():
    universe = {
        "tickers": [
            {"ticker": "A", "sector": "Tech", "market_cap": 1e12},
            {"ticker": "B", "sector": "Tech", "market_cap": 5e11},
            {"ticker": "C", "sector": "Health", "market_cap": 2e11},
        ]
    }
    fundamentals = {
        "data": {
            "A": {"derived": {"pe_ttm": 30.0, "rev_growth_yoy": 0.10}},
            "B": {"derived": {"pe_ttm": 20.0, "rev_growth_yoy": 0.05}},
            "C": {"derived": {"pe_ttm": 18.0, "rev_growth_yoy": 0.03}},
        }
    }
    out = sector_aggregates(universe, fundamentals)
    assert set(out["sectors"].keys()) == {"Tech", "Health"}
    assert out["sectors"]["Tech"]["members"] == ["A", "B"]
    assert out["sectors"]["Tech"]["median_pe_ttm"] == 25.0
    assert out["sectors"]["Health"]["weighted_market_cap"] == 2e11
