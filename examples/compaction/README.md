# Ariadne Compaction Extension

**Auto-compaction for OpenAI Agents SDK** with deterministic summarization, protected memory, and rich trace viewer integration.

## Overview

Long-running agent sessions accumulate conversation history until they hit model context limits. This extension proactively manages context by:

- **Monitoring token usage** with OpenAI's official `tiktoken` estimator
- **Triggering deterministic compaction** (summarization + pruning) before limits are hit
- **Preserving critical facts** via protected memory tagging
- **Emitting rich telemetry** to Ariadne Trace Viewer for observability
- **Non-blocking**, production-ready with redaction and archival support

## Quick Start

### Installation

```bash
# Create virtual environment
python -m venv .venv
source .venv/bin/activate

# Install from source
pip install -e .

# Install with dev tools (testing, linting)
pip install -e ".[dev]"
```

### Minimal Example (< 10 LOC)

```python
from compact import CompactManager, mark_protected
from compact.hooks import create_before_model_call_hook

# Initialize
manager = CompactManager()
hook = create_before_model_call_hook(manager)

# Use with OpenAI Agents SDK
from openai_agents import Runner, Agent
runner = Runner(agent, hooks={"before_model_call": hook})

# Mark critical messages as protected
policy_msg = mark_protected("POLICY: Only modify test files")
messages.insert(0, policy_msg)

# Preflight will automatically compact if needed
compacted = manager.preflight("session-001", messages)
```

## Configuration

### Environment Variables

```bash
# Model selection
export COMPACT_MODEL=gpt-4

# Trigger threshold (0.0-1.0)
export COMPACT_TRIGGER_PCT=0.85

# Keep counts
export COMPACT_KEEP_RECENT_TURNS=6
export COMPACT_KEEP_TOOL_IO_PAIRS=4

# Ariadne integration
export COMPACT_ARIADNE_URL=http://localhost:5175/ingest
```

### YAML Configuration

```yaml
model: "gpt-4"
max_context_tokens: 128000

policy:
  trigger_pct: 0.85
  hard_cap_buffer: 1500
  keep_recent_turns: 6
  keep_tool_io_pairs: 4
  roles_never_prune: ["system", "developer"]
  strategy: "task_state"  # brief | decision_log | code_delta

telemetry_enabled: true
storage_enabled: true
redaction_enabled: true
```

Create example:
```bash
compactctl create-config --output config.yaml
```

## CLI Tool

```bash
# Validate configuration
compactctl validate-config --config config.yaml

# Show compaction plan without executing
compactctl dry-run --config config.yaml --messages '[]'

# Execute compaction
compactctl compact --config config.yaml --messages '[]' --output result.json
```

## API Documentation

### CompactManager

```python
manager = CompactManager(config=CompactConfig())

# Main entry point (typically from before_model_call hook)
compacted = manager.preflight(
    session_id="session-001",
    messages=[...],
    tools=[...],  # optional
    system_prompt="...",  # optional
)

# Manual trigger
result = manager.manual_compact("session-001", messages, note="manual")

# Result contains:
# - result.messages: compacted message list
# - result.summary: summarized message (if created)
# - result.tokens_before / tokens_after: token counts
# - result.pruned_count: number of messages pruned
```

### Protected Memory

```python
from compact import mark_protected, Message

# Mark a message as protected (never pruned)
policy = mark_protected(
    "POLICY: Always verify before deploying",
    label="Deployment Policy"
)
messages.insert(0, policy)

# Or directly create Message with metadata
msg = Message(
    role="developer",
    content="Critical constraint",
    meta={"protected": True, "label": "Constraint"}
)
```

### Summarization Strategies

- **task_state**: Goals, entities, constraints, decisions (default for coding)
- **brief**: Short bullet summary with citations (research)
- **decision_log**: Chronological decision ledger (troubleshooting)
- **code_delta**: File-level changes summary (coding sessions)

