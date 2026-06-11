"""Smoke tests for compute_gex math + helpers."""
from __future__ import annotations

from pipeline import compute_gex


def test_phi_at_zero():
    assert abs(compute_gex.phi(0.0) - 0.3989422804014327) < 1e-9


def test_bs_gamma_atm_known_value():
    # S=100, K=100, r=5%, σ=20%, T=0.5y → gamma ≈ 0.02782
    g = compute_gex.bs_gamma(100.0, 100.0, 0.05, 0.20, 0.5)
    assert 0.027 < g < 0.029, f"unexpected gamma {g}"


def test_bs_gamma_degenerate():
    assert compute_gex.bs_gamma(100, 100, 0.05, 0.20, 0) == 0.0
    assert compute_gex.bs_gamma(100, 100, 0.05, 0, 0.5) == 0.0
    assert compute_gex.bs_gamma(0, 100, 0.05, 0.20, 0.5) == 0.0


def test_aggregate_profile_buckets_by_5():
    contracts = [
        {"strike": 100, "type": "call", "oi": 1000, "iv": 0.20, "T": 0.5},
        {"strike": 101, "type": "call", "oi": 500, "iv": 0.20, "T": 0.5},
        {"strike": 100, "type": "put", "oi": 800, "iv": 0.20, "T": 0.5},
    ]
    profile = compute_gex.aggregate_profile(contracts, spot=100.0, rate=0.05, bucket=5.0)
    assert len(profile) == 1
    p = profile[0]
    assert p["strike"] == 100.0
    assert p["gex_call"] > 0
    assert p["gex_put"] < 0
    assert abs(p["gex_total"] - (p["gex_call"] + p["gex_put"])) < 1e-6


def test_find_flip_level_crossing():
    # Cumulative GEX from top: at strike 110 = +5, at 105 = +3, at 100 = -2, at 95 = -8.
    # Each per-strike contribution = current cum - previous cum (going down):
    # 110: +5, 105: -2 (3-5), 100: -5 (-2-3), 95: -6 (-8-(-2)).
    profile = [
        {"strike": 95.0, "gex_total": -6.0},
        {"strike": 100.0, "gex_total": -5.0},
        {"strike": 105.0, "gex_total": -2.0},
        {"strike": 110.0, "gex_total": 5.0},
    ]
    flip = compute_gex.find_flip_level(profile, spot=102.5)
    # Should be between 100 and 105 where cumulative crosses zero.
    assert flip is not None and 100.0 < flip < 105.0


def test_find_call_wall_picks_max_positive_above_spot():
    profile = [
        {"strike": 95.0, "gex_total": -10.0},
        {"strike": 100.0, "gex_total": 2.0},
        {"strike": 105.0, "gex_total": 8.0},
        {"strike": 110.0, "gex_total": 5.0},
    ]
    wall = compute_gex.find_call_wall(profile, spot=100.0)
    assert wall == {"strike": 105.0, "gex": 8.0}


def test_find_put_wall_picks_most_negative_below_spot():
    profile = [
        {"strike": 90.0, "gex_total": -7.0},
        {"strike": 95.0, "gex_total": -12.0},
        {"strike": 100.0, "gex_total": -1.0},
        {"strike": 105.0, "gex_total": 3.0},
    ]
    wall = compute_gex.find_put_wall(profile, spot=100.0)
    assert wall == {"strike": 95.0, "gex": -12.0}
