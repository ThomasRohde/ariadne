"""No-operation token estimator for testing."""

from typing import Any, Sequence

from ..types import Message


class NoOpEstimator:
    """Token estimator that returns fixed values for testing."""

    def __init__(self, default_tokens: int = 1000):
        """Initialize with default token count."""
        self.default_tokens = default_tokens

    def estimate_tokens(self, text: str) -> int:
        """Always return default tokens."""
        return self.default_tokens

    def estimate_messages_tokens(self, messages: Sequence[Message]) -> int:
        """Return default tokens per message."""
        return len(messages) * self.default_tokens

    def estimate_tools_tokens(self, tools: Sequence[dict[str, Any]]) -> int:
        """Return default tokens for all tools."""
        return self.default_tokens

    def estimate_system_tokens(self, system_prompt: str) -> int:
        """Return default tokens for system prompt."""
        return self.default_tokens
