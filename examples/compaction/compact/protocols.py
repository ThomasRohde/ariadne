"""
Service Provider Interface (SPI) protocols for pluggable components.
"""

from typing import Any, Protocol, Sequence

from .types import CompactPolicy, Message


class TokenEstimator(Protocol):
    """Protocol for token estimation implementations."""

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for text."""
        ...

    def estimate_messages_tokens(self, messages: Sequence[Message]) -> int:
        """Estimate token count for a sequence of messages."""
        ...

    def estimate_tools_tokens(self, tools: Sequence[dict[str, Any]]) -> int:
        """Estimate token count for tools schema."""
        ...


class StorageAdapter(Protocol):
    """Protocol for pluggable storage backends."""

    def save_transcript(
        self, session_id: str, messages: Sequence[Message], step: int = 0
    ) -> None:
        """Save full conversation transcript before compaction."""
        ...

    def save_summary(self, session_id: str, summary: Message, step: int = 1) -> None:
        """Save compaction summary."""
        ...

    def save_event(self, session_id: str, event: dict[str, Any]) -> None:
        """Save structured compaction event."""
        ...


class Exporter(Protocol):
    """Protocol for telemetry exporters."""

    def emit_event(
        self,
        event_type: str,
        properties: dict[str, Any],
        payload: dict[str, Any] | None = None,
    ) -> None:
        """Emit a structured event."""
        ...

    def flush(self) -> None:
        """Flush any pending events."""
        ...


class Summarizer(Protocol):
    """Protocol for summarization strategies."""

    def summarize(
        self,
        messages: Sequence[Message],
        max_tokens: int,
        policy: CompactPolicy | None = None,
    ) -> str:
        """Generate a summary of messages."""
        ...
