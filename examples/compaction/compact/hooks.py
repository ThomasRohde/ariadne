"""
OpenAI Agents SDK integration hooks.
"""

from typing import Any, Optional

from .manager import CompactManager
from .types import Message


def create_before_model_call_hook(manager: CompactManager) -> callable:  # type: ignore
    """
    Create a before_model_call hook for OpenAI Agents SDK.

    Usage:
        manager = CompactManager()
        runner = Runner(agent, hooks={
            "before_model_call": create_before_model_call_hook(manager)
        })

    Args:
        manager: CompactManager instance

    Returns:
        Hook function compatible with OpenAI Agents SDK
    """

    def before_model_call(ctx: Any) -> None:
        """Pre-flight compaction check before model call."""
        try:
            session_id = getattr(ctx, "session_id", "default")
            messages = getattr(ctx, "messages", [])
            tools = getattr(ctx, "tools", None)
            system_prompt = getattr(ctx, "system_prompt", None)

            # Convert to Message objects if needed
            message_objs = []
            for msg in messages:
                if isinstance(msg, Message):
                    message_objs.append(msg)
                elif isinstance(msg, dict):
                    message_objs.append(
                        Message(
                            role=msg.get("role", "user"),
                            content=msg.get("content", ""),
                            meta=msg.get("meta", {}),
                        )
                    )
                else:
                    # Handle OpenAI message objects
                    message_objs.append(
                        Message(
                            role=getattr(msg, "role", "user"),
                            content=getattr(msg, "content", ""),
                            meta={},
                        )
                    )

            # Preflight check and potential compaction
            compacted = manager.preflight(
                session_id, message_objs, tools, system_prompt
            )

            # Replace messages in context
            ctx.messages = [
                {
                    "role": msg.role,
                    "content": msg.content,
                    **({"meta": msg.meta} if msg.meta else {}),
                }
                for msg in compacted
            ]
        except Exception as e:
            # Non-blocking: log but don't fail
            import sys

            print(f"[Compaction] Hook error: {e}", file=sys.stderr)

    return before_model_call


def mark_protected(
    content: str, label: Optional[str] = None, **extra_meta: Any
) -> Message:
    """
    Create a protected message that will never be compacted.

    Usage:
        policy_msg = mark_protected(SECURITY_POLICY, label="Security Policy")
        messages.append(policy_msg)

    Args:
        content: Message content
        label: Optional label for the protected message
        extra_meta: Additional metadata

    Returns:
        Message marked as protected
    """
    meta = {"protected": True, **({"label": label} if label else {}), **extra_meta}
    return Message(role="developer", content=content, meta=meta)
