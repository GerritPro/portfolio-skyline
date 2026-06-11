"""Re-running pull_daily on the same calendar day must not re-issue any
provider calls. Same for pull_quarterly --incremental when the latest
fiscal quarter is already current."""
from __future__ import annotations

from pathlib import Path

import pytest

from pipeline import compute_derived, config, pull_daily, pull_quarterly
from pipeline.providers.router import Router


@pytest.fixture
def tmp_data_dir(tmp_path, monkeypatch):
    """Redirect every output-file path in `pipeline.config` to a tmp dir."""
    data_dir = tmp_path / "public" / "data"
    pipeline_dir = tmp_path / "pipeline"
    data_dir.mkdir(parents=True)
    pipeline_dir.mkdir(parents=True)

    monkeypatch.setattr(config, "DATA_DIR", data_dir)
    monkeypatch.setattr(config, "PIPELINE_DIR", pipeline_dir)
    monkeypatch.setattr(config, "TICKERS_FILE", pipeline_dir / "tickers.json")
    monkeypatch.setattr(config, "FMP_CALL_LOG", pipeline_dir / ".fmp_call_log.json")
    monkeypatch.setattr(config, "UNIVERSE_JSON", data_dir / "universe.json")
    monkeypatch.setattr(config, "PRICES_JSON", data_dir / "prices.json")
    monkeypatch.setattr(config, "FUNDAMENTALS_JSON", data_dir / "fundamentals.json")
    monkeypatch.setattr(config, "CORRELATIONS_JSON", data_dir / "correlations.json")
    monkeypatch.setattr(config, "SECTORS_JSON", data_dir / "sectors.json")
    monkeypatch.setattr(config, "METADATA_JSON", data_dir / "metadata.json")
    # mirror onto the modules that imported the constants by name
    for mod in (pull_daily, pull_quarterly, compute_derived):
        for attr in [
            "TICKERS_FILE", "FMP_CALL_LOG", "UNIVERSE_JSON", "PRICES_JSON",
            "FUNDAMENTALS_JSON", "CORRELATIONS_JSON", "SECTORS_JSON", "METADATA_JSON",
            "DATA_DIR", "PIPELINE_DIR",
        ]:
            if hasattr(mod, attr):
                monkeypatch.setattr(mod, attr, getattr(config, attr))
    # tickers file
    import json
    (pipeline_dir / "tickers.json").write_text(
        json.dumps({"sp100": ["AAPL", "MSFT"], "custom": []}), encoding="utf-8"
    )
    return data_dir


def _reset_call_counts(*providers):
    for p in providers:
        for v in p.calls.values():
            v.clear()


def test_daily_idempotent(tmp_data_dir, yf_provider, fmp_provider):
    router = Router("hybrid", yf=yf_provider, fmp=fmp_provider)

    # first run: should fetch
    pull_daily.run(router=router)
    assert yf_provider.calls["get_prices"], "first run should fetch prices"
    assert fmp_provider.calls["get_profile"], "first run should fetch profiles"

    _reset_call_counts(yf_provider, fmp_provider)

    # second run on the same day: 0 new fetches expected
    router2 = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    pull_daily.run(router=router2)
    assert yf_provider.calls["get_prices"] == [], "no price refetch on same day"
    assert fmp_provider.calls["get_profile"] == [], "no profile refetch on same day"


def test_quarterly_incremental_skips_when_current(tmp_data_dir, yf_provider, fmp_provider):
    router = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    pull_quarterly.run(router=router, incremental=True)
    assert fmp_provider.calls["get_fundamentals"], "first run fetches"

    _reset_call_counts(yf_provider, fmp_provider)
    router2 = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    pull_quarterly.run(router=router2, incremental=True)
    # Our synthetic fundamentals fixture's newest quarter is today, so latest
    # quarter is well within 100 days ⇒ incremental must skip.
    assert fmp_provider.calls["get_fundamentals"] == [], "incremental run should skip current tickers"


def test_quarterly_full_force_refetches(tmp_data_dir, yf_provider, fmp_provider):
    router = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    pull_quarterly.run(router=router, incremental=True)

    _reset_call_counts(yf_provider, fmp_provider)
    router2 = Router("hybrid", yf=yf_provider, fmp=fmp_provider)
    pull_quarterly.run(router=router2, incremental=False, force=True)
    assert fmp_provider.calls["get_fundamentals"], "--full should refetch"
