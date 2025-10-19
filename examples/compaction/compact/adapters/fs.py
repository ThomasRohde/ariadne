"""Filesystem-based storage adapter."""

import json
import re
from pathlib import Path
from typing import Any, Optional, Sequence

from ..types import Message


class FileStorageAdapter:
    """Stores transcripts and summaries to the local filesystem."""

    def __init__(
        self,
        base_path: str = "./.compact/archive",
        redaction_patterns: Optional[Sequence[str]] = None,
    ):
        """
        Initialize filesystem storage adapter.

        Args:
            base_path: Base directory for archives
            redaction_patterns: List of regex patterns to redact before saving
        """
        self.base_path = Path(base_path)
        self.redaction_patterns = [
            re.compile(pattern, re.IGNORECASE)
            for pattern in (
                redaction_patterns
                or [
                    r"(?i)api[_-]?key\s*[:=]\s*\S+",
                    r"(?i)password\s*[:=]\s*\S+",
                    r"(?i)token\s*[:=]\s*\S+",
                    r"(?i)secret\s*[:=]\s*\S+",
                ]
            )
        ]

    def _ensure_session_dir(self, session_id: str) -> Path:
        """Ensure session directory exists."""
        session_dir = self.base_path / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    def _redact(self, text: str) -> str:
        """Apply redaction patterns to text."""
        result = text
        for pattern in self.redaction_patterns:
            result = pattern.sub("[REDACTED]", result)
        return result

    def save_transcript(
        self, session_id: str, messages: Sequence[Message], step: int = 0
    ) -> None:
        """Save full conversation transcript before compaction."""
        session_dir = self._ensure_session_dir(session_id)
        filename = session_dir / f"transcript-pre-compact-{step:03d}.jsonl"

        with open(filename, "w") as f:
            for msg in messages:
                record = {
                    "role": msg.role,
                    "content": self._redact(msg.content),
                    "meta": msg.meta,
                }
                f.write(json.dumps(record) + "\n")

    def save_summary(self, session_id: str, summary: Message, step: int = 1) -> None:
        """Save compaction summary."""
        session_dir = self._ensure_session_dir(session_id)
        filename = session_dir / f"summary-{step:03d}.json"

        record = {
            "role": summary.role,
            "content": self._redact(summary.content),
            "meta": summary.meta,
        }

        with open(filename, "w") as f:
            json.dump(record, f, indent=2)

    def save_event(self, session_id: str, event: dict[str, Any]) -> None:
        """Save structured compaction event."""
        session_dir = self._ensure_session_dir(session_id)
        filename = session_dir / "events.jsonl"

        with open(filename, "a") as f:
            f.write(json.dumps(event) + "\n")
