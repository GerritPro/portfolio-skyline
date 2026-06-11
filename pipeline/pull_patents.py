"""Bulk-data patents pipeline. Three stages:

  1. Bulk → DuckDB → patents.json
     PatentsView TSVs (granted patents + disambiguated assignees) →
     local DuckDB → per-ticker aggregate. Stable, automated, fast.

  2. Image puller (pull_patent_images.py)
     For each featured patent, scrape its representative figure from
     Google Patents and cache under public/data/patents/images/.

  3. LLM summariser (summarize_patents.py)
     Local Ollama (default qwen2.5:7b) turns dense USPTO abstracts into
     2-sentence plain English, plus a per-ticker "what they're working
     on" rollup. No API key, fully offline.

By default `run()` does all three; flags skip individual stages.

Run modes:
  python -m pipeline.pull_patents                  # all three stages
  python -m pipeline.pull_patents --no-images      # skip image fetch
  python -m pipeline.pull_patents --no-summaries   # skip LLM
  python -m pipeline.pull_patents --query-only     # skip bulk download too
  python -m pipeline.pull_patents --force          # re-download bulk files
"""
from __future__ import annotations

import argparse
import gzip
import json
import logging
import os
import re
import shutil
import sys
import time
import zipfile
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Iterable

import duckdb
import requests
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, today_utc, write_json  # noqa: E402

log = logging.getLogger(__name__)

# ---------- knobs ----------
WINDOW_YEARS = 4
FILE_FRESH_DAYS = 7  # bulk files publish weekly; refresh if older
USER_AGENT = "Portfolio Skyline (patents-bulk; g.ellerichmann@gmail.com)"
DEFAULT_BASE = os.environ.get(
    "PATENTS_BULK_BASE",
    "https://s3.amazonaws.com/data.patentsview.org/download",
)
DOWNLOAD_CHUNK = 1024 * 1024  # 1 MB

# (filename_on_disk, remote_basename, expected_extension_after_extract)
BULK_FILES = [
    ("g_patent.tsv.zip", "g_patent.tsv.zip", "g_patent.tsv"),
    ("g_patent_abstract.tsv.zip", "g_patent_abstract.tsv.zip", "g_patent_abstract.tsv"),
    ("g_assignee_disambiguated.tsv.zip", "g_assignee_disambiguated.tsv.zip", "g_assignee_disambiguated.tsv"),
]

# ---------- download ----------

# Per-chunk read timeout. If the server doesn't send data for this long
# we assume the connection has stalled and bail to the outer retry. Saves
# us from "request.get blocks for hours on a half-dead TCP stream".
CHUNK_READ_TIMEOUT_S = 30
STALL_NO_PROGRESS_S = 60  # additional client-side stall guard


@retry(
    retry=retry_if_exception_type((requests.RequestException, IOError)),
    stop=stop_after_attempt(5),
    wait=wait_exponential(multiplier=2, min=5, max=60),
    reraise=True,
)
def _download_file(url: str, dest: Path) -> None:
    """Resumable, stall-resistant download. If a .part file exists we
    send a Range header to continue where we left off rather than
    throwing away progress on every retry."""
    tmp = dest.with_suffix(dest.suffix + ".part")
    existing = tmp.stat().st_size if tmp.exists() else 0

    headers = {"User-Agent": USER_AGENT}
    if existing > 0:
        headers["Range"] = f"bytes={existing}-"
        log.info(
            "resuming %s from %.1f MB",
            dest.name,
            existing / 1e6,
        )
    else:
        log.info("downloading %s → %s", url, dest.name)

    # `timeout=(connect, read)` — read timeout applies *per chunk*, so a
    # silent stall on the wire fails fast instead of hanging for hours.
    with requests.get(
        url,
        stream=True,
        timeout=(30, CHUNK_READ_TIMEOUT_S),
        headers=headers,
        allow_redirects=True,
    ) as r:
        if r.status_code == 416:
            # Server says we already have the whole file.
            log.info("server reports complete (HTTP 416)")
            tmp.replace(dest)
            return
        if r.status_code not in (200, 206):
            r.raise_for_status()
        # Content-Length here is the REMAINING bytes when resuming via 206.
        remaining = int(r.headers.get("content-length") or 0)
        total = existing + remaining if r.status_code == 206 else remaining
        written = existing
        last_progress_time = time.monotonic()
        last_progress_bytes = existing
        next_log = time.monotonic() + 5
        mode = "ab" if r.status_code == 206 and existing > 0 else "wb"
        with tmp.open(mode) as f:
            for chunk in r.iter_content(chunk_size=DOWNLOAD_CHUNK):
                if not chunk:
                    continue
                f.write(chunk)
                written += len(chunk)
                now = time.monotonic()
                # Client-side stall watchdog. The read timeout in requests
                # should catch socket-level stalls; this is a belt-and-
                # suspenders check for slow-trickle scenarios.
                if written > last_progress_bytes:
                    last_progress_bytes = written
                    last_progress_time = now
                elif now - last_progress_time > STALL_NO_PROGRESS_S:
                    raise IOError(
                        f"download stalled: no progress for "
                        f"{STALL_NO_PROGRESS_S}s at {written / 1e6:.1f} MB"
                    )
                if now >= next_log:
                    if total:
                        pct = (written / total) * 100
                        log.info(
                            "  · %s: %.1f%% (%.1f MB)",
                            dest.name,
                            pct,
                            written / 1e6,
                        )
                    else:
                        log.info("  · %s: %.1f MB", dest.name, written / 1e6)
                    next_log = now + 5
    tmp.replace(dest)
    log.info("done · %s (%.1f MB)", dest.name, dest.stat().st_size / 1e6)


