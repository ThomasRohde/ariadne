"""Tests for token estimators."""

import pytest

from compact import Message
from compact.estimators import NoOpEstimator, TiktokenEstimator


class TestNoOpEstimator:
    """Tests for no-op estimator."""

    def test_estimate_tokens(self) -> None:
        """Test token estimation."""
        est = NoOpEstimator(default_tokens=50)
        assert est.estimate_tokens("any text") == 50
        assert est.estimate_tokens("") == 50

    def test_estimate_messages_tokens(self) -> None:
        """Test message sequence estimation."""
        est = NoOpEstimator(default_tokens=100)
        messages = [
            Message(role="user", content="Hello"),
            Message(role="assistant", content="Hi"),
        ]
        assert est.estimate_messages_tokens(messages) == 200

    def test_estimate_tools_tokens(self) -> None:
        """Test tools estimation."""
        est = NoOpEstimator(default_tokens=150)
        tools = [{"name": "tool1"}, {"name": "tool2"}]
        assert est.estimate_tools_tokens(tools) == 150


class TestTiktokenEstimator:
    """Tests for tiktoken estimator."""

    def test_estimate_tokens(self) -> None:
        """Test basic token estimation."""
        est = TiktokenEstimator(model="gpt-4")
        # "hello" is typically 1 token
        tokens = est.estimate_tokens("hello")
        assert tokens >= 1

    def test_estimate_empty_text(self) -> None:
        """Test empty text."""
        est = TiktokenEstimator()
        assert est.estimate_tokens("") == 0

    def test_estimate_messages_tokens(self) -> None:
        """Test message estimation."""
        est = TiktokenEstimator()
        messages = [
            Message(role="user", content="Hello"),
            Message(role="assistant", content="Hi there"),
        ]
        total = est.estimate_messages_tokens(messages)
        assert total > 0
        # Should be more than just the content (accounting for role overhead)
        content_only = est.estimate_tokens("HelloHi there")
        assert total >= content_only

    def test_fallback_encoding(self) -> None:
        """Test fallback for unknown models."""
        est = TiktokenEstimator(model="unknown-model-xyz")
        # Should fallback to cl100k_base
        tokens = est.estimate_tokens("test")
        assert tokens >= 1
