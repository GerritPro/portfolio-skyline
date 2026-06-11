"""Pulls last-90-days Form-4 insider transactions per ticker.
Primary: openinsider.com scrape (BeautifulSoup). Fallback: SEC EDGAR.
Writes public/data/stocks/{TICKER}/insider.json."""
from __future__ import annotations

import json
import logging
import sys
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urljoin
from xml.etree import ElementTree as ET

import requests
from bs4 import BeautifulSoup
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, today_utc, write_json  # noqa: E402

log = logging.getLogger(__name__)

USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"
OPENINSIDER_URL = "http://openinsider.com/screener"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SEC_SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"
CIK_CACHE_PATH = config.PIPELINE_DIR / ".cik_map.json"


@dataclass
class InsiderTx:
    filing_date: str
    trade_date: str
    insider_name: str
    title: str
    type: str  # "P" | "S" | "A" | "G" | "M" | other
    shares: float
    price: float | None
    value: float | None
    is_10b51: bool


# ---------- openinsider scrape ----------

@retry(
    retry=retry_if_exception_type(requests.RequestException),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
def _http_get(url: str, params: dict | None = None) -> str:
    resp = requests.get(
        url, params=params, headers={"User-Agent": USER_AGENT}, timeout=30
    )
    resp.raise_for_status()
    return resp.text


def _parse_money(s: str) -> float | None:
    if not s:
        return None
    s = s.replace("$", "").replace(",", "").replace("+", "").strip()
    if s in ("", "-"):
        return None
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return None
    return -v if neg else v


def _parse_int(s: str) -> float:
    s = s.replace(",", "").replace("+", "").strip()
    if s in ("", "-"):
        return 0.0
    neg = s.startswith("(") and s.endswith(")")
    if neg:
        s = s[1:-1]
    try:
        v = float(s)
    except ValueError:
        return 0.0
    return -v if neg else v


def _parse_openinsider_html(html: str) -> list[InsiderTx]:
    soup = BeautifulSoup(html, "lxml")
    table = soup.find("table", class_="tinytable")
    if table is None:
        return []
    rows = table.find_all("tr")
    out: list[InsiderTx] = []
    for tr in rows[1:]:  # skip header
        tds = tr.find_all("td")
        if len(tds) < 12:
            continue
        # openinsider columns (typical):
        # 0=X 1=Filing Date 2=Trade Date 3=Ticker 4=Insider 5=Title
        # 6=Trade Type 7=Last Price 8=Qty 9=Owned 10=ΔOwn 11=Value
        # The "10b5-1" flag is encoded in the row class or in column 1's content.
        def cell(i: int) -> str:
            return tds[i].get_text(" ", strip=True) if i < len(tds) else ""

        filing_date = cell(1).split(" ")[0]  # often "2026-04-22 09:30:00"
        trade_date = cell(2)
        insider_name = cell(4)
        title = cell(5)
        trade_type_raw = cell(6)
        # Trade Type format: "P - Purchase" or "S - Sale" — first char is the code.
        type_code = trade_type_raw[:1] if trade_type_raw else ""
        price = _parse_money(cell(7))
        shares = _parse_int(cell(8))
        value = _parse_money(cell(11)) if len(tds) > 11 else None
        # 10b5-1 detection: row has class "rule10b5-1" or filing-date cell text marker.
        is_10b51 = False
        row_classes = tr.get("class") or []
        if any("10b5" in c for c in row_classes):
            is_10b51 = True
        elif "10b5-1" in trade_type_raw.lower():
            is_10b51 = True

        if not filing_date or not trade_date or not type_code:
            continue
        out.append(
            InsiderTx(
                filing_date=filing_date,
                trade_date=trade_date,
                insider_name=insider_name,
                title=title,
                type=type_code,
                shares=shares,
                price=price,
                value=value,
                is_10b51=is_10b51,
            )
        )
    return out


def _fetch_openinsider(ticker: str) -> list[InsiderTx]:
    html = _http_get(OPENINSIDER_URL, {"s": ticker, "fd": 90})
    return _parse_openinsider_html(html)


# ---------- EDGAR fallback ----------

def _load_cik_map() -> dict[str, str]:
    """Returns ticker (uppercase) → 10-digit zero-padded CIK string."""
    if CIK_CACHE_PATH.exists():
        cached = read_json(CIK_CACHE_PATH, default={}) or {}
        if cached:
            return cached
    try:
        text = _http_get(SEC_TICKERS_URL)
        raw = json.loads(text)
    except Exception as exc:  # noqa: BLE001
        log.warning("CIK map fetch failed: %s", exc)
        return {}
    out: dict[str, str] = {}
    for entry in raw.values() if isinstance(raw, dict) else []:
        t = (entry.get("ticker") or "").upper()
        cik = entry.get("cik_str")
        if t and cik is not None:
            out[t] = str(cik).zfill(10)
    if out:
        write_json(CIK_CACHE_PATH, out)
    return out


_F4_NAMESPACE = ""  # SEC Form 4 XML has no namespace.


def _strip(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return el.text.strip()


def _parse_f4_xml(xml_bytes: bytes) -> list[InsiderTx]:
    try:
        root = ET.fromstring(xml_bytes)
    except ET.ParseError:
        return []

    owners: list[tuple[str, str]] = []
    for owner in root.findall(".//reportingOwner"):
        name = _strip(owner.find("./reportingOwnerId/rptOwnerName"))
        title_parts: list[str] = []
        rel = owner.find("./reportingOwnerRelationship")
        if rel is not None:
            if _strip(rel.find("isDirector")) == "1":
                title_parts.append("Director")
            if _strip(rel.find("isOfficer")) == "1":
                ot = _strip(rel.find("officerTitle"))
                title_parts.append(ot or "Officer")
            if _strip(rel.find("isTenPercentOwner")) == "1":
                title_parts.append("10% Owner")
        owners.append((name, ", ".join(title_parts)))

    filing_date = _strip(root.find(".//periodOfReport")) or _strip(root.find(".//signatureDate"))

    out: list[InsiderTx] = []
    for tx in root.findall(".//nonDerivativeTransaction"):
        trade_date = _strip(tx.find("./transactionDate/value"))
        code = _strip(tx.find("./transactionCoding/transactionCode"))
        shares = _parse_int(_strip(tx.find("./transactionAmounts/transactionShares/value")) or "0")
        price = _parse_money(_strip(tx.find("./transactionAmounts/transactionPricePerShare/value")) or "")
        # 10b5-1 flag
        rule_el = tx.find(".//rule10b5-1Indicator")
        is_10b51 = (rule_el is not None and _strip(rule_el) == "1") or False
        value = (shares * price) if (price is not None and shares) else None
        for name, title in owners or [("", "")]:
            out.append(
                InsiderTx(
                    filing_date=filing_date or trade_date,
                    trade_date=trade_date,
                    insider_name=name,
                    title=title,
                    type=code,
                    shares=shares,
                    price=price,
                    value=value,
                    is_10b51=is_10b51,
                )
            )
    return out


def _fetch_edgar(ticker: str, cik_map: dict[str, str]) -> list[InsiderTx]:
    cik = cik_map.get(ticker.upper())
    if not cik:
        raise RuntimeError(f"no CIK for {ticker}")
    text = _http_get(SEC_SUBMISSIONS_URL.format(cik=cik))
    sub = json.loads(text)
    recent = sub.get("filings", {}).get("recent", {})
    forms = recent.get("form", [])
    accession_nums = recent.get("accessionNumber", [])
    primary_docs = recent.get("primaryDocument", [])
    filing_dates = recent.get("filingDate", [])
    cutoff = today_utc() - timedelta(days=90)

    out: list[InsiderTx] = []
    for i, form in enumerate(forms):
        if form != "4":
            continue
        try:
            fd = date.fromisoformat(filing_dates[i])
        except (IndexError, ValueError):
            continue
        if fd < cutoff:
            continue
        acc = accession_nums[i].replace("-", "") if i < len(accession_nums) else None
        doc = primary_docs[i] if i < len(primary_docs) else None
        if not acc or not doc:
            continue
        # Form 4 primaryDocument is usually an HTML file; the underlying XML
        # is at the same URL with `.xml` extension or via an alternate filename.
        # Try the wf-form4_*.xml convention; if HTML is returned, look for the
        # <a href> link to the XML inside.
        base_url = f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{acc}/"
        xml_url = urljoin(base_url, doc)
        if not xml_url.endswith(".xml"):
            # Substitute typical XML neighbor.
            xml_url = urljoin(base_url, Path(doc).stem + ".xml")
        try:
            xml_text = _http_get(xml_url)
        except requests.RequestException:
            continue
        out.extend(_parse_f4_xml(xml_text.encode("utf-8")))
    return out


# ---------- summarize ----------

def _filter_signal_txs(txs: Iterable[InsiderTx]) -> list[InsiderTx]:
    """Excludes Awards (A) and 10b5-1 sales for net-buy-sell + cluster analysis."""
    out: list[InsiderTx] = []
    for tx in txs:
        if tx.type == "A":
            continue
        if tx.type == "S" and tx.is_10b51:
            continue
        if tx.type not in ("P", "S"):
            continue
        out.append(tx)
    return out


def _cluster_signal(txs: list[InsiderTx]) -> bool:
    """≥3 distinct insiders bought (P, non-10b5-1) within any 14-day window AND net-buy>0."""
    buys = [t for t in txs if t.type == "P" and not t.is_10b51 and t.value]
    if len(buys) < 3:
        return False
    buys_parsed = []
    for t in buys:
        try:
            d = date.fromisoformat(t.trade_date)
        except ValueError:
            continue
        buys_parsed.append((d, t.insider_name, abs(float(t.value or 0))))
    buys_parsed.sort(key=lambda x: x[0])
    for i, (d_i, _, _) in enumerate(buys_parsed):
        window_insiders: set[str] = set()
        window_net = 0.0
        for d_j, name, val in buys_parsed[i:]:
            if (d_j - d_i).days > 14:
                break
            window_insiders.add(name)
            window_net += val
        if len(window_insiders) >= 3 and window_net > 0:
            return True
    return False


def _summarize(txs: list[InsiderTx]) -> dict:
    signal_txs = _filter_signal_txs(txs)
    net = 0.0
    insider_set: set[str] = set()
    for t in signal_txs:
        # openinsider already encodes direction in the value sign for S rows.
        # Use abs() and the explicit type code so the math is source-agnostic.
        v = abs(float(t.value or 0))
        if t.type == "P":
            net += v
        elif t.type == "S":
            net -= v
        if t.insider_name:
            insider_set.add(t.insider_name)
    latest: str | None = None
    for t in txs:
        if t.type == "A":
            continue
        if latest is None or t.trade_date > latest:
            latest = t.trade_date
    return {
        "net_buy_sell_90d": round(net, 2),
        "insider_count_90d": len(insider_set),
        "cluster_signal": _cluster_signal(signal_txs),
        "latest_activity": latest,
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def run(universe_tickers: list[str]) -> dict:
    summary: dict = {
        "ticker_pulled": 0,
        "openinsider": 0,
        "edgar": 0,
        "failed": [],
    }
    cik_map: dict[str, str] | None = None

    for ticker in universe_tickers:
        source = "openinsider"
        txs: list[InsiderTx] = []
        try:
            txs = _fetch_openinsider(ticker)
            summary["openinsider"] += 1
        except Exception as exc:  # noqa: BLE001
            log.warning("openinsider failed for %s (%s); trying EDGAR", ticker, exc)
            if cik_map is None:
                cik_map = _load_cik_map()
            try:
                txs = _fetch_edgar(ticker, cik_map)
                source = "edgar"
                summary["edgar"] += 1
            except Exception as edgar_exc:  # noqa: BLE001
                log.warning("EDGAR fallback failed for %s: %s", ticker, edgar_exc)
                summary["failed"].append(ticker)
                continue

        ticker_dir = config.DATA_DIR / "stocks" / ticker
        ticker_dir.mkdir(parents=True, exist_ok=True)
        payload = {
            "ticker": ticker,
            "as_of": today_utc().isoformat(),
            "fetched_at": _now_iso(),
            "source": source,
            "summary": _summarize(txs),
            "transactions": [asdict(t) for t in txs],
        }
        write_json(ticker_dir / "insider.json", payload)
        summary["ticker_pulled"] += 1

    log.info(
        "insider pull complete · pulled=%d openinsider=%d edgar=%d failed=%d",
        summary["ticker_pulled"],
        summary["openinsider"],
        summary["edgar"],
        len(summary["failed"]),
    )
    return summary


def _load_universe_tickers() -> list[str]:
    raw = read_json(config.TICKERS_FILE, default={}) or {}
    base = raw.get("sp100") or []
    custom = raw.get("custom") or []
    seen: set[str] = set()
    out: list[str] = []
    for t in [*base, *custom]:
        u = (t or "").upper()
        if u and u not in seen:
            seen.add(u)
            out.append(u)
    return out


def main() -> None:
    setup_logging()
    tickers = _load_universe_tickers()
    log.info("pulling insider data for %d tickers", len(tickers))
    summary = run(tickers)
    log.info("summary: %s", summary)


if __name__ == "__main__":
    main()