def _is_fresh(path: Path) -> bool:
    if not path.exists():
        return False
    age = time.time() - path.stat().st_mtime
    return age < FILE_FRESH_DAYS * 86400


def _extract_if_needed(zip_path: Path, target_name: str) -> Path:
    target = zip_path.parent / target_name
    if target.exists() and _is_fresh(target) and target.stat().st_mtime >= zip_path.stat().st_mtime:
        return target
    log.info("extracting %s", zip_path.name)
    if zip_path.suffix == ".zip":
        with zipfile.ZipFile(zip_path) as zf:
            # Find the right entry (may be wrapped in a directory in older releases).
            members = zf.namelist()
            match = next((m for m in members if m.endswith(target_name)), None)
            if not match:
                raise RuntimeError(
                    f"{target_name} not found inside {zip_path.name}; got: {members[:5]}"
                )
            with zf.open(match) as src, target.open("wb") as dst:
                shutil.copyfileobj(src, dst, length=DOWNLOAD_CHUNK)
    elif zip_path.suffix in {".gz", ".gzip"}:
        with gzip.open(zip_path, "rb") as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst, length=DOWNLOAD_CHUNK)
    else:
        raise RuntimeError(f"unsupported archive type: {zip_path.suffix}")
    return target


def _ensure_bulk_files(force: bool = False) -> dict[str, Path]:
    config.PATENTS_BULK_DIR.mkdir(parents=True, exist_ok=True)
    files: dict[str, Path] = {}
    for local_name, remote_name, target in BULK_FILES:
        local = config.PATENTS_BULK_DIR / local_name
        if force or not _is_fresh(local):
            _download_file(f"{DEFAULT_BASE}/{remote_name}", local)
        else:
            log.info("cached · %s (%.1f MB, %.1f days old)",
                     local.name, local.stat().st_size / 1e6,
                     (time.time() - local.stat().st_mtime) / 86400)
        extracted = _extract_if_needed(local, target)
        files[target] = extracted
    return files


# ---------- DuckDB layer ----------

def _open_db() -> duckdb.DuckDBPyConnection:
    config.PATENTS_DB.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect(str(config.PATENTS_DB))
    # Keep our temp tables tidy
    con.execute("PRAGMA threads=4")
    return con


