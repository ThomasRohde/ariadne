"""Tests for compaction policy and partitioning."""

import pytest

from compact import CompactPolicy, Message
from compact.policy import MessagePartitioner


class TestMessagePartitioner:
    """Tests for message partitioner."""

    def test_partition_empty(self, basic_policy: CompactPolicy) -> None:
        """Test partitioning empty message list."""
        partitioner = MessagePartitioner(basic_policy)
        partition = partitioner.partition([])

        assert partition["pinned"] == []
        assert partition["recent"] == []
        assert partition["tool_io"] == []
        assert partition["remainder"] == []

    def test_partition_system_role_pinned(self, basic_policy: CompactPolicy) -> None:
        """Test that system messages are pinned."""
        messages = [
            Message(role="system", content="System prompt"),
            Message(role="user", content="User message"),
        ]

        partitioner = MessagePartitioner(basic_policy)
        partition = partitioner.partition(messages)

        assert len(partition["pinned"]) == 1
        assert partition["pinned"][0].role == "system"

    def test_partition_protected_flag(self, basic_policy: CompactPolicy) -> None:
        """Test that protected messages are pinned."""
        messages = [
            Message(role="user", content="Important", meta={"protected": True}),
            Message(role="user", content="Regular"),
        ]

        partitioner = MessagePartitioner(basic_policy)
        partition = partitioner.partition(messages)

        assert len(partition["pinned"]) == 1
        assert partition["pinned"][0].meta.get("protected") is True

    def test_partition_recent_turns(self, basic_policy: CompactPolicy) -> None:
        """Test recent turns are preserved."""
        messages = [
            Message(role="user", content="Q1"),
            Message(role="assistant", content="A1"),
            Message(role="user", content="Q2"),
            Message(role="assistant", content="A2"),
            Message(role="user", content="Q3"),
            Message(role="assistant", content="A3"),
        ]

        partitioner = MessagePartitioner(basic_policy)
        partition = partitioner.partition(messages)

        # Should keep last 3 turns
        assert len(partition["recent"]) >= 4

    def test_trigger_not_exceeded(self, basic_policy: CompactPolicy) -> None:
        """Test trigger when usage is below threshold."""
        partitioner = MessagePartitioner(basic_policy)
        tokens_estimated = 50000
        max_context_tokens = 128000

        should_trigger = partitioner.check_trigger(tokens_estimated, max_context_tokens)
        assert should_trigger is False

    def test_trigger_exceeded(self, basic_policy: CompactPolicy) -> None:
        """Test trigger when usage exceeds threshold."""
        partitioner = MessagePartitioner(basic_policy)
        tokens_estimated = 120000  # 93% of 128k
        max_context_tokens = 128000

        should_trigger = partitioner.check_trigger(tokens_estimated, max_context_tokens)
        assert should_trigger is True

    def test_budget_feasibility_ok(self, basic_policy: CompactPolicy) -> None:
        """Test budget feasibility when under budget."""
        partitioner = MessagePartitioner(basic_policy)
        pinned_tokens = 5000
        recent_tokens = 10000
        tool_io_tokens = 5000
        max_context_tokens = 128000

        feasible = partitioner.check_budget_feasibility(
            pinned_tokens, recent_tokens, tool_io_tokens, max_context_tokens
        )
        assert feasible is True

    def test_budget_feasibility_over(self, basic_policy: CompactPolicy) -> None:
        """Test budget feasibility when over budget."""
        partitioner = MessagePartitioner(basic_policy)
        pinned_tokens = 80000
        recent_tokens = 30000
        tool_io_tokens = 20000
        max_context_tokens = 128000

        feasible = partitioner.check_budget_feasibility(
            pinned_tokens, recent_tokens, tool_io_tokens, max_context_tokens
        )
        assert feasible is False

    def test_reduce_keep_counts(self, basic_policy: CompactPolicy) -> None:
        """Test reducing keep counts."""
        partitioner = MessagePartitioner(basic_policy)
        original_turns = basic_policy.keep_recent_turns
        original_pairs = basic_policy.keep_tool_io_pairs

        reduced = partitioner.reduce_keep_counts(basic_policy)

        assert reduced.keep_recent_turns == original_turns - 1
        assert reduced.keep_tool_io_pairs == original_pairs - 1
        assert reduced.keep_recent_turns >= 1
        assert reduced.keep_tool_io_pairs >= 1
