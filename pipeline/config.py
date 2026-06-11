"""Path + env configuration. Single source of truth for repo layout."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from dotenv import load_dotenv

REPO_ROOT = Path(__file__).resolve().parent.parent
PIPELINE_DIR = REPO_ROOT / "pipeline"
DATA_DIR = REPO_ROOT / "public" / "data"
TICKERS_FILE = PIPELINE_DIR / "tickers.json"
FMP_CALL_LOG = PIPELINE_DIR / ".fmp_call_log.json"

# Output files.
UNIVERSE_JSON = DATA_DIR / "universe.json"
PRICES_JSON = DATA_DIR / "prices.json"
FUNDAMENTALS_JSON = DATA_DIR / "fundamentals.json"
CORRELATIONS_JSON = DATA_DIR / "correlations.json"
SECTORS_JSON = DATA_DIR / "sectors.json"
METADATA_JSON = DATA_DIR / "metadata.json"

MARKET_DIR = DATA_DIR / "market"
MARKET_GEX_JSON = MARKET_DIR / "gex.json"
FX_JSON = DATA_DIR / "fx.json"

PATENTS_JSON = DATA_DIR / "patents.json"
PATENTS_CACHE_DIR = PIPELINE_DIR / ".patents_cache"
PATENTS_BULK_DIR = PIPELINE_DIR / ".patents_bulk"
PATENTS_DB = PIPELINE_DIR / ".patents.duckdb"
PATENT_IMAGES_DIR = DATA_DIR / "patents" / "images"
PATENT_SUMMARIES_JSON = DATA_DIR / "patents" / "summaries.json"
PATENT_SUMMARIES_CACHE = PIPELINE_DIR / ".patent_summaries_cache.json"

DATA_VERSION_SCHEMA = 1

# Tunables.
PRICE_HISTORY_DAYS = 10 * 365
QUARTERS_BACK = 40
CORRELATION_WINDOW = 252
FMP_DAILY_QUOTA = 250
QUARTERLY_CURRENT_DAYS = 90

RoutingMode = Literal["hybrid", "yfinance", "fmp"]


def load_env() -> None:
    """Load .env.local and .env (latter wins on duplicates is `override=False`)."""
    load_dotenv(REPO_ROOT / ".env.local", override=False)
    load_dotenv(REPO_ROOT / ".env", override=False)


def get_mode() -> RoutingMode:
    raw = os.environ.get("DATA_PROVIDER", "hybrid").strip().lower()
    if raw not in {"hybrid", "yfinance", "fmp"}:
        raise ValueError(f"DATA_PROVIDER must be hybrid|yfinance|fmp, got {raw!r}")
    return raw  # type: ignore[return-value]


def get_fmp_key() -> str | None:
    key = os.environ.get("FMP_API_KEY", "").strip()
    return key or None


