"""Local-LLM summarisation for patents. Uses Ollama running on
localhost — no API key, no quota, no rate limit, fully offline once
the model is pulled.

Turns dense USPTO patent abstracts into 2-sentence plain English a
curious investor with no engineering background can absorb in 10
seconds. Also generates one "what this company is actually working
on" rollup per ticker.

Defaults:
  OLLAMA_HOST   = http://localhost:11434
  OLLAMA_MODEL  = qwen2.5:7b   (good instruction following, ~5GB)

Setup once:
  1. Install Ollama: https://ollama.com/download
  2. Pull a model: ollama pull qwen2.5:7b
  3. Run this script.

Cache: aggressive. Patent abstracts don't change after grant, so a
patent gets summarised exactly once. Ticker rollups regenerate only
when their featured patent set changes.

Output: public/data/patents/summaries.json — joined client-side with
patents.json by the InnovationLens component.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ollama
from ollama import ResponseError

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from pipeline import config  # noqa: E402
from pipeline.io_utils import read_json, setup_logging, write_json  # noqa: E402

log = logging.getLogger(__name__)

# --- knobs ---
DEFAULT_MODEL = "qwen2.5:7b"
DEFAULT_HOST = "http://localhost:11434"
MAX_WORKERS = 3           # most consumer GPUs handle 2–4 parallel comfortably
TOP_TICKERS_BY_VELOCITY = 80
PATENTS_PER_TICKER = 5

PATENT_SYSTEM = (
    "You translate USPTO patent abstracts into plain English for a "
    "curious investor with no engineering background. "
    "Output EXACTLY two short sentences — no preamble, no bullets, no "
    "patent jargon. First sentence: the everyday problem this invention "
    "solves. Second sentence: how it actually works at a high level. "
    "Avoid 'this invention', 'the present disclosure', 'embodiment', "
    "'comprises'. Talk like you're explaining to a smart friend over coffee."
)

TICKER_SYSTEM = (
    "You read a batch of a company's recent patent titles and summaries "
    "and write a single short paragraph (2–3 sentences) describing what "
    "the company is actually working on right now in plain language. "
    "Be specific about themes. Avoid corporate-speak and avoid mere "
    "restatements of titles. Output the paragraph only."
)


# --- environment / client ---

def _ollama_host() -> str:
    return os.environ.get("OLLAMA_HOST", DEFAULT_HOST).strip() or DEFAULT_HOST


def _ollama_model() -> str:
    return os.environ.get("OLLAMA_MODEL", DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _check_ollama(client: ollama.Client, model: str) -> tuple[bool, str]:
    """Returns (ok, message). Verifies that Ollama is reachable AND that
    the configured model is pulled locally — both are common setup
    failures and want distinct error messages."""
    try:
        listing = client.list()
    except Exception as e:  # noqa: BLE001
        return (
            False,
            f"Ollama unreachable at {_ollama_host()}: {e}. "
            f"Install from https://ollama.com/download and start the daemon.",
        )
    # `client.list()` returns a dict-like with .models entries.
    available: list[str] = []
    raw_models = getattr(listing, "models", None) or listing.get("models", [])
    for m in raw_models:
        name = (
            getattr(m, "model", None)
            or getattr(m, "name", None)
            or (m.get("model") if isinstance(m, dict) else None)
            or (m.get("name") if isinstance(m, dict) else None)
        )
        if name:
            available.append(name)
    has_model = any(name == model or name.startswith(f"{model}:") for name in available)
    if not has_model:
        return (
            False,
            f"Model '{model}' not pulled locally (have: {available or 'none'}). "
            f"Run:  ollama pull {model}",
        )
    return True, "ok"


# --- cache ---

def _cache_load() -> dict[str, Any]:
    p = config.PATENT_SUMMARIES_CACHE
    if not p.exists():
        return {"patents": {}, "tickers": {}}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"patents": {}, "tickers": {}}


def _cache_save(cache: dict[str, Any]) -> None:
    config.PATENT_SUMMARIES_CACHE.parent.mkdir(parents=True, exist_ok=True)
    config.PATENT_SUMMARIES_CACHE.write_text(
        json.dumps(cache, ensure_ascii=False), encoding="utf-8"
    )


def _hash_input(*parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update(p.encode("utf-8"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


# --- LLM calls ---

@dataclass
class PatentBrief:
    patent_id: str
    title: str
    abstract: str


def _clean(text: str) -> str:
    """Strip the small artefacts local models sometimes attach."""
    text = text.strip()
    # Drop fenced blocks and quote wrapping if present.
    if text.startswith("```") and text.endswith("```"):
        text = text.strip("`").strip()
    text = text.strip("\"' \n")
    # Collapse internal whitespace.
    return " ".join(text.split())


def _summarize_patent(client: ollama.Client, model: str, brief: PatentBrief) -> str:
    prompt = (
        f"Patent title: {brief.title}\n\n"
        f"USPTO abstract:\n{brief.abstract[:1800]}\n\n"
        "Two-sentence plain-English explanation:"
    )
    for attempt in range(3):
        try:
            resp = client.chat(
                model=model,
                messages=[
                    {"role": "system", "content": PATENT_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                options={
                    "temperature": 0.3,
                    "num_predict": 180,
                    "top_p": 0.9,
                },
                stream=False,
            )
            text = resp.get("message", {}).get("content", "") if isinstance(resp, dict) else (
                resp.message.content if hasattr(resp, "message") else ""
            )
            return _clean(text)
        except ResponseError as e:
            log.warning("ollama error on patent %s: %s", brief.patent_id, e)
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
        except Exception as e:  # noqa: BLE001
            log.warning("transient error on patent %s: %s", brief.patent_id, e)
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


def _summarize_ticker(
    client: ollama.Client,
    model: str,
    ticker: str,
    company: str,
    briefs: list[dict],
) -> str:
    bullets = "\n".join(
        f"- {b.get('title', '')}: {b.get('summary', '')[:240]}"
        for b in briefs[:8]
    )
    prompt = (
        f"Company: {company or ticker} ({ticker})\n\n"
        f"Recent patent grants:\n{bullets}\n\n"
        "Write the paragraph:"
    )
    for attempt in range(3):
        try:
            resp = client.chat(
                model=model,
                messages=[
                    {"role": "system", "content": TICKER_SYSTEM},
                    {"role": "user", "content": prompt},
                ],
                options={
                    "temperature": 0.4,
                    "num_predict": 260,
                    "top_p": 0.9,
                },
                stream=False,
            )
            text = resp.get("message", {}).get("content", "") if isinstance(resp, dict) else (
                resp.message.content if hasattr(resp, "message") else ""
            )
            return _clean(text)
        except ResponseError as e:
            log.warning("ollama error on ticker %s: %s", ticker, e)
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
        except Exception as e:  # noqa: BLE001
            log.warning("transient error on ticker %s: %s", ticker, e)
            if attempt == 2:
                raise
            time.sleep(2 + attempt * 3)
    return ""


# --- driver ---

def _select_patents(patents_doc: dict) -> list[tuple[str, str, PatentBrief]]:
    tickers = patents_doc.get("tickers") or {}
    ranked = sorted(
        tickers.items(),
        key=lambda kv: kv[1].get("last_4q") or 0,
        reverse=True,
    )[:TOP_TICKERS_BY_VELOCITY]
    out: list[tuple[str, str, PatentBrief]] = []
    for ticker, t in ranked:
        company = t.get("company") or ticker
        for p in (t.get("latest_patents") or [])[:PATENTS_PER_TICKER]:
            pid = p.get("id")
            title = p.get("title") or ""
            abstract = p.get("abstract") or ""
            if pid and abstract:
                out.append((ticker, company, PatentBrief(pid, title, abstract)))
    return out


def _write_public(p_cache: dict, t_cache: dict, model: str) -> None:
    write_json(
        config.PATENT_SUMMARIES_JSON,
        {
            "version": 1,
            "model": model,
            "provider": "ollama",
            "patents": {
                pid: {"summary": v.get("summary", ""), "title": v.get("title", "")}
                for pid, v in p_cache.items()
            },
            "tickers": {
                t: {"narrative": v.get("narrative", "")}
                for t, v in t_cache.items()
            },
        },
    )


def run(*, force: bool = False, limit: int | None = None) -> dict:
    if not config.PATENTS_JSON.exists():
        log.warning("no patents.json — run pull_patents first")
        return {"status": "skipped", "reason": "no_patents_json"}

    host = _ollama_host()
    model = _ollama_model()
    client = ollama.Client(host=host)
    ok, msg = _check_ollama(client, model)
    if not ok:
        log.error("ollama check failed: %s", msg)
        # Write a placeholder so the lens can degrade gracefully.
        write_json(
            config.PATENT_SUMMARIES_JSON,
            {
                "version": 1,
                "model": model,
                "provider": "ollama",
                "status": "ollama_unavailable",
                "message": msg,
                "patents": {},
                "tickers": {},
            },
        )
        return {"status": "skipped", "reason": "ollama_unavailable", "message": msg}

    log.info("ollama ready · host=%s · model=%s", host, model)

    doc = read_json(config.PATENTS_JSON, default={"tickers": {}}) or {"tickers": {}}
    targets = _select_patents(doc)
    if limit:
        targets = targets[:limit]

    cache = _cache_load()
    p_cache = cache["patents"]
    t_cache = cache["tickers"]

    # ---- Phase 1: per-patent summaries ----
    needed: list[tuple[PatentBrief, str]] = []
    for _, _, brief in targets:
        h = _hash_input(brief.title, brief.abstract)
        prev = p_cache.get(brief.patent_id)
        if not force and prev and prev.get("hash") == h:
            continue
        needed.append((brief, h))

    log.info(
        "summarise · %d patents need summaries (%d already cached, %d candidates total)",
        len(needed),
        len(targets) - len(needed),
        len(targets),
    )

    fetched = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=MAX_WORKERS) as ex:
        fut_to_brief = {
            ex.submit(_summarize_patent, client, model, b): (b, h)
            for b, h in needed
        }
        for fut in as_completed(fut_to_brief):
            brief, h = fut_to_brief[fut]
            try:
                text = fut.result()
            except Exception as e:  # noqa: BLE001
                log.warning("summary failed for %s: %s", brief.patent_id, e)
                failed += 1
                continue
            if text:
                p_cache[brief.patent_id] = {
                    "summary": text,
                    "hash": h,
                    "title": brief.title,
                }
                fetched += 1
            if (fetched + failed) % 25 == 0:
                _cache_save(cache)
                log.info("  · patents: fetched=%d failed=%d", fetched, failed)

    _cache_save(cache)

    # ---- Phase 2: per-ticker rollups ----
    tickers = doc.get("tickers") or {}
    ranked_tickers = sorted(
        tickers.items(),
        key=lambda kv: kv[1].get("last_4q") or 0,
        reverse=True,
    )[:TOP_TICKERS_BY_VELOCITY]

    ticker_fetched = 0
    for ticker, t in ranked_tickers:
        latest = (t.get("latest_patents") or [])[:PATENTS_PER_TICKER]
        if not latest:
            continue
        briefs: list[dict] = []
        joint_hash_parts: list[str] = []
        for p in latest:
            pid = p.get("id")
            title = p.get("title") or ""
            summary_obj = p_cache.get(pid or "")
            if not summary_obj:
                continue
            summary = summary_obj.get("summary") or ""
            briefs.append({"title": title, "summary": summary})
            joint_hash_parts.append(pid or "")
            joint_hash_parts.append(summary)
        if not briefs:
            continue

        h = _hash_input(*joint_hash_parts)
        prev = t_cache.get(ticker)
        if not force and prev and prev.get("hash") == h:
            continue

        try:
            paragraph = _summarize_ticker(client, model, ticker, t.get("company") or "", briefs)
        except Exception as e:  # noqa: BLE001
            log.warning("ticker rollup failed for %s: %s", ticker, e)
            continue
        if paragraph:
            t_cache[ticker] = {"narrative": paragraph, "hash": h}
            ticker_fetched += 1
            if ticker_fetched % 10 == 0:
                _cache_save(cache)

    _cache_save(cache)
    _write_public(p_cache, t_cache, model)

    return {
        "patents_summarised_this_run": fetched,
        "patents_failed_this_run": failed,
        "ticker_rollups_this_run": ticker_fetched,
        "patents_total_cached": len(p_cache),
        "tickers_total_cached": len(t_cache),
        "model": model,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Patent summarizer (Ollama, local LLM)")
    parser.add_argument("--force", action="store_true", help="bypass cache, resummarise everything")
    parser.add_argument("--limit", type=int, default=None, help="cap candidates (debugging)")
    args = parser.parse_args()
    setup_logging()
    config.load_env()
    summary = run(force=args.force, limit=args.limit)
    log.info("patent summaries complete: %s", summary)


if __name__ == "__main__":
    main()
