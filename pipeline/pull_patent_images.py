"""Patent image puller. For each patent we want to feature in the
Innovation lens, fetch its representative figure from Google Patents
and cache it under public/data/patents/images/{id}.jpg.

Strategy:
  1. Read patents.json — for each ticker take the latest N patents
     (or top-N tickers by velocity to limit scope).
  2. For each patent missing an image on disk, GET its Google Patents
     page and pluck the `<meta property="og:image">` URL.
  3. Download that image with a polite delay between hits.

The og:image URL points at patentimages.storage.googleapis.com which
serves the canonical first figure. Cheap, stable, no auth.
"""
from __future__ import annotations

import argparse
import json
import logging
import random
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Iterable

import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging  # noqa: E402

log = logging.getLogger(__name__)

# --- knobs ---
PATENTS_PER_TICKER = 5
TOP_TICKERS_BY_VELOCITY = 80  # focus image budget on tickers users actually browse
MAX_WORKERS = 4               # polite parallel: 4 threads × ~1 req/s = 4 req/s avg
MIN_INTERVAL_S = 0.8
MAX_INTERVAL_S = 1.6
REQUEST_TIMEOUT_S = 20

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36 "
    "PortfolioSkyline/0.1 (personal research)"
)


def _patent_page_url(patent_id: str) -> str:
    pid = patent_id.strip().upper()
    # Google Patents URLs always look like /patent/US{number}/en. Some
    # IDs already include the country prefix; strip if present.
    if not pid.startswith(("US", "EP", "WO", "CN", "JP")):
        pid = f"US{pid}"
    return f"https://patents.google.com/patent/{pid}/en"


# --- HTTP ---

_LAST_CALL: dict[int, float] = {}


def _pace_thread() -> None:
    """Per-thread polite pacing — each worker sleeps individually so we
    never spike."""
    tid = id(_LAST_CALL)  # cheap thread-local-ish keyed value works in CPython GIL
    import threading
    key = threading.get_ident()
    last = _LAST_CALL.get(key, 0.0)
    target = random.uniform(MIN_INTERVAL_S, MAX_INTERVAL_S)
    elapsed = time.monotonic() - last
    if elapsed < target:
        time.sleep(target - elapsed)
    _LAST_CALL[key] = time.monotonic()


@retry(
    retry=retry_if_exception_type(requests.RequestException),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1.8, min=2, max=20),
    reraise=True,
)
def _fetch_og_image(patent_id: str, session: requests.Session) -> str | None:
    _pace_thread()
    url = _patent_page_url(patent_id)
    r = session.get(url, timeout=REQUEST_TIMEOUT_S, headers={"User-Agent": USER_AGENT})
    if r.status_code == 404:
        return None
    if r.status_code >= 400:
        raise requests.RequestException(f"http {r.status_code} for {url}")
    html = r.text
    # og:image — Google Patents reliably ships this with the representative figure.
    m = re.search(
        r'<meta\s+property=["\']og:image["\']\s+content=["\']([^"\']+)["\']',
        html,
        flags=re.IGNORECASE,
    )
    if m:
        return m.group(1)
    # Fallback — the image:src twitter meta also points at the figure.
    m = re.search(
        r'<meta\s+name=["\']twitter:image["\']\s+content=["\']([^"\']+)["\']',
        html,
        flags=re.IGNORECASE,
    )
    return m.group(1) if m else None


@retry(
    retry=retry_if_exception_type(requests.RequestException),
    stop=stop_after_attempt(3),
    wait=wait_exponential(multiplier=1.8, min=2, max=20),
    reraise=True,
)
def _download_image(url: str, dest: Path, session: requests.Session) -> None:
    _pace_thread()
    r = session.get(url, timeout=REQUEST_TIMEOUT_S, headers={"User-Agent": USER_AGENT}, stream=True)
    if r.status_code >= 400:
        raise requests.RequestException(f"http {r.status_code} fetching image")
    # Some og:image URLs end in .gif (animated PDFs); we still save them
    # as the .jpg extension we declared because the front-end serves
    # whatever bytes are there with a generic image MIME.
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    with tmp.open("wb") as f:
        for chunk in r.iter_content(chunk_size=64 * 1024):
            if chunk:
                f.write(chunk)
    tmp.replace(dest)


