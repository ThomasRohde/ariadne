"""Console exporter for structured logging."""

import json
import sys
from typing import Any, Optional


class ConsoleExporter:
    """Exports events to stderr as JSON."""

    def __init__(self, prefix: str = "[Compaction]"):
        """Initialize console exporter."""
        self.prefix = prefix
        self.pending_events: list[dict[str, Any]] = []

    def emit_event(
        self,
        event_type: str,
        properties: dict[str, Any],
        payload: Optional[dict[str, Any]] = None,
    ) -> None:
        """Emit event to console."""
        event = {
            "type": event_type,
            "properties": properties,
        }
        if payload:
            event["payload"] = payload

        self.pending_events.append(event)

    def flush(self) -> None:
        """Write all pending events to stderr."""
        for event in self.pending_events:
            msg = json.dumps(event)
            print(f"{self.prefix} {msg}", file=sys.stderr)
        self.pending_events.clear()
