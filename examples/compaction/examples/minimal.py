"""
Minimal integration example for OpenAI Agents SDK.

Usage:
    python minimal.py
"""

from compact import CompactManager, Message, mark_protected
from compact.hooks import create_before_model_call_hook


def main() -> None:
    """Minimal example showing compaction integration."""

    # Initialize compaction manager
    manager = CompactManager()

    # Example messages (simulating a long conversation)
    messages = [
        Message(role="system", content="You are a helpful assistant."),
        Message(role="user", content="Help me debug this code"),
        Message(role="assistant", content="I'd be happy to help. What's the issue?"),
        Message(role="user", content="The function returns None sometimes"),
        Message(
            role="assistant", content="Let's add some debug logging to trace the issue"
        ),
        # ... more messages ...
    ]

    # Mark critical messages as protected
    policy = mark_protected(
        "POLICY: Only make changes to test files, never production code",
        label="Critical Policy",
    )
    messages.insert(1, policy)

    # Create the hook for use with OpenAI Agents SDK
    before_model_call_hook = create_before_model_call_hook(manager)

    # Now in your Runner initialization:
    # runner = Runner(agent, hooks={
    #     "before_model_call": before_model_call_hook
    # })

    # For this example, manually run preflight check
    compacted = manager.preflight("session-001", messages)

    print(f"Original messages: {len(messages)}")
    print(f"Compacted messages: {len(compacted)}")


if __name__ == "__main__":
    main()
