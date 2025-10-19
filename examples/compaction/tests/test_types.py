"""Tests for type system."""

import pytest

from compact import (
    CompactConfig,
    CompactPolicy,
    InsufficientBudgetError,
    Message,
    TokenBudget,
)


def test_message_protected() -> None:
    """Test message protected flag."""
    msg = Message(role="user", content="Hello", meta={"protected": True})
    assert msg.is_protected() is True

    msg_unprotected = Message(role="user", content="Hello")
    assert msg_unprotected.is_protected() is False


def test_message_label() -> None:
    """Test message label retrieval."""
    msg = Message(
        role="user", content="Hello", meta={"protected": True, "label": "Important"}
    )
    assert msg.get_label() == "Important"

    msg_no_label = Message(role="user", content="Hello", meta={"protected": True})
    assert msg_no_label.get_label() is None


def test_compact_policy_validation() -> None:
    """Test policy validation."""
    # Valid policy
    policy = CompactPolicy(trigger_pct=0.85)
    policy.validate()  # Should not raise

    # Invalid trigger_pct
    with pytest.raises(ValueError, match="trigger_pct"):
        policy = CompactPolicy(trigger_pct=0.0)
        policy.validate()

    with pytest.raises(ValueError, match="trigger_pct"):
        policy = CompactPolicy(trigger_pct=1.5)
        policy.validate()

    # Invalid keep_recent_turns
    with pytest.raises(ValueError, match="keep_recent_turns"):
        policy = CompactPolicy(keep_recent_turns=0)
        policy.validate()


def test_compact_config_validation() -> None:
    """Test config validation."""
    # Valid config
    config = CompactConfig()
    config.validate()  # Should not raise

    # Invalid max_context_tokens
    with pytest.raises(ValueError, match="max_context_tokens"):
        config = CompactConfig(max_context_tokens=100)
        config.validate()

    # Invalid model
    with pytest.raises(ValueError, match="model"):
        config = CompactConfig(model="")
        config.validate()


def test_token_budget() -> None:
    """Test token budget calculations."""
    budget = TokenBudget(
        system_tokens=100,
        messages_tokens=500,
        tools_schema_tokens=200,
    )

    assert budget.total == 800
    assert budget.available_for_response > 0


class TestInsufficientBudgetError:
    """Test custom exceptions."""

    def test_insufficient_budget_error_is_exception(self) -> None:
        """Test that InsufficientBudgetError is an Exception."""
        err = InsufficientBudgetError("Test error")
        assert isinstance(err, Exception)

    def test_insufficient_budget_error_message(self) -> None:
        """Test error message."""
        msg = "Budget exceeded"
        err = InsufficientBudgetError(msg)
        assert str(err) == msg
