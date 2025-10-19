"""
Core type definitions for the compaction extension.
"""

from dataclasses import dataclass, field
from typing import Any, Literal, Optional, Sequence


@dataclass
class Message:
    """Represents a message in the conversation."""

    role: str
    content: str
    meta: dict[str, Any] = field(default_factory=dict)

    def is_protected(self) -> bool:
        """Check if message is marked as protected."""
        return self.meta.get("protected", False) is True

    def get_label(self) -> Optional[str]:
        """Get optional label for protected messages."""
        return self.meta.get("label")


@dataclass
class CompactPolicy:
    """Configuration for the compaction decision and pruning logic."""

    trigger_pct: float = 0.85
    hard_cap_buffer: int = 1500
    keep_recent_turns: int = 6
    keep_tool_io_pairs: int = 4
    roles_never_prune: tuple[str, ...] = ("system", "developer")
    protected_flag: str = "protected"
    strategy: Literal["task_state", "brief", "decision_log", "code_delta"] = "task_state"

    def validate(self) -> None:
        """Validate policy constraints."""
        if not (0.0 < self.trigger_pct <= 1.0):
            raise ValueError("trigger_pct must be in range (0.0, 1.0]")
        if self.keep_recent_turns < 1:
            raise ValueError("keep_recent_turns must be >= 1")
        if self.keep_tool_io_pairs < 1:
            raise ValueError("keep_tool_io_pairs must be >= 1")
        if self.hard_cap_buffer < 0:
            raise ValueError("hard_cap_buffer must be >= 0")


@dataclass
class CompactConfig:
    """Complete configuration for the compaction manager."""

    model: str = "gpt-4"
    max_context_tokens: int = 128000
    policy: CompactPolicy = field(default_factory=CompactPolicy)
    telemetry_enabled: bool = True
    storage_enabled: bool = True
    redaction_enabled: bool = True

    def validate(self) -> None:
        """Validate configuration."""
        if self.max_context_tokens < 1000:
            raise ValueError("max_context_tokens must be >= 1000")
        if not self.model:
            raise ValueError("model must not be empty")
        self.policy.validate()


@dataclass
class TokenBudget:
    """Token accounting for a model call."""

    system_tokens: int = 0
    developer_tokens: int = 0
    tools_schema_tokens: int = 0
    messages_tokens: int = 0

    @property
    def total(self) -> int:
        """Total tokens used."""
        return (
            self.system_tokens
            + self.developer_tokens
            + self.tools_schema_tokens
            + self.messages_tokens
        )

    @property
    def available_for_response(self) -> int:
        """Approximate tokens available for response (after some buffer)."""
        return max(0, 4096 - (self.total % 4096))


@dataclass
class CompactionResult:
    """Result of a compaction operation."""

    messages: Sequence[Message]
    summary: Optional[Message] = None
    was_triggered: bool = False
    tokens_before: int = 0
    tokens_after: int = 0
    pruned_count: int = 0
    kept: dict[str, int] = field(default_factory=dict)
    policy_applied: Optional[CompactPolicy] = None


class CompactError(Exception):
    """Base exception for compaction errors."""

    pass


class InsufficientBudgetError(CompactError):
    """Raised when protected memory alone exceeds budget."""

    pass


class SummarizationError(CompactError):
    """Raised when summarization fails."""

    pass
