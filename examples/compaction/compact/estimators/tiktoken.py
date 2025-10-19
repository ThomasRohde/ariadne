"""Token estimation using OpenAI's tiktoken library."""

import tiktoken
from typing import Any, Sequence

from ..types import Message


class TiktokenEstimator:
    """Token estimator using OpenAI's official tiktoken library."""

    def __init__(self, model: str = "gpt-4"):
        """Initialize estimator for a specific model."""
        self.model = model
        try:
            self.encoding = tiktoken.encoding_for_model(model)
        except KeyError:
            # Fallback for newer models not yet in tiktoken
            self.encoding = tiktoken.get_encoding("cl100k_base")

    def estimate_tokens(self, text: str) -> int:
        """Estimate token count for text."""
        if not text:
            return 0
        return len(self.encoding.encode(text))

    def estimate_messages_tokens(self, messages: Sequence[Message]) -> int:
        """
        Estimate token count for a sequence of messages.

        Accounts for OpenAI's per-message overhead (3 tokens per message + role overhead).
        """
        total = 0
        for msg in messages:
            # 3 tokens for role/separator + content
            total += 3 + self.estimate_tokens(msg.content)
        return total

    def estimate_tools_tokens(self, tools: Sequence[dict[str, Any]]) -> int:
        """Estimate token count for tools schema."""
        if not tools:
            return 0

        # Tools are serialized as JSON; estimate roughly
        tools_text = str(tools)
        return self.estimate_tokens(tools_text)

    def estimate_system_tokens(self, system_prompt: str) -> int:
        """Estimate tokens for system prompt."""
        return self.estimate_tokens(system_prompt)
