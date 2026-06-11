"""The router is the only thing pipeline scripts talk to. It owns the
decision of which underlying provider services each call, plus the
sector_fallback peer approximation."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Literal

from .base import DataProvider, ProviderError, QuotaExceeded
from .schemas import Fundamentals, Peer, Peers, PriceSeries, Profile

log = logging.getLogger(__name__)

RoutingMode = Literal["hybrid", "yfinance", "fmp"]
ProviderTag = Literal["yf", "fmp", "sector_fallback"]

ROUTES: dict[RoutingMode, dict[str, ProviderTag]] = {
    # Peers always use sector_fallback (local computation, no API cost). The
    # FMP peers endpoint would otherwise burn the daily 250-call quota at
    # ~500-ticker universe scale, and the dashboard's sector-median path
    # already covers the peer-comparison need without it.
    "hybrid":   {"prices": "yf",  "fundamentals": "fmp", "peers": "sector_fallback",  "profile": "fmp"},
    "yfinance": {"prices": "yf",  "fundamentals": "yf",  "peers": "sector_fallback",  "profile": "yf"},
    "fmp":      {"prices": "fmp", "fundamentals": "fmp", "peers": "fmp",              "profile": "fmp"},
}


# Known foreign-exchange suffixes (allowlist). Anything else with a dot is
# treated as a US class-share notation (e.g., BRK.B, BF.B) and routed to
# EDGAR/FMP. Single-letter foreign suffixes (London .L, Tokyo .T, Toronto .V,
# Frankfurt .F) are included explicitly.
_FOREIGN_SUFFIXES = {
    "HK", "T", "L", "DE", "PA", "AS", "SW", "TO", "AX", "NS", "BO",
    "SS", "SZ", "V", "F", "BR", "MC", "MI", "MX", "OL", "ST", "CO",
    "HE", "WA", "VI", "IS", "AT", "SA", "TA", "KS", "KQ", "JO",
}


def _is_non_us(ticker: str) -> bool:
    """Detect foreign listings by an allowlist of known exchange suffixes,
    so US class-share notations like BRK.B / BF.B stay routed to EDGAR.
    Numeric prefixes (e.g., 1211.HK, 4901.T) are always foreign."""
    t = (ticker or "").strip().upper()
    if "." not in t:
        return False
    prefix, _, suffix = t.partition(".")
    if any(ch.isdigit() for ch in prefix):
        return True
    return suffix in _FOREIGN_SUFFIXES


class Router:
    def __init__(
        self,
        mode: RoutingMode,
        *,
        yf: DataProvider,
        fmp: DataProvider | None,
        xbrl: DataProvider | None = None,
    ) -> None:
        if mode not in ROUTES:
            raise ValueError(f"unknown routing mode: {mode!r}")
        if mode in {"hybrid", "fmp"} and fmp is None:
            raise RuntimeError(
                f"mode={mode!r} requires an FMP provider (set FMP_API_KEY)"
            )
        if mode == "fmp":
            log.warning(
                "DATA_PROVIDER=fmp — every call hits FMP; the 250/day free tier "
                "WILL be exceeded for a 100-ticker universe."
            )
        self.mode: RoutingMode = mode
        self.yf = yf
        self.fmp = fmp
        self.xbrl = xbrl
        self._profile_cache: dict[str, Profile] = {}
        self._provider_counters: dict[str, dict[str, int]] = {
            "prices": {}, "fundamentals": {}, "peers": {}, "profile": {},
        }

    # ---------- public methods ----------

    def get_prices(self, ticker: str, days: int) -> PriceSeries:
        target = ROUTES[self.mode]["prices"]
        provider = self._resolve(target)
        result = provider.get_prices(ticker, days)
        self._tally("prices", result.source)
        return result

    def get_fundamentals(self, ticker: str, quarters: int) -> Fundamentals:
        if _is_non_us(ticker):
            log.info("routing %s to yfinance (non-US suffix)", ticker)
            result = self.yf.get_fundamentals(ticker, quarters)
            self._tally("fundamentals", result.source)
            return result

        # US listings: prefer SEC EDGAR XBRL (free, 20+ quarters), fall back
        # to FMP (per mode), and finally yfinance.
        if self.xbrl is not None:
            try:
                result = self.xbrl.get_fundamentals(ticker, quarters)
                log.info("EDGAR XBRL: %s -> %d quarters", ticker, len(result.quarters))
                self._tally("fundamentals", result.source)
                return result
            except ProviderError as exc:
                log.warning("EDGAR failed for %s (%s); trying configured fallback", ticker, exc)

        target = ROUTES[self.mode]["fundamentals"]
        try:
            provider = self._resolve(target)
            result = provider.get_fundamentals(ticker, quarters)
        except QuotaExceeded:
            # FMP quota burnt — fall to yfinance for this ticker instead of
            # aborting the rest of the run. EDGAR-success path is unaffected
            # (no FMP touched), so the rest of the universe still pulls
            # normally; only EDGAR-failed tickers degrade to yfinance.
            log.warning(
                "FMP quota exceeded for %s; falling back to yfinance",
                ticker,
            )
            result = self.yf.get_fundamentals(ticker, quarters)
        except ProviderError as exc:
            if target == "fmp":
                log.warning(
                    "FMP failed for %s (%s); falling back to yfinance (may have limited history)",
                    ticker,
                    exc,
                )
                result = self.yf.get_fundamentals(ticker, quarters)
            else:
                raise
        self._tally("fundamentals", result.source)
        return result

    def get_peers(self, ticker: str) -> Peers:
        if _is_non_us(ticker):
            # FMP peers endpoint doesn't know foreign tickers — use the sector
            # fallback against the locally-cached profile catalog.
            result = self._approximate_peers(ticker)
            self._tally("peers", result.source)
            return result
        target = ROUTES[self.mode]["peers"]
        if target == "sector_fallback":
            result = self._approximate_peers(ticker)
        else:
            provider = self._resolve(target)
            result = provider.get_peers(ticker)
            if not result.peers and self.mode == "hybrid":
                # FMP returned nothing for this symbol — try sector fallback
                # so the consumer never gets a useless empty list silently.
                fb = self._approximate_peers(ticker)
                if fb.peers:
                    result = fb
        self._tally("peers", result.source)
        return result

    def get_profile(self, ticker: str) -> Profile:
        if _is_non_us(ticker):
            log.info("routing profile %s to yfinance (non-US suffix)", ticker)
            result = self.yf.get_profile(ticker)
        else:
            target = ROUTES[self.mode]["profile"]
            try:
                provider = self._resolve(target)
                result = provider.get_profile(ticker)
            except (ProviderError, QuotaExceeded) as exc:
                # FMP /v3/profile is legacy-blocked on the free tier — fall
                # back to yfinance so the universe still gets sector/industry
                # metadata for SP500 tickers.
                log.warning(
                    "profile route %s failed for %s (%s); falling back to yfinance",
                    target, ticker, exc,
                )
                result = self.yf.get_profile(ticker)
        self._profile_cache[ticker.upper()] = result
        self._tally("profile", result.source)
        return result

    # ---------- inspection ----------

    def provider_counts(self) -> dict[str, dict[str, int]]:
        return {k: dict(v) for k, v in self._provider_counters.items()}

    # ---------- internals ----------

    def _resolve(self, tag: ProviderTag) -> DataProvider:
        if tag == "yf":
            return self.yf
        if tag == "fmp":
            assert self.fmp is not None
            return self.fmp
        raise ValueError(f"_resolve called with non-provider tag {tag!r}")

    def _tally(self, kind: str, source: str) -> None:
        bucket = self._provider_counters[kind]
        bucket[source] = bucket.get(source, 0) + 1

    def _approximate_peers(self, ticker: str) -> Peers:
        """Approximate peers as 'companies in the same sector that we already
        have profile data for'. Returns at most 5 peers excluding the ticker
        itself. If profile data for the ticker is missing, returns empty."""
        ticker_u = ticker.upper()
        target = self._profile_cache.get(ticker_u)
        if target is None or not target.sector:
            return Peers(
                ticker=ticker,
                peers=[],
                source="sector_fallback",
                fetched_at=datetime.now(timezone.utc),
            )
        same_sector: list[Peer] = []
        for sym, prof in self._profile_cache.items():
            if sym == ticker_u or prof.sector != target.sector:
                continue
            same_sector.append(Peer(ticker=prof.ticker, name=prof.name))
        # Stable order — alphabetical by ticker so re-runs produce identical output.
        same_sector.sort(key=lambda p: p.ticker)
        return Peers(
            ticker=ticker,
            peers=same_sector[:5],
            source="sector_fallback",
            fetched_at=datetime.now(timezone.utc),
        )

    def seed_profile_cache(self, profiles: dict[str, Profile]) -> None:
        """Loaded from disk at the start of a run so peer-fallback works even
        when the provider chain didn't issue a fresh profile call this time."""
        for k, v in profiles.items():
            self._profile_cache[k.upper()] = v
