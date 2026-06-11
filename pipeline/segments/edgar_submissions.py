"""SEC EDGAR Submissions API: list recent filings per ticker.

Calls /submissions/CIK{cik}.json and returns 10-K + 10-Q filings, with
accession-number, primary-document path, and filing date.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"


@dataclass(frozen=True)
class Filing:
    accession: str       # e.g. "0000320193-25-000005"
    accession_nodashes: str  # e.g. "000032019325000005"
    form: str            # "10-K" / "10-Q"
    filing_date: str     # ISO yyyy-mm-dd
    report_date: str     # period-of-report, ISO yyyy-mm-dd
    primary_document: str  # e.g. "aapl-20240928.htm"


@retry(
    retry=retry_if_exception_type(requests.RequestException),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
def _get(url: str, session: requests.Session) -> requests.Response:
    r = session.get(url, timeout=30)
    r.raise_for_status()
    return r


def list_filings(
    cik: str,
    *,
    forms: set[str] = frozenset({"10-K", "10-Q"}),
    session: requests.Session | None = None,
    limit: int | None = None,
) -> list[Filing]:
    """Return filings ordered newest-first. CIK should be zero-padded to 10 digits."""
    s = session or requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    r = _get(SUBMISSIONS_URL.format(cik=cik), s)
    payload = r.json()
    recent = payload.get("filings", {}).get("recent") or {}

    accns = recent.get("accessionNumber") or []
    fnames = recent.get("primaryDocument") or []
    fdates = recent.get("filingDate") or []
    rdates = recent.get("reportDate") or []
    fforms = recent.get("form") or []

    out: list[Filing] = []
    for i, accn in enumerate(accns):
        form = fforms[i] if i < len(fforms) else ""
        if form not in forms:
            continue
        primary = fnames[i] if i < len(fnames) else ""
        if not primary:
            continue
        out.append(
            Filing(
                accession=accn,
                accession_nodashes=accn.replace("-", ""),
                form=form,
                filing_date=fdates[i] if i < len(fdates) else "",
                report_date=rdates[i] if i < len(rdates) else "",
                primary_document=primary,
            )
        )
        if limit is not None and len(out) >= limit:
            break
    return out
