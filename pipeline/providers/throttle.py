"""Persistent FMP daily call counter. Each fetch increments the count for today
in `pipeline/.fmp_call_log.json`. The file survives across runs so a second
orchestration on the same day still respects the 250-call ceiling."""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from .base import QuotaExceeded

log = logging.getLogger(__name__)


class FmpThrottle:
    def __init__(self, log_path: Path, daily_quota: int) -> None:
        self.log_path = log_path
        self.daily_quota = daily_quota
        self._lock = threading.Lock()

    def _today(self) -> str:
        # UTC-anchored so the daily quota window aligns with the rest of the
        # pipeline (every other timestamp is UTC).
        return datetime.now(timezone.utc).date().isoformat()

    def _load(self) -> dict[str, int]:
        if not self.log_path.exists():
            return {}
        try:
            with self.log_path.open("r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            return {}

    def _save(self, data: dict[str, int]) -> None:
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.log_path.with_suffix(self.log_path.suffix + ".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, self.log_path)

    def used_today(self) -> int:
        return self._load().get(self._today(), 0)

    def remaining(self) -> int:
        return max(0, self.daily_quota - self.used_today())

    def consume(self, n: int = 1) -> None:
        """Reserve `n` call(s) before issuing the request. Raises if it would
        push us over the daily quota."""
        with self._lock:
            data = self._load()
            today = self._today()
            current = data.get(today, 0)
            if current + n > self.daily_quota:
                raise QuotaExceeded(
                    f"FMP daily quota {self.daily_quota} would be exceeded "
                    f"(used {current}, requested {n})"
                )
            data[today] = current + n
            self._save(data)

    def force_refund(self, n: int = 1) -> None:
        """Roll back a reservation if the call ultimately failed before
        reaching the API (network error, etc)."""
        with self._lock:
            data = self._load()
            today = self._today()
            data[today] = max(0, data.get(today, 0) - n)
            self._save(data)
