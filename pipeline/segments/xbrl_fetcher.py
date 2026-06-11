"""Fetch the primary XBRL instance document for a given filing.

Filing layout on EDGAR:
  https://www.sec.gov/Archives/edgar/data/{cik_no_leading_zeros}/{accn_nodashes}/

Within that directory, the iXBRL instance is at
  {primary-name-stem}_htm.xml      (post-2020 inline-XBRL filings)
or, for older filings:
  {ticker}-{yyyymmdd}.xml          (classic XBRL)
or another file ending in `.xml` that is not `*-index.xml`.

We look for the *_htm.xml variant first, then fall back to listing the
directory and picking the largest non-extracted-table XML.
"""
from __future__ import annotations

import logging

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

log = logging.getLogger(__name__)

USER_AGENT = "Portfolio Skyline g.ellerichmann@gmail.com"
ARCHIVE_BASE = "https://www.sec.gov/Archives/edgar/data/{cik}/{accn}"


@retry(
    retry=retry_if_exception_type(requests.RequestException),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1, min=1, max=10),
    reraise=True,
)
def _get(url: str, session: requests.Session) -> requests.Response:
    r = session.get(url, timeout=60)
    r.raise_for_status()
    return r


def fetch_instance(
    cik: str,
    accession_nodashes: str,
    primary_document: str,
    *,
    session: requests.Session | None = None,
) -> bytes | None:
    """Returns the XBRL instance XML bytes, or None if no XBRL is attached."""
    s = session or requests.Session()
    s.headers["User-Agent"] = USER_AGENT
    cik_stripped = cik.lstrip("0") or cik
    base = ARCHIVE_BASE.format(cik=cik_stripped, accn=accession_nodashes)

    # Prefer the iXBRL-extracted instance: name stem of primary_document + _htm.xml
    if primary_document.endswith(".htm"):
        stem = primary_document[:-4]
        candidate = f"{base}/{stem}_htm.xml"
        try:
            r = _get(candidate, s)
            return r.content
        except requests.RequestException as exc:
            log.debug("no %s: %s", candidate, exc)

    # Fall back to scanning the directory index.json for XML files.
    try:
        idx = _get(f"{base}/index.json", s).json()
    except Exception as exc:  # noqa: BLE001
        log.warning("filing index fetch failed (%s/%s): %s", cik, accession_nodashes, exc)
        return None
    items = (idx.get("directory") or {}).get("item") or []
    candidates = [
        it for it in items
        if it.get("name", "").endswith(".xml")
        and "_htm" not in it["name"]
        and not it["name"].lower().endswith(("_cal.xml", "_def.xml", "_lab.xml", "_pre.xml", "filingsummary.xml"))
    ]
    if not candidates:
        return None
    # Largest is most likely the instance.
    candidates.sort(key=lambda it: int(it.get("size") or 0), reverse=True)
    pick = candidates[0]["name"]
    try:
        return _get(f"{base}/{pick}", s).content
    except Exception as exc:  # noqa: BLE001
        log.warning("instance fetch failed (%s/%s/%s): %s", cik, accession_nodashes, pick, exc)
        return None
