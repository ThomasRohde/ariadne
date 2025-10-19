"""
Summarization strategies for message history.
"""

import json
import os
from typing import Optional, Sequence

from .types import CompactPolicy, Message, SummarizationError


class Summarizer:
    """LLM-based summarizer using few-shot prompts."""

    TASK_STATE_TEMPLATE = """You are summarizing a conversation for compaction.
Extract ONLY the following facts:
- Current goals and success criteria
- Key entities (names, IDs, filenames, branches, variables)
- Constraints (security, compliance, SLAs, budgets, environment requirements)
- Decisions taken and rationale
- Outstanding actions / blockers / TODOs
- Error messages and their resolution status
- Key technical details (API endpoints, data models, libraries used)

Output a tight, factual summary (<= {max_tokens} tokens). Do NOT invent details or hallucinate.
Do NOT include dialogue; focus on facts.

--- CONVERSATION HISTORY ---
{remainder_text}

--- SUMMARY ---"""

    BRIEF_TEMPLATE = """You are creating a brief summary of a conversation.
Provide a concise bullet-point summary with:
- Main topic/problem statement
- Key actions taken
- Current status
- Next steps if any

Keep it under {max_tokens} tokens.

--- CONVERSATION HISTORY ---
{remainder_text}

--- SUMMARY ---"""

    DECISION_LOG_TEMPLATE = """You are creating a decision log of a conversation.
Extract decisions made in chronological order with:
- Decision point (what was being discussed)
- Decision made
- Rationale
- Impact/outcome if available

Format as numbered list, keep under {max_tokens} tokens.

--- CONVERSATION HISTORY ---
{remainder_text}

--- DECISION LOG ---"""

    CODE_DELTA_TEMPLATE = """You are summarizing code changes from a conversation.
For each file or component mentioned:
- File path or component name
- What changed (add/modify/delete)
- Key functions/APIs affected
- Reasoning for the change

Keep it under {max_tokens} tokens.

--- CONVERSATION HISTORY ---
{remainder_text}

--- CODE SUMMARY ---"""

    STRATEGIES = {
        "task_state": TASK_STATE_TEMPLATE,
        "brief": BRIEF_TEMPLATE,
        "decision_log": DECISION_LOG_TEMPLATE,
        "code_delta": CODE_DELTA_TEMPLATE,
    }

    def __init__(self, model: str = "gpt-4", api_key: Optional[str] = None):
        """
        Initialize summarizer.

        Args:
            model: Model to use for summarization
            api_key: OpenAI API key (if not set, will use OPENAI_API_KEY env var)
        """
        self.model = model
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY")
        if not self.api_key:
            raise SummarizationError("OPENAI_API_KEY not set")
        self._client = None

    @property
    def client(self):  # type: ignore
        """Lazy-load OpenAI client."""
        if self._client is None:
            from openai import OpenAI

            self._client = OpenAI(api_key=self.api_key)
        return self._client

    def summarize(
        self,
        messages: Sequence[Message],
        max_tokens: int = 500,
        policy: Optional[CompactPolicy] = None,
    ) -> str:
        """
        Generate a summary of messages using the LLM.

        Args:
            messages: Messages to summarize
            max_tokens: Maximum tokens for summary
            policy: Compact policy (determines strategy)

        Returns:
            Summarized text

        Raises:
            SummarizationError: If summarization fails
        """
        strategy = (policy.strategy if policy else "task_state") or "task_state"

        template = self.STRATEGIES.get(strategy, self.TASK_STATE_TEMPLATE)

        # Build remainder text
        remainder_text = "\n".join(
            f"{msg.role.upper()}: {msg.content}" for msg in messages
        )

        prompt = template.format(max_tokens=max_tokens, remainder_text=remainder_text)

        try:
            response = self.client.chat.completions.create(
                model=self.model,
                messages=[{"role": "user", "content": prompt}],
                temperature=0.0,  # Deterministic
                max_tokens=min(max_tokens, 2000),
                timeout=10.0,
            )

            if not response.choices or not response.choices[0].message.content:
                raise SummarizationError("Empty response from summarizer")

            return response.choices[0].message.content.strip()

        except Exception as e:
            raise SummarizationError(f"Summarization failed: {e}")

    def summarize_with_fallback(
        self,
        messages: Sequence[Message],
        max_tokens: int = 500,
        policy: Optional[CompactPolicy] = None,
        max_retries: int = 2,
    ) -> Optional[str]:
        """
        Summarize with retry logic and exponential backoff.

        Returns None if all retries fail (fallback to pruning-only).
        """
        current_max_tokens = max_tokens

        for attempt in range(max_retries):
            try:
                return self.summarize(messages, current_max_tokens, policy)
            except SummarizationError as e:
                if attempt == max_retries - 1:
                    # Last attempt failed
                    return None

                # Reduce tokens for next attempt
                current_max_tokens = int(current_max_tokens * 0.5)
                if current_max_tokens < 100:
                    return None

        return None