def _load_into_db(con: duckdb.DuckDBPyConnection, files: dict[str, Path], since: str) -> None:
    """Project + filter rows from the raw TSVs into compact analysis
    tables. The full g_patent.tsv has decades of history; we only need
    `since` onward.

    PatentsView's bulk schema splits the patent header (g_patent.tsv)
    from abstracts (g_patent_abstract.tsv) and from assignees
    (g_assignee_disambiguated.tsv). We let DuckDB sniff each file and
    project only the columns we need into compact analysis tables.
    """
    patent_path = files["g_patent.tsv"].as_posix()
    abstract_path = files["g_patent_abstract.tsv"].as_posix()
    assignee_path = files["g_assignee_disambiguated.tsv"].as_posix()

    log.info("ingesting g_patent.tsv → DuckDB (filter ≥ %s)", since)
    con.execute(f"""
        CREATE OR REPLACE TABLE patent AS
        SELECT
            CAST(patent_id AS VARCHAR)   AS patent_id,
            CAST(patent_date AS DATE)    AS patent_date,
            CAST(patent_title AS VARCHAR) AS patent_title,
            CAST(NULL AS VARCHAR)         AS patent_abstract
        FROM read_csv(
            '{patent_path}',
            delim='\t', header=true,
            quote='"', escape='"',
            ignore_errors=true,
            all_varchar=true
        )
        WHERE TRY_CAST(patent_date AS DATE) IS NOT NULL
          AND CAST(patent_date AS DATE) >= DATE '{since}'
    """)
    n = con.execute("SELECT count(*) FROM patent").fetchone()[0]
    log.info("  · %d granted patents kept (≥ %s)", n, since)

    log.info("ingesting g_patent_abstract.tsv → DuckDB (joining to retained patents)")
    con.execute(f"""
        CREATE OR REPLACE TABLE patent_abstract AS
        SELECT
            CAST(patent_id AS VARCHAR)        AS patent_id,
            CAST(patent_abstract AS VARCHAR)  AS patent_abstract
        FROM read_csv(
            '{abstract_path}',
            delim='\t', header=true,
            quote='"', escape='"',
            ignore_errors=true,
            all_varchar=true
        )
        WHERE patent_id IN (SELECT patent_id FROM patent)
    """)
    a = con.execute("SELECT count(*) FROM patent_abstract").fetchone()[0]
    log.info("  · %d abstracts kept", a)

    # Backfill patent.patent_abstract from the abstract table. Keeps
    # downstream queries simple (one row per patent with everything).
    con.execute("""
        UPDATE patent
        SET patent_abstract = a.patent_abstract
        FROM patent_abstract a
        WHERE patent.patent_id = a.patent_id
    """)

    log.info("ingesting g_assignee_disambiguated.tsv → DuckDB")
    con.execute(f"""
        CREATE OR REPLACE TABLE assignee AS
        SELECT
            CAST(patent_id AS VARCHAR)                      AS patent_id,
            CAST(assignee_id AS VARCHAR)                    AS assignee_id,
            CAST(disambig_assignee_organization AS VARCHAR) AS organization
        FROM read_csv(
            '{assignee_path}',
            delim='\t', header=true,
            quote='"', escape='"',
            ignore_errors=true,
            all_varchar=true
        )
        WHERE patent_id IN (SELECT patent_id FROM patent)
          AND disambig_assignee_organization IS NOT NULL
          AND disambig_assignee_organization <> ''
    """)
    m = con.execute("SELECT count(*) FROM assignee").fetchone()[0]
    log.info("  · %d assignment rows kept (joined to retained patents)", m)

    # Index for fast LIKE lookups.
    con.execute("CREATE INDEX IF NOT EXISTS idx_assignee_org ON assignee(organization)")
    con.execute("CREATE INDEX IF NOT EXISTS idx_patent_date ON patent(patent_date)")


# ---------- assignee name resolution ----------

_SUFFIXES_TO_STRIP = [
    ", Inc.", " Inc.", " Inc", " Corp.", " Corporation", " Co.", " Company",
    " Ltd.", " Limited", " plc", " PLC", " S.A.", " AG", " SE", " N.V.",
    " Holdings", " Group",
]


# Substring search needs a long-enough needle to be discriminating. A
# 1-3 char candidate (universe.json sometimes carries the ticker symbol
# verbatim as the "name") would match every org containing those letters
# — e.g. LIKE '%c%' returns hundreds of thousands of unrelated grants.
MIN_CANDIDATE_LEN = 4


def assignee_candidates(profile: dict) -> list[str]:
    name = (profile.get("name") or "").strip()
    if len(name) < MIN_CANDIDATE_LEN:
        return []
    out: list[str] = [name]
    cleaned = name
    for suf in _SUFFIXES_TO_STRIP:
        if cleaned.endswith(suf):
            cleaned = cleaned[: -len(suf)].rstrip(",").strip()
            break
    if cleaned and cleaned != name and len(cleaned) >= MIN_CANDIDATE_LEN:
        out.append(cleaned)
    first = cleaned.split(" ")[0] if cleaned else ""
    if (
        first
        and len(first) >= MIN_CANDIDATE_LEN
        and first.lower() not in {"the", "first", "global", "national"}
        and first not in out
    ):
        out.append(first)
    return out