## Observability

### Ariadne Integration

Compaction events are exported as structured spans to Ariadne Trace Viewer:

1. **compact.token_estimate** - Token usage before compaction
2. **compact.trigger_decision** - Compaction trigger/skip decision
3. **compact.summary_created** - Summary content + token count
4. **compact.pruned_messages** - Pruning details
5. **compact.error** - Failure modes

View in Ariadne at `http://localhost:5173` with API running on `:5175`.

### Console Logging

By default, events are logged to stderr:

```json
[Compaction] {"type": "compact.token_estimate", "properties": {...}}
```

## Testing

```bash
# Run all tests
pytest

# With coverage
pytest --cov=compact --cov-report=html

# Run specific test file
pytest tests/test_policy.py

# Run with verbose output
pytest -v
```

### Test Coverage

- Unit tests: Token estimation, partitioning, policy enforcement
- Golden fixtures: Deterministic summarization tests
- Property tests: Invariants (protected items never pruned)
- Integration tests: Ariadne exporter with mock API

## Architecture

### Components

- **Estimators**: Token counting via `tiktoken`
- **Policy**: Message partitioning (pinned, recent, tool I/O, remainder)
- **Summarizer**: LLM-based few-shot summarization
- **Manager**: Orchestrates pre-flight checks and compaction
- **Exporters**: Console (default), Ariadne HTTP, OTLP (future)
- **Adapters**: Filesystem (default), S3 (optional)
- **Config**: YAML + environment variable overrides

### Data Flow

```
Messages → Estimate Tokens → Check Trigger
  ↓ (triggered)
  Partition (pinned/recent/tool_io/remainder)
  ↓
  Summarize Remainder → Prune Messages
  ↓
  Emit Telemetry → Export (console/Ariadne)
  ↓
  Compacted Messages
```

## Security

- **Redaction by default**: API keys, passwords, tokens masked before export
- **Configurable patterns**: Add custom redaction rules in config
- **Protected memory**: Explicit controls over what's never pruned
- **Encryption support**: S3 adapter supports KMS

## Production Readiness

- ✅ >85% test coverage
- ✅ Non-blocking telemetry (timeout ≤2s)
- ✅ Graceful error handling (fallback to pruning-only)
- ✅ Deterministic testing with seeded summarization
- ✅ Configurable redaction and archival
- ✅ Full instrumentation for observability

## Troubleshooting

### "Protected memory exceeds budget"

Reduce the number of protected messages or increase `max_context_tokens`.

```python
# Instead of many protected messages:
policy_msgs = [msg1, msg2, msg3]  # Too many

# Consolidate into one:
combined_policy = mark_protected(
    f"{msg1.content}\n{msg2.content}\n{msg3.content}",
    label="Combined Policy"
)
```

### "Summarization failed"

Summarizer falls back to pruning-only. Check:

1. OPENAI_API_KEY is set
2. Model quota not exhausted
3. Network connectivity

### Messages not appearing in Ariadne

1. Verify Ariadne running on port 5175: `curl http://localhost:5175/healthz`
2. Check CORS: Ariadne should allow POST to `/ingest`
3. Review stderr logs: `[Compaction]` prefix shows exporter errors

## Development

### Install dev dependencies

```bash
pip install -e ".[dev]"
```

### Run linter

```bash
ruff check . --fix
```

### Type checking

```bash
mypy compact --strict
```

### Building

```bash
pip install build
python -m build
```

## Contributing

1. Add tests for new features
2. Ensure ≥85% coverage: `pytest --cov=compact`
3. Type-check: `mypy compact --strict`
4. Lint: `ruff check .`

## License

MIT - See LICENSE file

## References

- [Ariadne Trace Viewer](https://github.com/ThomasRohde/ariadne)
- [OpenAI Agents SDK](https://github.com/openai/agents-sdk)
- [tiktoken](https://github.com/openai/tiktoken)