# --- driver ---

def _select_patents(patents_doc: dict) -> list[tuple[str, str]]:
    """Returns a list of (ticker, patent_id) pairs to fetch images for.
    Limits to the top-N tickers by 4Q velocity and the top-N patents
    per ticker."""
    tickers = patents_doc.get("tickers") or {}
    # Sort tickers by last_4q velocity, descending.
    ranked = sorted(
        tickers.items(),
        key=lambda kv: kv[1].get("last_4q") or 0,
        reverse=True,
    )[:TOP_TICKERS_BY_VELOCITY]
    out: list[tuple[str, str]] = []
    for ticker, t in ranked:
        latest = t.get("latest_patents") or []
        for p in latest[:PATENTS_PER_TICKER]:
            pid = p.get("id")
            if pid:
                out.append((ticker, str(pid)))
    return out


def _image_path(patent_id: str) -> Path:
    safe = re.sub(r"[^A-Za-z0-9_-]", "_", patent_id)
    return config.PATENT_IMAGES_DIR / f"{safe}.jpg"


def _fetch_one(
    patent_id: str, session: requests.Session
) -> tuple[str, str | None, str | None]:
    """Returns (patent_id, status, error)."""
    dest = _image_path(patent_id)
    if dest.exists() and dest.stat().st_size > 0:
        return (patent_id, "cached", None)
    try:
        og = _fetch_og_image(patent_id, session)
        if not og:
            return (patent_id, "no_image", None)
        _download_image(og, dest, session)
        return (patent_id, "downloaded", None)
    except Exception as e:  # noqa: BLE001
        return (patent_id, "error", str(e)[:160])


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update(
        {
            "User-Agent": USER_AGENT,
            "Accept": "text/html,application/xhtml+xml;q=0.9,image/*;q=0.8,*/*;q=0.5",
            "Accept-Language": "en-US,en;q=0.9",
        }
    )
    return s


def run(*, force: bool = False, limit: int | None = None) -> dict:
    if not config.PATENTS_JSON.exists():
        log.warning("no patents.json yet — run pull_patents first")
        return {"status": "skipped", "reason": "no_patents_json"}

    doc = read_json(config.PATENTS_JSON, default={"tickers": {}}) or {"tickers": {}}
    targets = _select_patents(doc)
    if limit:
        targets = targets[:limit]

    if force:
        # Don't actually delete files (would race with the dev server);
        # just clear any zero-byte stubs so cached-check fails.
        for _, pid in targets:
            p = _image_path(pid)
            if p.exists() and p.stat().st_size == 0:
                p.unlink()

    log.info(
        "patent-images · %d candidates across %d tickers (top %d filers, top %d each)",
        len(targets),
        len({t for t, _ in targets}),
        TOP_TICKERS_BY_VELOCITY,
        PATENTS_PER_TICKER,
    )

    session = _session()
    counts = {"downloaded": 0, "cached": 0, "no_image": 0, "error": 0}
    sample_errors: list[tuple[str, str]] = []

    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        futures = {ex.submit(_fetch_one, pid, session): (ticker, pid) for ticker, pid in targets}
        done = 0
        for fut in as_completed(futures):
            done += 1
            pid, status, err = fut.result()
            counts[status] = counts.get(status, 0) + 1
            if status == "error" and len(sample_errors) < 5:
                sample_errors.append((pid, err or ""))
            if done % 50 == 0:
                log.info(
                    "  · progress %d/%d (downloaded=%d cached=%d no_image=%d error=%d)",
                    done, len(targets),
                    counts["downloaded"], counts["cached"], counts["no_image"], counts["error"],
                )

    return {
        "candidates": len(targets),
        **counts,
        "sample_errors": sample_errors,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Patent image puller (Google Patents og:image)")
    parser.add_argument("--force", action="store_true", help="re-fetch images even if cached")
    parser.add_argument("--limit", type=int, default=None, help="cap candidates (debugging)")
    args = parser.parse_args()
    setup_logging()
    config.load_env()
    summary = run(force=args.force, limit=args.limit)
    log.info("patent images complete: %s", summary)


if __name__ == "__main__":
    main()
