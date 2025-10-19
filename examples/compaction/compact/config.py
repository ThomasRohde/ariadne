"""Configuration loading and management."""

import os
from pathlib import Path
from typing import Any, Optional

import yaml

from .types import CompactConfig, CompactPolicy


class ConfigLoader:
    """Loads and merges configuration from YAML and environment."""

    @staticmethod
    def load_yaml(config_path: str) -> dict[str, Any]:
        """Load configuration from YAML file."""
        path = Path(config_path)
        if not path.exists():
            raise FileNotFoundError(f"Config file not found: {config_path}")

        with open(path) as f:
            return yaml.safe_load(f) or {}

    @staticmethod
    def load_from_env() -> dict[str, Any]:
        """Load configuration from environment variables."""
        config = {}

        # Top-level config
        if model := os.environ.get("COMPACT_MODEL"):
            config["model"] = model
        if max_ctx := os.environ.get("COMPACT_MAX_CONTEXT_TOKENS"):
            config["max_context_tokens"] = int(max_ctx)

        # Policy config
        policy_config = {}
        if trigger_pct := os.environ.get("COMPACT_TRIGGER_PCT"):
            policy_config["trigger_pct"] = float(trigger_pct)
        if hard_cap := os.environ.get("COMPACT_HARD_CAP_BUFFER"):
            policy_config["hard_cap_buffer"] = int(hard_cap)
        if keep_turns := os.environ.get("COMPACT_KEEP_RECENT_TURNS"):
            policy_config["keep_recent_turns"] = int(keep_turns)
        if keep_pairs := os.environ.get("COMPACT_KEEP_TOOL_IO_PAIRS"):
            policy_config["keep_tool_io_pairs"] = int(keep_pairs)
        if strategy := os.environ.get("COMPACT_STRATEGY"):
            policy_config["strategy"] = strategy

        if policy_config:
            config["policy"] = policy_config

        # Telemetry
        if telemetry_url := os.environ.get("COMPACT_ARIADNE_URL"):
            config["ariadne_url"] = telemetry_url
        if os.environ.get("COMPACT_TELEMETRY_ENABLED") == "false":
            config["telemetry_enabled"] = False

        return config

    @staticmethod
    def load(
        config_path: Optional[str] = None, merge_env: bool = True
    ) -> CompactConfig:
        """
        Load configuration from file and environment.

        Args:
            config_path: Path to YAML config file (optional)
            merge_env: Whether to merge environment variable overrides

        Returns:
            CompactConfig object

        Raises:
            FileNotFoundError: If config file specified but not found
            ValueError: If configuration is invalid
        """
        config_dict = {}

        # Load from YAML
        if config_path:
            config_dict = ConfigLoader.load_yaml(config_path)

        # Merge environment
        if merge_env:
            env_config = ConfigLoader.load_from_env()
            config_dict = {**config_dict, **env_config}

        # Extract nested policy config
        policy_dict = config_dict.pop("policy", {})
        policy = CompactPolicy(**policy_dict)

        # Create config
        config = CompactConfig(policy=policy, **config_dict)
        config.validate()

        return config


def create_example_config(path: str) -> None:
    """Create an example configuration file."""
    example = {
        "model": "gpt-4",
        "max_context_tokens": 128000,
        "policy": {
            "trigger_pct": 0.85,
            "hard_cap_buffer": 1500,
            "keep_recent_turns": 6,
            "keep_tool_io_pairs": 4,
            "roles_never_prune": ["system", "developer"],
            "protected_flag": "protected",
            "strategy": "task_state",
        },
        "telemetry_enabled": True,
        "storage_enabled": True,
        "redaction_enabled": True,
    }

    Path(path).parent.mkdir(parents=True, exist_ok=True)

    with open(path, "w") as f:
        yaml.dump(example, f, default_flow_style=False, sort_keys=False)

    print(f"Example config created: {path}")
