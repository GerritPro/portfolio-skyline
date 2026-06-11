"""Insider-pull parser + summarizer tests."""
from __future__ import annotations

from pipeline.pull_insider import (
    InsiderTx,
    _cluster_signal,
    _parse_openinsider_html,
    _summarize,
)

OPENINSIDER_FIXTURE = """
<html><body>
<table class="tinytable">
  <tr><th>X</th><th>Filing Date</th><th>Trade Date</th><th>Ticker</th><th>Insider</th><th>Title</th><th>Trade Type</th><th>Price</th><th>Qty</th><th>Owned</th><th>ΔOwn</th><th>Value</th></tr>
  <tr>
    <td></td><td>2026-04-22 09:30:00</td><td>2026-04-20</td><td>NVDA</td>
    <td>Smith, John</td><td>CEO</td><td>P - Purchase</td>
    <td>$1180.45</td><td>+5,000</td><td>10,000</td><td>+100%</td><td>+$5,902,250</td>
  </tr>
  <tr class="rule10b5-1">
    <td></td><td>2026-04-15 16:00:00</td><td>2026-04-14</td><td>NVDA</td>
    <td>Doe, Jane</td><td>CFO</td><td>S - Sale</td>
    <td>$1150.00</td><td>-2,000</td><td>50,000</td><td>-4%</td><td>-$2,300,000</td>
  </tr>
  <tr>
    <td></td><td>2026-04-10 12:00:00</td><td>2026-04-08</td><td>NVDA</td>
    <td>Brown, Alice</td><td>Director</td><td>A - Grant</td>
    <td>$0.00</td><td>+1,000</td><td>5,000</td><td>+25%</td><td>$0</td>
  </tr>
</table>
</body></html>
"""


def test_parse_openinsider_extracts_rows():
    txs = _parse_openinsider_html(OPENINSIDER_FIXTURE)
    assert len(txs) == 3
    p = txs[0]
    assert p.insider_name == "Smith, John"
    assert p.title == "CEO"
    assert p.type == "P"
    assert p.shares == 5000
    assert p.price == 1180.45
    assert p.value == 5902250
    assert p.is_10b51 is False

    s = txs[1]
    assert s.type == "S"
    assert s.is_10b51 is True

    a = txs[2]
    assert a.type == "A"


def test_summarize_excludes_awards_and_10b51_sales():
    txs = [
        InsiderTx("2026-04-22", "2026-04-20", "A", "CEO", "P", 100, 100, 10000, False),
        InsiderTx("2026-04-21", "2026-04-19", "B", "CFO", "S", 50, 200, 10000, False),
        InsiderTx("2026-04-20", "2026-04-18", "C", "CFO", "S", 50, 200, 10000, True),  # 10b5-1, excluded
        InsiderTx("2026-04-19", "2026-04-17", "D", "Director", "A", 10, 0, 0, False),  # award, excluded
    ]
    summary = _summarize(txs)
    # net = 10000 (P from A) - 10000 (S from B) = 0; 10b5-1 sale and award excluded.
    assert summary["net_buy_sell_90d"] == 0.0
    assert summary["insider_count_90d"] == 2  # A and B
    assert summary["cluster_signal"] is False
    assert summary["latest_activity"] == "2026-04-20"


def test_cluster_signal_detects_three_buyers_in_14_day_window():
    txs = [
        InsiderTx("2026-04-22", "2026-04-20", "A", "CEO", "P", 100, 100, 10000, False),
        InsiderTx("2026-04-21", "2026-04-18", "B", "Director", "P", 50, 100, 5000, False),
        InsiderTx("2026-04-19", "2026-04-15", "C", "CFO", "P", 30, 100, 3000, False),
    ]
    assert _cluster_signal(txs) is True


def test_cluster_signal_false_if_window_spans_more_than_14_days():
    txs = [
        InsiderTx("2026-04-22", "2026-04-20", "A", "CEO", "P", 100, 100, 10000, False),
        InsiderTx("2026-04-21", "2026-04-04", "B", "Director", "P", 50, 100, 5000, False),
        InsiderTx("2026-04-19", "2026-04-01", "C", "CFO", "P", 30, 100, 3000, False),
    ]
    assert _cluster_signal(txs) is False
