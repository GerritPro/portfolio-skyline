"""Atomic JSON read/write so a crashed run never leaves half-written files."""
from __future__ import annotations

import json
import logging
import os
import tempfile
import time
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any

log = logging.getLogger(__name__)


def today_utc() -> date:
    """UTC-anchored 'today'. Every timestamp we persist is UTC; using local
    `date.today()` for idempotency comparisons creates a ~2-hour window
    around midnight (DE local time) where the same-day skip-check breaks."""
    return datetime.now(timezone.utc).date()


def _default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, set):
        return sorted(obj)
    raise TypeError(f"not JSON-serialisable: {type(obj).__name__}")


def write_json(path: Path, data: Any, *, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(
        prefix=path.name + ".", suffix=".tmp", dir=str(path.parent)
    )
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, default=_default, ensure_ascii=False, indent=indent)
            f.write("\n")
        # Windows can briefly fail os.replace if another process (e.g. the
        # Next.js dev server) holds an open handle on the destination. Retry
        # a few times with a short backoff before giving up.
        last_err: BaseException | None = None
        for attempt in range(6):
            try:
                os.replace(tmp_name, path)
                last_err = None
                break
            except PermissionError as exc:
                last_err = exc
                time.sleep(0.1 * (attempt + 1))
        if last_err is not None:
            raise last_err
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        with path.open("r", encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError:
        log.warning("malformed JSON at %s — treating as empty", path)
        return default


def setup_logging(level: int = logging.INFO) -> None:
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s :: %(message)s",
        datefmt="%H:%M:%S",
    )
