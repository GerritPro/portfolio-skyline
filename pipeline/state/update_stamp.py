"""Track when each pipeline kind last ran, so the frontend can show
"Prices 14h ago · Fundamentals 12d ago" stamps. Writes /public/data/last_update.json."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Literal

from pipeline import config

LAST_UPDATE_FILE = config.DATA_DIR / "last_update.json"

UpdateKind = Literal["prices", "fundamentals", "japan"]


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def stamp(kind: UpdateKind) -> None:
    """Record the current UTC time against the given pipeline-kind."""
    payload: dict[str, str] = {}
    if LAST_UPDATE_FILE.exists():
        try:
            existing = json.loads(LAST_UPDATE_FILE.read_text("utf-8"))
            if isinstance(existing, dict):
                for k, v in existing.items():
                    if isinstance(k, str) and isinstance(v, str):
                        payload[k] = v
        except (json.JSONDecodeError, OSError):
            pass
    payload[kind] = _now_iso()
    LAST_UPDATE_FILE.parent.mkdir(parents=True, exist_ok=True)
    LAST_UPDATE_FILE.write_text(json.dumps(payload, indent=2), encoding="utf-8")
