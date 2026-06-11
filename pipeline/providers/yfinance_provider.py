"""yfinance provider. Adapts the rather noisy yfinance API into the same
typed-pydantic shape every other provider returns."""
from __future__ import annotations

import logging
from datetime import date, datetime, timezone
from typing import Any

from tenacity import retry, stop_after_attempt, wait_exponential

from .base import DataProvider, ProviderError
from .schemas import (
    Fundamentals,
    FundamentalsQuarter,
    Peer,
    Peers,
    PricePoint,
    PriceSeries,
    Profile,
)

log = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _quarter_label(d: date) -> str:
    return f"{d.year}-Q{((d.month - 1) // 3) + 1}"


def _safe_float(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f:  # NaN
        return None
    return f


def _safe_int(v: Any) -> int:
    f = _safe_float(v)
    return int(f) if f is not None else 0


class YfinanceProvider(DataProvider):
    name = "yfinance"

    def __init__(self, *, ticker_factory: Any = None) -> None:
        # Lazy import keeps tests cheap when yfinance isn't on the path.
        if ticker_factory is None:
            import yfinance  # noqa: WPS433
            ticker_factory = yfinance.Ticker
        self._ticker_factory = ticker_factory

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=1, max=15), reraise=True)
    def _ticker(self, symbol: str) -> Any:
        return self._ticker_factory(symbol)

    # ---------- public API ----------

    def get_prices(self, ticker: str, days: int) -> PriceSeries:
        period = self._period_for_days(days)
        try:
            t = self._ticker(ticker)
            hist = t.history(period=period, auto_adjust=True, actions=False)
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"yfinance history failed for {ticker}: {exc}") from exc

        points: list[PricePoint] = []
        if hist is None or hist.empty:
            return PriceSeries(ticker=ticker, points=points, source="yfinance", fetched_at=_now())

        for ts, row in hist.iterrows():
            d = ts.date() if hasattr(ts, "date") else date.fromisoformat(str(ts)[:10])
            close = _safe_float(row.get("Close"))
            if close is None:
                continue
            points.append(
                PricePoint(date=d, close=close, volume=_safe_int(row.get("Volume")))
            )
        return PriceSeries(ticker=ticker, points=points, source="yfinance", fetched_at=_now())

    def get_fundamentals(self, ticker: str, quarters: int) -> Fundamentals:
        try:
            t = self._ticker(ticker)
            qf = getattr(t, "quarterly_financials", None)
            qbs = getattr(t, "quarterly_balance_sheet", None)
            qcf = getattr(t, "quarterly_cashflow", None)
            info = getattr(t, "info", {}) or {}
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"yfinance fundamentals failed for {ticker}: {exc}") from exc

        # yfinance frames are columns=date, rows=line items. We zip the columns
        # newest-first.
        cols = []
        if qf is not None and not getattr(qf, "empty", True):
            cols = list(qf.columns)[:quarters]

        out: list[FundamentalsQuarter] = []
        shares = _safe_float(info.get("sharesOutstanding"))
        for col in cols:
            try:
                fde = col.date() if hasattr(col, "date") else date.fromisoformat(str(col)[:10])
            except (ValueError, TypeError):
                continue
            revenue = _safe_float(_get(qf, col, "Total Revenue"))
            net_income = _safe_float(_get(qf, col, "Net Income"))
            op_income = _safe_float(_get(qf, col, "Operating Income"))
            gross_profit = _safe_float(_get(qf, col, "Gross Profit"))
            if gross_profit is None:
                cogs = _safe_float(_get(qf, col, "Cost Of Revenue"))
                if revenue is not None and cogs is not None:
                    gross_profit = revenue - cogs
            total_debt = _safe_float(_get(qbs, col, "Total Debt"))
            cash = _safe_float(_get(qbs, col, "Cash And Cash Equivalents"))
            total_assets = _safe_float(_get(qbs, col, "Total Assets"))
            total_equity = _safe_float(_get(qbs, col, "Total Stockholder Equity"))
            if total_equity is None:
                total_equity = _safe_float(_get(qbs, col, "Stockholders Equity"))
            fcf = _safe_float(_get(qcf, col, "Free Cash Flow"))
            eps = (net_income / shares) if (net_income is not None and shares) else None
            op_margin = (op_income / revenue) if (revenue and op_income is not None) else None
            out.append(
                FundamentalsQuarter(
                    period=_quarter_label(fde),
                    fiscal_date_ending=fde,
                    revenue=revenue,
                    net_income=net_income,
                    eps=eps,
                    shares_outstanding=shares,
                    free_cash_flow=fcf,
                    total_debt=total_debt,
                    cash=cash,
                    operating_margin=op_margin,
                    gross_profit=gross_profit,
                    operating_income=op_income,
                    total_assets=total_assets,
                    total_equity=total_equity,
                )
            )
        return Fundamentals(ticker=ticker, quarters=out, source="yfinance", fetched_at=_now())

    def get_peers(self, ticker: str) -> Peers:
        # yfinance has no dedicated peers endpoint. Returning empty signals to
        # the router that it should run sector_fallback approximation.
        return Peers(ticker=ticker, peers=[], source="yfinance", fetched_at=_now())

    def get_profile(self, ticker: str) -> Profile:
        try:
            t = self._ticker(ticker)
            info = getattr(t, "info", {}) or {}
        except Exception as exc:  # noqa: BLE001
            raise ProviderError(f"yfinance profile failed for {ticker}: {exc}") from exc

        return Profile(
            ticker=ticker,
            name=info.get("longName") or info.get("shortName") or ticker,
            sector=info.get("sector"),
            industry=info.get("industry"),
            market_cap=_safe_float(info.get("marketCap")),
            country=info.get("country"),
            exchange=info.get("exchange"),
            logo_url=None,
            currency=info.get("currency"),
            source="yfinance",
            fetched_at=_now(),
        )

    @staticmethod
    def _period_for_days(days: int) -> str:
        if days <= 7:
            return "5d"
        if days <= 30:
            return "1mo"
        if days <= 90:
            return "3mo"
        if days <= 365:
            return "1y"
        if days <= 365 * 2:
            return "2y"
        if days <= 365 * 5:
            return "5y"
        if days <= 365 * 10:
            return "10y"
        return "max"


def _get(frame: Any, col: Any, row_label: str) -> Any:
    if frame is None or getattr(frame, "empty", True):
        return None
    if row_label not in frame.index:
        return None
    try:
        return frame.at[row_label, col]
    except (KeyError, ValueError):
        return None
