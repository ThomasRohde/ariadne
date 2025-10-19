"""Ariadne trace viewer exporter."""

import json
import os
import time
import uuid
from typing import Any, Optional

import httpx


class AriadneExporter:
    """
    Exports compaction events to Ariadne Trace Viewer via HTTP.

    Non-blocking with configurable timeout and batching.
    """

    def __init__(
        self,
        ariadne_url: str = "http://localhost:5175/ingest",
        trace_id: Optional[str] = None,
        timeout: float = 2.0,
    ):
        """
        Initialize Ariadne exporter.

        Args:
            ariadne_url: Ariadne API endpoint
            trace_id: Trace ID for all events (auto-generated if not provided)
            timeout: HTTP request timeout in seconds
        """
        self.ariadne_url = ariadne_url
        self.trace_id = trace_id or f"session-{uuid.uuid4().hex[:12]}"
        self.timeout = timeout
        self.pending_events: list[dict[str, Any]] = []
        self.http_client = httpx.Client(timeout=httpx.Timeout(timeout))

    def emit_event(
        self,
        event_type: str,
        properties: dict[str, Any],
        payload: Optional[dict[str, Any]] = None,
    ) -> None:
        """Emit event for export to Ariadne."""
        span_id = f"compact-{uuid.uuid4().hex[:8]}"

        event = {
            "type": "span",
            "trace_id": self.trace_id,
            "span_id": span_id,
            "name": event_type,
            "timestamp": time.time(),
            "properties": properties,
        }

        if payload:
            event["payload"] = json.dumps(payload)

        self.pending_events.append(event)

    def flush(self) -> None:
        """Batch and send all pending events to Ariadne."""
        if not self.pending_events:
            return

        try:
            payload = {"events": self.pending_events}
            response = self.http_client.post(
                self.ariadne_url,
                json=payload,
                timeout=self.timeout,
            )
            response.raise_for_status()
            self.pending_events.clear()
        except Exception as e:
            # Non-blocking: log but don't raise
            print(
                f"[Ariadne] Failed to export events: {e}",
                file=__import__("sys").stderr,
            )

    def __del__(self):
        """Ensure client is closed."""
        try:
            self.http_client.close()
        except Exception:
            pass
