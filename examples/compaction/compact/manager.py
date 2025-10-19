"""
Main compaction manager orchestrating the compaction process.
"""

import time
import uuid
from typing import Any, Optional, Sequence

from .estimators import TiktokenEstimator
from .exporters import ConsoleExporter
from .policy import MessagePartitioner
from .summarizer import Summarizer
from .types import (
    CompactConfig,
    CompactPolicy,
    CompactionResult,
    InsufficientBudgetError,
    Message,
    TokenBudget,
)


class CompactManager:
    """Manages the compaction process for agent sessions."""

    def __init__(
        self,
        config: Optional[CompactConfig] = None,
        estimator: Optional[Any] = None,
        summarizer: Optional[Summarizer] = None,
        exporter: Optional[Any] = None,
    ):
        """
        Initialize compaction manager.

        Args:
            config: Compaction configuration
            estimator: Token estimator (default: TiktokenEstimator)
            summarizer: Message summarizer (default: Summarizer)
            exporter: Telemetry exporter (default: ConsoleExporter)
        """
        self.config = config or CompactConfig()
        self.config.validate()

        self.estimator = estimator or TiktokenEstimator(self.config.model)
        self.summarizer = summarizer or Summarizer(self.config.model)
        self.exporter = exporter or ConsoleExporter()

        self.partitioner = MessagePartitioner(self.config.policy)

    def preflight(
        self,
        session_id: str,
        messages: Sequence[Message],
        tools: Optional[Sequence[dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> Sequence[Message]:
        """
        Pre-flight check and compaction if needed.

        This is the main entry point, typically called from before_model_call hook.

        Args:
            session_id: Session identifier for tracking
            messages: Current message history
            tools: Tool definitions (optional)
            system_prompt: System prompt (optional)

        Returns:
            Potentially compacted message list

        Raises:
            InsufficientBudgetError: If protected memory exceeds budget
        """
        # Estimate current token usage
        budget = self._estimate_budget(messages, tools, system_prompt)

        # Emit token estimate event
        self.exporter.emit_event(
            "compact.token_estimate",
            {
                "session_id": session_id,
                "model": self.config.model,
                "tokens_estimated": budget.total,
                "max_tokens": self.config.max_context_tokens,
                "usage_pct": budget.total / self.config.max_context_tokens,
                "breakdown": {
                    "system": budget.system_tokens,
                    "messages": budget.messages_tokens,
                    "tools": budget.tools_schema_tokens,
                },
            },
        )

        # Check if compaction should be triggered
        should_trigger = self.partitioner.check_trigger(
            budget.total, self.config.max_context_tokens
        )

        self.exporter.emit_event(
            "compact.trigger_decision",
            {
                "session_id": session_id,
                "triggered": should_trigger,
                "reason": (
                    "usage_pct >= trigger_pct"
                    if should_trigger
                    else "usage_pct < trigger_pct"
                ),
                "policy": {
                    "trigger_pct": self.config.policy.trigger_pct,
                    "hard_cap_buffer": self.config.policy.hard_cap_buffer,
                    "strategy": self.config.policy.strategy,
                },
            },
        )

        if not should_trigger:
            return messages

        # Perform compaction
        result = self.manual_compact(session_id, messages, "pre-flight trigger")
        return result.messages

    def manual_compact(
        self,
        session_id: str,
        messages: Sequence[Message],
        note: str = "manual",
    ) -> CompactionResult:
        """
        Manually trigger compaction.

        Args:
            session_id: Session identifier
            messages: Messages to compact
            note: Reason for compaction

        Returns:
            CompactionResult with compacted messages

        Raises:
            InsufficientBudgetError: If protected memory exceeds budget
        """
        start_time = time.time()
        messages_list = list(messages)

        # Estimate before-compaction tokens
        tokens_before = self.estimator.estimate_messages_tokens(messages_list)

        # Partition messages
        partition = self.partitioner.partition(messages_list)

        pinned = partition["pinned"]
        recent = partition["recent"]
        tool_io = partition["tool_io"]
        remainder = partition["remainder"]

        # Estimate partition token counts
        pinned_tokens = self.estimator.estimate_messages_tokens(pinned)
        recent_tokens = self.estimator.estimate_messages_tokens(recent)
        tool_io_tokens = self.estimator.estimate_messages_tokens(tool_io)
        remainder_tokens = self.estimator.estimate_messages_tokens(remainder)

        # Check budget feasibility
        if not self.partitioner.check_budget_feasibility(
            pinned_tokens, recent_tokens, tool_io_tokens, self.config.max_context_tokens
        ):
            # Try reducing keep counts
            reduced_policy = self.config.policy
            for _ in range(2):
                reduced_policy = self.partitioner.reduce_keep_counts(reduced_policy)
                self.partitioner = MessagePartitioner(reduced_policy)
                partition = self.partitioner.partition(messages_list)

                pinned = partition["pinned"]
                recent = partition["recent"]
                tool_io = partition["tool_io"]

                pinned_tokens = self.estimator.estimate_messages_tokens(pinned)
                recent_tokens = self.estimator.estimate_messages_tokens(recent)
                tool_io_tokens = self.estimator.estimate_messages_tokens(tool_io)

                if self.partitioner.check_budget_feasibility(
                    pinned_tokens,
                    recent_tokens,
                    tool_io_tokens,
                    self.config.max_context_tokens,
                ):
                    break
            else:
                raise InsufficientBudgetError(
                    "Protected memory + recent + tool I/O exceeds budget. "
                    "Increase max_context_tokens or reduce protected memory."
                )

        # Attempt summarization
        summary_message = None
        summary_tokens = 0

        if remainder:
            # Calculate available budget for summary
            available_for_summary = (
                self.config.max_context_tokens
                - self.config.policy.hard_cap_buffer
                - pinned_tokens
                - recent_tokens
                - tool_io_tokens
            )

            if available_for_summary > 100:
                summary_text = self.summarizer.summarize_with_fallback(
                    remainder,
                    max_tokens=available_for_summary,
                    policy=self.config.policy,
                )

                if summary_text:
                    summary_message = Message(
                        role="assistant",
                        content=f"[COMPACT-SUMMARY] {summary_text}",
                        meta={"protected": True, "label": "Compaction Summary"},
                    )
                    summary_tokens = self.estimator.estimate_tokens(summary_text)

                    self.exporter.emit_event(
                        "compact.summary_created",
                        {
                            "session_id": session_id,
                            "strategy": self.config.policy.strategy,
                            "input_messages": len(remainder),
                            "summary_tokens": summary_tokens,
                            "compression_ratio": summary_tokens / remainder_tokens
                            if remainder_tokens > 0
                            else 0,
                        },
                        payload={"summary": summary_text},
                    )

        # Build compacted message list
        compacted: list[Message] = []
        compacted.extend(pinned)
        if summary_message:
            compacted.append(summary_message)
        compacted.extend(recent)
        compacted.extend(tool_io)

        # Estimate after-compaction tokens
        tokens_after = self.estimator.estimate_messages_tokens(compacted)

        # Emit pruned event
        self.exporter.emit_event(
            "compact.pruned_messages",
            {
                "session_id": session_id,
                "pruned_count": len(remainder),
                "kept": {
                    "pinned": len(pinned),
                    "summary": 1 if summary_message else 0,
                    "recent_turns": len(recent),
                    "tool_pairs": len(tool_io),
                },
                "tokens_before": tokens_before,
                "tokens_after": tokens_after,
                "reduction_pct": (
                    (tokens_before - tokens_after) / tokens_before * 100
                    if tokens_before > 0
                    else 0
                ),
            },
        )

        elapsed_ms = int((time.time() - start_time) * 1000)

        self.exporter.flush()

        return CompactionResult(
            messages=compacted,
            summary=summary_message,
            was_triggered=True,
            tokens_before=tokens_before,
            tokens_after=tokens_after,
            pruned_count=len(remainder),
            kept={
                "pinned": len(pinned),
                "recent": len(recent),
                "tool_io": len(tool_io),
                "summary": 1 if summary_message else 0,
            },
            policy_applied=self.config.policy,
        )

    def _estimate_budget(
        self,
        messages: Sequence[Message],
        tools: Optional[Sequence[dict[str, Any]]] = None,
        system_prompt: Optional[str] = None,
    ) -> TokenBudget:
        """Estimate total token budget for messages, tools, and system prompt."""
        budget = TokenBudget()

        if system_prompt:
            budget.system_tokens = self.estimator.estimate_system_tokens(system_prompt)

        budget.messages_tokens = self.estimator.estimate_messages_tokens(messages)

        if tools:
            budget.tools_schema_tokens = self.estimator.estimate_tools_tokens(tools)

        return budget
