"""Verify the routing matrix: each (mode, method) maps to the right provider,
sector_fallback peers behave correctly, mode constraints are enforced."""
from __future__ import annotations

import pytest

from pipeline.providers.router import Router


def test_hybrid_mode_routes(yf_provider, fmp_provider):
    r = Router("hybrid", yf=yf_provider, fmp=fmp_provider)

    r.get_prices("AAPL", 30)
    r.get_fundamentals("AAPL", 8)
    r.get_profile("AAPL")  # caches profile so peers fallback works
    r.get_peers("AAPL")

    assert yf_provider.calls["get_prices"] == [("AAPL", 30)]
    assert fmp_provider.calls["get_fundamentals"] == [("AAPL", 8)]
    assert fmp_provider.calls["get_profile"] == ["AAPL"]
    assert fmp_provider.calls["get_peers"] == ["AAPL"]
    assert yf_provider.calls["get_fundamentals"] == []
    assert yf_provider.calls["get_profile"] == []


def test_yfinance_mode_routes(yf_provider, fmp_provider):
    r = Router("yfinance", yf=yf_provider, fmp=fmp_provider)

    r.get_profile("AAPL")  # caches AAPL profile
    r.get_profile("MSFT")  # caches MSFT (same sector by default)

    r.get_prices("AAPL", 30)
    r.get_fundamentals("AAPL", 8)
    peers = r.get_peers("AAPL")

    assert yf_provider.calls["get_prices"] == [("AAPL", 30)]
    assert yf_provider.calls["get_fundamentals"] == [("AAPL", 8)]
    assert yf_provider.calls["get_profile"] == ["AAPL", "MSFT"]
    assert fmp_provider.calls["get_peers"] == []  # never called
    assert peers.source == "sector_fallback"
    assert {p.ticker for p in peers.peers} == {"MSFT"}


def test_fmp_mode_warns_then_routes(yf_provider, fmp_provider, caplog):
    import logging
    caplog.set_level(logging.WARNING, logger="pipeline.providers.router")
    r = Router("fmp", yf=yf_provider, fmp=fmp_provider)
    assert any("free tier" in rec.message for rec in caplog.records)

    r.get_prices("AAPL", 30)
    r.get_fundamentals("AAPL", 8)
    r.get_profile("AAPL")
    r.get_peers("AAPL")

    for kind in ("get_prices", "get_fundamentals", "get_profile", "get_peers"):
        assert fmp_provider.calls[kind], f"{kind} should hit FMP"
    assert all(not v for v in yf_provider.calls.values()), "yfinance must not be touched"


def test_hybrid_requires_fmp(yf_provider):
    with pytest.raises(RuntimeError, match="requires"):
        Router("hybrid", yf=yf_provider, fmp=None)


def test_fmp_mode_requires_fmp(yf_provider):
    with pytest.raises(RuntimeError, match="requires"):
        Router("fmp", yf=yf_provider, fmp=None)


def test_yfinance_mode_does_not_require_fmp(yf_provider):
    Router("yfinance", yf=yf_provider, fmp=None)


def test_unknown_mode_rejected(yf_provider, fmp_provider):
    with pytest.raises(ValueError, match="unknown routing mode"):
        Router("turbo", yf=yf_provider, fmp=fmp_provider)  # type: ignore[arg-type]


def test_hybrid_falls_back_to_sector_when_fmp_returns_empty_peers(yf_provider, fmp_provider, monkeypatch):
    """If FMP returns no peers, hybrid should auto-substitute the sector
    fallback so consumers always have something to work with."""
    from pipeline.providers.schemas import Peers

    def empty_peers(ticker: str) -> Peers:
        return Peers(ticker=ticker, peers=[], source="fmp", fetched_at=_now())

    fmp_provider.get_peers = empty_peers  # type: ignore[assignment]

    r = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    r.get_profile("AAPL")
    r.get_profile("MSFT")
    peers = r.get_peers("AAPL")
    assert peers.source == "sector_fallback"
    assert any(p.ticker == "MSFT" for p in peers.peers)


def test_provider_counters(yf_provider, fmp_provider):
    r = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    r.get_prices("A", 30)
    r.get_prices("B", 30)
    r.get_fundamentals("A", 8)
    r.get_profile("A")
    counts = r.provider_counts()
    assert counts["prices"]["yfinance"] == 2
    assert counts["fundamentals"]["fmp"] == 1
    assert counts["profile"]["fmp"] == 1


def _now():
    from datetime import datetime, timezone
    return datetime.now(timezone.utc)
