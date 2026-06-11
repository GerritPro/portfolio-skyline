"""Black-Scholes gamma + SPY-options aggregation. Pure math, no I/O.
Convention follows SpotGamma: dealers are assumed short customer options
flow, so long-call OI contributes positive gamma exposure and long-put OI
contributes negative."""
from __future__ import annotations

import math
from typing import Iterable

EPS = 1e-9


def phi(x: float) -> float:
    """Standard normal PDF."""
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def bs_gamma(S: float, K: float, r: float, sigma: float, T: float) -> float:
    """Black-Scholes gamma per share. Returns 0 for degenerate inputs."""
    if S <= 0 or K <= 0 or sigma <= 0 or T <= 0:
        return 0.0
    denom = sigma * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / denom
    return phi(d1) / (S * denom)


def gex_contribution(
    S: float,
    K: float,
    r: float,
    T: float,
    oi_call: int,
    iv_call: float,
    oi_put: int,
    iv_put: float,
) -> float:
    """GEX in $/1%-move for one strike across one expiry.
    Multiplier 100 = options contract size; S² · 0.01 normalizes gamma
    (∂Δ/∂S) into dollar exposure per 1% spot move."""
    gex = 0.0
    if oi_call > 0 and iv_call > 0:
        g_call = bs_gamma(S, K, r, iv_call, T)
        gex += g_call * oi_call
    if oi_put > 0 and iv_put > 0:
        g_put = bs_gamma(S, K, r, iv_put, T)
        gex -= g_put * oi_put
    return gex * 100.0 * S * S * 0.01


def aggregate_profile(
    contracts: Iterable[dict],
    spot: float,
    rate: float,
    *,
    bucket: float = 5.0,
) -> list[dict]:
    """Aggregate per-contract entries into a per-strike profile, bucketed.
    contracts: iterable of {strike, type ('call'|'put'), oi, iv, T}.
    Returns oldest-first list of {strike, gex_total, gex_call, gex_put}."""
    grouped: dict[float, dict[str, list[dict]]] = {}
    for c in contracts:
        k_bucket = round(c["strike"] / bucket) * bucket
        slot = grouped.setdefault(k_bucket, {"call": [], "put": []})
        slot[c["type"]].append(c)

    profile: list[dict] = []
    for k in sorted(grouped):
        gex_call = 0.0
        gex_put = 0.0
        for c in grouped[k]["call"]:
            g = bs_gamma(spot, c["strike"], rate, c["iv"], c["T"])
            gex_call += g * c["oi"]
        for c in grouped[k]["put"]:
            g = bs_gamma(spot, c["strike"], rate, c["iv"], c["T"])
            gex_put -= g * c["oi"]
        scale = 100.0 * spot * spot * 0.01
        profile.append(
            {
                "strike": float(k),
                "gex_call": gex_call * scale,
                "gex_put": gex_put * scale,
                "gex_total": (gex_call + gex_put) * scale,
            }
        )
    return profile


def find_flip_level(profile: list[dict], spot: float) -> float | None:
    """Cumulative GEX from highest strike down; find the strike where the
    running sum crosses zero. Returns the linearly-interpolated price."""
    if not profile:
        return None
    sorted_desc = sorted(profile, key=lambda p: p["strike"], reverse=True)
    cum = 0.0
    prev_strike: float | None = None
    prev_cum: float | None = None
    for p in sorted_desc:
        cum += p["gex_total"]
        if prev_strike is not None and prev_cum is not None:
            if (prev_cum >= 0 > cum) or (prev_cum <= 0 < cum):
                if cum == prev_cum:
                    return float(p["strike"])
                # Linear interpolate the strike where cumulative GEX == 0.
                t = prev_cum / (prev_cum - cum)
                return prev_strike + (p["strike"] - prev_strike) * t
        prev_strike = p["strike"]
        prev_cum = cum
    # Reference: snap to nearest strike to spot if no sign change.
    return None


def find_call_wall(profile: list[dict], spot: float) -> dict | None:
    """Strike above spot with the largest positive gex_total."""
    best: dict | None = None
    for p in profile:
        if p["strike"] <= spot:
            continue
        if p["gex_total"] <= 0:
            continue
        if best is None or p["gex_total"] > best["gex_total"]:
            best = p
    if best is None:
        return None
    return {"strike": float(best["strike"]), "gex": float(best["gex_total"])}


def find_put_wall(profile: list[dict], spot: float) -> dict | None:
    """Strike below spot with the most negative gex_total."""
    best: dict | None = None
    for p in profile:
        if p["strike"] >= spot:
            continue
        if p["gex_total"] >= 0:
            continue
        if best is None or p["gex_total"] < best["gex_total"]:
            best = p
    if best is None:
        return None
    return {"strike": float(best["strike"]), "gex": float(best["gex_total"])}