# ---------- per-ticker query ----------

@dataclass
class PatentRow:
    patent_id: str
    title: str
    date: str
    organization: str
    abstract: str = ""


def _query_ticker(
    con: duckdb.DuckDBPyConnection, candidates: list[str]
) -> list[PatentRow]:
    """Find all patents whose disambiguated-assignee organization
    contains any of the candidate names (case-insensitive). We use the
    raw `organization` field — disambig IDs cluster name variants, but
    LIKE matching on the canonical name is more forgiving when the
    universe's company name differs in wording from USPTO's."""
    if not candidates:
        return []
    # Two-stage: (1) find disambig assignee_ids whose organisation
    # matches any candidate; (2) pull all patents for those IDs. This
    # naturally captures subsidiaries grouped under a single disambig.
    # DuckDB doesn't accept LIKE inside ANY/ALL subqueries, so we OR
    # the candidates explicitly. With ≤3 candidates per ticker the
    # plan stays simple.
    quoted = [c.lower().replace("'", "''") for c in candidates]
    like_clauses = " OR ".join([f"LOWER(organization) LIKE '%{q}%'" for q in quoted])
    if not like_clauses:
        return []
    sql = f"""
        WITH matched_assignees AS (
            SELECT DISTINCT assignee_id
            FROM assignee
            WHERE assignee_id IS NOT NULL
              AND ({like_clauses})
        )
        SELECT
            p.patent_id,
            p.patent_title,
            CAST(p.patent_date AS VARCHAR),
            a.organization,
            p.patent_abstract
        FROM patent p
        JOIN assignee a USING (patent_id)
        WHERE a.assignee_id IN (SELECT assignee_id FROM matched_assignees)
        ORDER BY p.patent_date DESC
    """
    rows = con.execute(sql).fetchall()
    return [
        PatentRow(
            patent_id=r[0],
            title=r[1] or "",
            date=r[2] or "",
            organization=r[3] or "",
            abstract=r[4] or "",
        )
        for r in rows
    ]


# ---------- aggregation (unchanged schema) ----------

