"""Test fixtures and configuration."""

import pytest

from compact import CompactConfig, CompactPolicy, Message
from compact.estimators import NoOpEstimator


@pytest.fixture
def basic_policy() -> CompactPolicy:
    """Basic policy for testing."""
    return CompactPolicy(
        trigger_pct=0.85,
        hard_cap_buffer=1500,
        keep_recent_turns=3,
        keep_tool_io_pairs=2,
        strategy="task_state",
    )


@pytest.fixture
def basic_config(basic_policy: CompactPolicy) -> CompactConfig:
    """Basic configuration for testing."""
    return CompactConfig(
        model="gpt-4",
        max_context_tokens=128000,
        policy=basic_policy,
        telemetry_enabled=False,
        storage_enabled=False,
    )


@pytest.fixture
def sample_messages() -> list[Message]:
    """Sample messages for testing."""
    return [
        Message(role="system", content="You are a helpful assistant."),
        Message(role="user", content="Hello, how are you?"),
        Message(role="assistant", content="I'm doing well, thanks for asking!"),
        Message(role="user", content="Can you help me with Python?"),
        Message(role="assistant", content="Of course! What do you need help with?"),
        Message(role="user", content="I need to debug a function"),
        Message(role="assistant", content="Let me help. What's the error?"),
    ]


@pytest.fixture
def noop_estimator() -> NoOpEstimator:
    """No-op token estimator for deterministic testing."""
    return NoOpEstimator(default_tokens=100)


@pytest.fixture
def protected_message() -> Message:
    """Protected message fixture."""
    return Message(
        role="developer",
        content="POLICY: Do not modify production code",
        meta={"protected": True, "label": "Policy"},
    )
