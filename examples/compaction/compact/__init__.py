"""
Ariadne Compaction Extension - Auto-compaction for OpenAI Agents SDK
"""

from .types import (
    CompactConfig,
    CompactError,
    CompactPolicy,
    CompactionResult,
    InsufficientBudgetError,
    Message,
    SummarizationError,
    TokenBudget,
)

__version__ = "0.1.0"
__all__ = [
    "CompactManager",
    "CompactConfig",
    "CompactPolicy",
    "CompactError",
    "InsufficientBudgetError",
    "SummarizationError",
    "CompactionResult",
    "Message",
    "TokenBudget",
    "mark_protected",
]

# Lazy imports to avoid circular dependencies
def __getattr__(name: str):  # type: ignore
    if name == "CompactManager":
        from .manager import CompactManager
        return CompactManager
    elif name == "mark_protected":
        from .hooks import mark_protected
        return mark_protected
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