def _quarter(d: str) -> str | None:
    try:
        dt = datetime.strptime(d, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        return None
    return f"{dt.year}Q{(dt.month - 1) // 3 + 1}"


def aggregate_ticker(rows: list[PatentRow]) -> dict:
    by_quarter: dict[str, int] = defaultdict(int)
    for r in rows:
        q = _quarter(r.date)
        if q:
            by_quarter[q] += 1
    sorted_q = sorted(by_quarter.items())
    last_4 = sum(c for _, c in sorted_q[-4:])
    prev_4 = sum(c for _, c in sorted_q[-8:-4])
    yoy = (last_4 / prev_4 - 1.0) if prev_4 > 0 else None

    # Dedupe on patent_id when constructing latest titles (LIKE-matching
    # against multiple candidate names can pull the same patent twice).
    seen: set[str] = set()
    latest: list[PatentRow] = []
    for r in rows:
        if r.patent_id in seen:
            continue
        seen.add(r.patent_id)
        latest.append(r)
        if len(latest) >= 5:
            break

    return {
        "total_filings_window": len({r.patent_id for r in rows}),
        "last_4q": last_4,
        "prev_4q": prev_4,
        "yoy_change": round(yoy, 3) if yoy is not None else None,
        "quarterly": [{"quarter": q, "filings": c} for q, c in sorted_q],
        "latest_patents": [
            {
                "id": p.patent_id,
                "title": p.title,
                "date": p.date,
                "abstract": p.abstract,
            }
            for p in latest
        ],
    }


# ---------- driver ----------

def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _today_iso() -> str:
    return today_utc().isoformat()


def run(
    *,
    force: bool = False,
    query_only: bool = False,
    limit: int | None = None,
    only: Iterable[str] | None = None,
    images: bool = True,
    summaries: bool = True,
) -> dict:
    today = _today_iso()
    since = (today_utc() - timedelta(days=WINDOW_YEARS * 365 + 90)).isoformat()

    universe = read_json(config.UNIVERSE_JSON, default={"tickers": []}) or {"tickers": []}
    entries = list(universe.get("tickers") or [])
    if only:
        whitelist = set(only)
        entries = [e for e in entries if e.get("ticker") in whitelist]
    if limit:
        entries = entries[:limit]

    if not query_only:
        files = _ensure_bulk_files(force=force)
        con = _open_db()
        # Skip re-ingest if the DB is fresher than the files AND already
        # contains the expected tables. A bare DB file with no tables
        # (created by a crashed earlier run) still has a recent mtime,
        # so the mtime check alone isn't enough.
        try:
            db_mtime = config.PATENTS_DB.stat().st_mtime
        except OSError:
            db_mtime = 0
        newest_file = max((p.stat().st_mtime for p in files.values()), default=0)
        has_tables = con.execute(
            "SELECT count(*) FROM information_schema.tables "
            "WHERE table_name IN ('patent','assignee')"
        ).fetchone()[0] == 2
        if force or db_mtime < newest_file or not has_tables:
            _load_into_db(con, files, since=since)
        else:
            log.info("DuckDB is fresher than source TSVs — skipping ingest")
    else:
        con = _open_db()

    # Sanity check the DB has data.
    try:
        patent_count = con.execute("SELECT count(*) FROM patent").fetchone()[0]
    except duckdb.Error:
        patent_count = 0
    if patent_count == 0:
        log.error("DuckDB has no patents loaded — run without --query-only first")
        return {"status": "error", "reason": "empty_db"}

    log.info("querying per-ticker stats over %d tickers · DB rows=%d", len(entries), patent_count)
    aggregate: dict[str, dict] = {}
    matched = 0
    empty = 0
    start = time.monotonic()
    for entry in entries:
        ticker = entry.get("ticker")
        if not ticker:
            continue
        cands = assignee_candidates(entry)
        if not cands:
            continue
        rows = _query_ticker(con, cands)
        stats = aggregate_ticker(rows)
        if stats["total_filings_window"] > 0:
            matched += 1
        else:
            empty += 1
        aggregate[ticker] = {"company": entry.get("name"), **stats}

    payload = {
        "version": config.DATA_VERSION_SCHEMA,
        "generated_at": _now_iso(),
        "as_of": today,
        "window_years": WINDOW_YEARS,
        "source": "patentsview-bulk",
        "tickers": aggregate,
    }
    write_json(config.PATENTS_JSON, payload)

    elapsed = time.monotonic() - start
    log.info(
        "patents bulk complete: %d tickers (matched=%d empty=%d) in %.1fs",
        len(aggregate),
        matched,
        empty,
        elapsed,
    )
    result: dict = {
        "tickers_in_output": len(aggregate),
        "matched": matched,
        "empty": empty,
        "query_seconds": round(elapsed, 1),
        "as_of": today,
    }

    # ---- Stage 2 + 3 — images + LLM summaries ----
    if images:
        try:
            from pipeline import pull_patent_images  # noqa: PLC0415
            img_summary = pull_patent_images.run()
            log.info("patent images stage: %s", img_summary)
            result["images"] = img_summary
        except Exception as e:  # noqa: BLE001
            log.warning("patent images stage failed (non-fatal): %s", e)
            result["images"] = {"status": "error", "message": str(e)[:200]}

    if summaries:
        try:
            from pipeline import summarize_patents  # noqa: PLC0415
            sum_summary = summarize_patents.run()
            log.info("patent summaries stage: %s", sum_summary)
            result["summaries"] = sum_summary
        except Exception as e:  # noqa: BLE001
            log.warning("patent summaries stage failed (non-fatal): %s", e)
            result["summaries"] = {"status": "error", "message": str(e)[:200]}

    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Patents pipeline (bulk DuckDB + images + LLM)")
    parser.add_argument("--force", action="store_true", help="re-download bulk files even if fresh")
    parser.add_argument("--query-only", action="store_true", help="skip download, query existing DB")
    parser.add_argument("--no-images", action="store_true", help="skip the image-pull stage")
    parser.add_argument("--no-summaries", action="store_true", help="skip the LLM-summary stage")
    parser.add_argument("--limit", type=int, default=None, help="cap tickers (for quick tests)")
    parser.add_argument(
        "--only",
        type=str,
        default=None,
        help="comma-separated ticker whitelist (e.g. NVDA,AVGO,AAPL)",
    )
    args = parser.parse_args()
    setup_logging()
    config.load_env()
    only = [t.strip().upper() for t in args.only.split(",")] if args.only else None
    summary = run(
        force=args.force,
        query_only=args.query_only,
        limit=args.limit,
        only=only,
        images=not args.no_images,
        summaries=not args.no_summaries,
    )
    log.info("summary: %s", summary)


if __name__ == "__main__":
    main()
