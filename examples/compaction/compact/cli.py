"""Command-line interface for compaction utilities."""

import argparse
import json
import sys
from typing import Any

from .config import ConfigLoader, create_example_config
from .manager import CompactManager
from .types import Message


def parse_messages_json(data: str) -> list[Message]:
    """Parse messages from JSON string."""
    try:
        msgs = json.loads(data)
        return [
            Message(
                role=msg.get("role", "user"),
                content=msg.get("content", ""),
                meta=msg.get("meta", {}),
            )
            for msg in msgs
        ]
    except json.JSONDecodeError as e:
        print(f"Invalid JSON: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_validate_config(args: Any) -> None:
    """Validate configuration file."""
    try:
        config = ConfigLoader.load(args.config, merge_env=args.merge_env)
        print("✓ Configuration is valid")
        print(f"  Model: {config.model}")
        print(f"  Max tokens: {config.max_context_tokens}")
        print(f"  Trigger: {config.policy.trigger_pct * 100:.0f}%")
        print(f"  Strategy: {config.policy.strategy}")
    except Exception as e:
        print(f"✗ Configuration error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_dry_run(args: Any) -> None:
    """Show compaction plan without executing."""
    try:
        config = ConfigLoader.load(args.config, merge_env=args.merge_env)
        messages = parse_messages_json(args.messages)

        manager = CompactManager(config=config)
        partition = manager.partitioner.partition(messages)

        print("Compaction Plan:")
        print(f"  Total messages: {len(messages)}")
        print(f"  Pinned: {len(partition['pinned'])}")
        print(f"  Recent: {len(partition['recent'])}")
        print(f"  Tool I/O: {len(partition['tool_io'])}")
        print(f"  Eligible for pruning: {len(partition['remainder'])}")

        should_trigger = manager.partitioner.check_trigger(
            manager.estimator.estimate_messages_tokens(messages),
            config.max_context_tokens,
        )
        print(f"  Trigger needed: {'Yes' if should_trigger else 'No'}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_compact(args: Any) -> None:
    """Execute compaction."""
    try:
        config = ConfigLoader.load(args.config, merge_env=args.merge_env)
        messages = parse_messages_json(args.messages)

        manager = CompactManager(config=config)
        result = manager.manual_compact("cli-session", messages)

        print("Compaction Result:")
        print(f"  Messages before: {result.tokens_before} tokens")
        print(f"  Messages after: {result.tokens_after} tokens")
        print(f"  Reduction: {result.tokens_before - result.tokens_after} tokens")
        print(f"  Pruned: {result.pruned_count} messages")
        print(f"  Kept:")
        for key, count in result.kept.items():
            print(f"    {key}: {count}")

        if args.output:
            output = {
                "messages": [
                    {
                        "role": msg.role,
                        "content": msg.content,
                        "meta": msg.meta,
                    }
                    for msg in result.messages
                ],
                "statistics": {
                    "tokens_before": result.tokens_before,
                    "tokens_after": result.tokens_after,
                    "pruned_count": result.pruned_count,
                },
            }
            with open(args.output, "w") as f:
                json.dump(output, f, indent=2)
            print(f"  Output saved to: {args.output}")

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def cmd_create_config(args: Any) -> None:
    """Create example configuration file."""
    try:
        create_example_config(args.output)
    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


def main() -> None:
    """Main CLI entry point."""
    parser = argparse.ArgumentParser(description="Compaction tool for agent sessions")

    subparsers = parser.add_subparsers(dest="command", help="Command")

    # validate-config command
    validate_parser = subparsers.add_parser(
        "validate-config", help="Validate configuration file"
    )
    validate_parser.add_argument(
        "--config", help="Configuration file path", default="config.yaml"
    )
    validate_parser.add_argument(
        "--merge-env", action="store_true", help="Merge environment variables"
    )
    validate_parser.set_defaults(func=cmd_validate_config)

    # dry-run command
    dry_run_parser = subparsers.add_parser(
        "dry-run", help="Show compaction plan without executing"
    )
    dry_run_parser.add_argument(
        "--config", help="Configuration file path", default="config.yaml"
    )
    dry_run_parser.add_argument(
        "--messages", help="JSON-encoded messages list", required=True
    )
    dry_run_parser.add_argument(
        "--merge-env", action="store_true", help="Merge environment variables"
    )
    dry_run_parser.set_defaults(func=cmd_dry_run)

    # compact command
    compact_parser = subparsers.add_parser("compact", help="Execute compaction")
    compact_parser.add_argument(
        "--config", help="Configuration file path", default="config.yaml"
    )
    compact_parser.add_argument(
        "--messages", help="JSON-encoded messages list", required=True
    )
    compact_parser.add_argument(
        "--output", help="Output file for compacted messages (JSON)"
    )
    compact_parser.add_argument(
        "--merge-env", action="store_true", help="Merge environment variables"
    )
    compact_parser.set_defaults(func=cmd_compact)

    # create-config command
    config_parser = subparsers.add_parser(
        "create-config", help="Create example configuration file"
    )
    config_parser.add_argument(
        "--output", help="Output file path", default="config.yaml"
    )
    config_parser.set_defaults(func=cmd_create_config)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
