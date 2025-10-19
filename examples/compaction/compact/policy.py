"""
Compaction policy and partitioning logic.
"""

from typing import Sequence

from .types import CompactPolicy, Message, TokenBudget


class MessagePartitioner:
    """Partitions messages into protected, recent, and prunable segments."""

    def __init__(self, policy: CompactPolicy):
        """Initialize partitioner with policy."""
        self.policy = policy

    def partition(
        self, messages: Sequence[Message]
    ) -> dict[str, Sequence[Message]]:
        """
        Partition messages into logical groups.

        Returns:
            dict with keys:
            - "pinned": Protected messages that are never pruned
            - "recent": Recent turns to preserve
            - "tool_io": Tool call/response pairs to preserve
            - "remainder": Everything else (eligible for summarization)
        """
        messages_list = list(messages)

        # Step 1: Extract pinned messages
        pinned = [
            msg
            for msg in messages_list
            if msg.role in self.policy.roles_never_prune or msg.is_protected()
        ]
        unpinned = [msg for msg in messages_list if msg not in pinned]

        # Step 2: Extract recent turns (user/assistant pairs)
        recent = []
        if unpinned:
            # Get the last N turns (counting user/assistant pairs)
            turn_count = 0
            recent_idx = len(unpinned) - 1
            while recent_idx >= 0 and turn_count < self.policy.keep_recent_turns:
                recent.insert(0, unpinned[recent_idx])
                if unpinned[recent_idx].role in ("user", "assistant"):
                    turn_count += 1
                recent_idx -= 1

        remaining = [msg for msg in unpinned if msg not in recent]

        # Step 3: Extract tool I/O pairs
        tool_io = []
        if remaining:
            # Last N tool_call/tool_result pairs
            pair_count = 0
            tool_idx = len(remaining) - 1
            while tool_idx >= 0 and pair_count < self.policy.keep_tool_io_pairs:
                if remaining[tool_idx].role == "tool":
                    tool_io.insert(0, remaining[tool_idx])
                    pair_count += 1
                tool_idx -= 1

        remainder = [msg for msg in remaining if msg not in tool_io]

        return {
            "pinned": pinned,
            "recent": recent,
            "tool_io": tool_io,
            "remainder": remainder,
        }

    def check_trigger(
        self, tokens_estimated: int, max_context_tokens: int
    ) -> bool:
        """
        Check if compaction should be triggered based on budget.

        Returns True if estimated usage exceeds trigger threshold.
        """
        # Reserve buffer at end of context window
        effective_max = max_context_tokens - self.policy.hard_cap_buffer
        usage_pct = tokens_estimated / effective_max
        return usage_pct >= self.policy.trigger_pct

    def check_budget_feasibility(
        self,
        pinned_tokens: int,
        recent_tokens: int,
        tool_io_tokens: int,
        max_context_tokens: int,
    ) -> bool:
        """
        Check if protected + recent + tool I/O fits within budget.

        Returns False if insufficient budget (error condition).
        """
        required = pinned_tokens + recent_tokens + tool_io_tokens
        # Account for response budget
        response_budget = 2048
        available = max_context_tokens - response_budget
        return required <= available

    def reduce_keep_counts(self, policy: CompactPolicy) -> CompactPolicy:
        """
        Incrementally reduce keep counts when over budget.

        Returns new policy with reduced keep counts (floor = 1).
        """
        new_policy = CompactPolicy(
            trigger_pct=policy.trigger_pct,
            hard_cap_buffer=policy.hard_cap_buffer,
            keep_recent_turns=max(1, policy.keep_recent_turns - 1),
            keep_tool_io_pairs=max(1, policy.keep_tool_io_pairs - 1),
            roles_never_prune=policy.roles_never_prune,
            protected_flag=policy.protected_flag,
            strategy=policy.strategy,
        )
        return new_policy
