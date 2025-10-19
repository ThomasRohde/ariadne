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

### Prerequisites

- Python 3.11+
- `uv` package manager ([install here](https://docs.astral.sh/uv/getting-started/installation/))
- OpenAI API key

### Installation with uv

```bash
# Create and activate virtual environment
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install dependencies
uv pip install -e .

# Install with dev tools (testing, linting)
uv pip install -e ".[dev]"
```

### Traditional pip Installation

If you prefer `pip`:

```bash
python -m venv .venv
source .venv/bin/activate

pip install -e .
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

### Set Up Environment

```bash
# Copy example configuration
cp .env.example .env

# Edit .env with your OpenAI API key
export OPENAI_API_KEY=sk-...

# Optional: Configure Ariadne integration
export COMPACT_ARIADNE_URL=http://localhost:5175/ingest
export COMPACT_TELEMETRY_ENABLED=true
```

### Run Examples

```bash
# Activate virtual environment (if needed)
source .venv/bin/activate

# Run minimal example
python examples/minimal.py
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

## Advanced Usage

### Custom Summarization Strategy

```python
from compact import CompactManager, CompactConfig, CompactPolicy
from compact.summarizer import Summarizer

# Use cheaper model for summarization
policy = CompactPolicy(strategy="brief")
config = CompactConfig(
    model="gpt-4",
    policy=policy
)

# Create manager with custom summarizer
custom_summarizer = Summarizer(model="gpt-3.5-turbo")
manager = CompactManager(config=config, summarizer=custom_summarizer)
```

### Manual Compaction with Storage

```python
from compact import CompactManager
from compact.adapters import FileStorageAdapter
from compact.exporters import AriadneExporter

# Setup storage and exporter
storage = FileStorageAdapter(
    base_path=".compact/archive",
    redaction_patterns=[r'(?i)token\s*[:=]\s*\S+']
)

exporter = AriadneExporter(
    ariadne_url="http://localhost:5175/ingest",
    trace_id="session-001"
)

# Manually trigger compaction
manager = CompactManager(exporter=exporter)
result = manager.manual_compact("session-001", messages, note="user_requested")

# Archive results
storage.save_transcript("session-001", messages, step=1)
if result.summary:
    storage.save_summary("session-001", result.summary, step=1)

print(f"Compaction reduced {result.tokens_before} → {result.tokens_after} tokens")
```

### Protected Memory Management

```python
from compact import mark_protected, Message

# Create reusable policy library
POLICIES = {
    "security": mark_protected(
        """SECURITY POLICY:
- Do not output credentials, API keys, or secrets
- Always verify file paths are within project root
- Never execute untrusted code""",
        label="Security Policy"
    ),
    "scope": mark_protected(
        """PROJECT SCOPE:
- Refactor authentication module in src/auth/
        - Migrate from session-based to JWT tokens
        - Update all tests
        - Leave API contracts unchanged""",
        label="Project Scope"
    ),
    "constraints": mark_protected(
        """CONSTRAINTS:
- Python 3.11+ only
- No new dependencies without approval
- Maintain 100% test coverage
- Deploy via CI/CD only""",
        label="Technical Constraints"
    ),
}

# Use in session
messages = []
messages.extend([POLICIES["security"], POLICIES["scope"], POLICIES["constraints"]])
# ... rest of conversation ...
```

### Streaming Compaction Events to Observability

```python
import json
from compact import CompactManager
from compact.exporters import ConsoleExporter

class CustomExporter:
    """Export events to external observability platform."""

    def __init__(self, api_endpoint):
        self.api_endpoint = api_endpoint
        self.pending = []

    def emit_event(self, event_type, properties, payload=None):
        event = {
            "type": event_type,
            "properties": properties,
            "payload": payload
        }
        self.pending.append(event)

    def flush(self):
        # Send to external system
        for event in self.pending:
            print(f"[SEND] {json.dumps(event)}")
        self.pending.clear()

manager = CompactManager(exporter=CustomExporter("https://events.example.com"))
```

## CLI Tool

```bash
# Validate configuration
compactctl validate-config --config config.yaml

# Show compaction plan without executing
compactctl dry-run --config config.yaml --messages '[{"role":"user","content":"hi"}]'

# Execute compaction with output
compactctl compact --config config.yaml \
  --messages '[{"role":"user","content":"hi"}]' \
  --output result.json

# Create example configuration
compactctl create-config --output config.yaml
```

## API Documentation

### CompactManager

Main orchestration interface for compaction:

```python
from compact import CompactManager, CompactConfig, CompactPolicy
from compact.exporters import AriadneExporter

# Create with custom configuration
policy = CompactPolicy(
    trigger_pct=0.85,
    keep_recent_turns=6,
    strategy="task_state"
)
config = CompactConfig(
    model="gpt-4",
    max_context_tokens=128000,
    policy=policy
)
exporter = AriadneExporter()
manager = CompactManager(config=config, exporter=exporter)

# Main entry point (called from before_model_call hook)
compacted_messages = manager.preflight(
    session_id="session-001",
    messages=messages,           # List[Message] or List[dict]
    tools=tools,                 # Optional tool definitions
    system_prompt=system_text,   # Optional system prompt
)

# Manual trigger with full result
result = manager.manual_compact(
    session_id="session-001",
    messages=messages,
    note="user requested"        # Reason for compaction
)

# Result object contains:
print(f"Before: {result.tokens_before}, After: {result.tokens_after}")
print(f"Reduction: {result.tokens_before - result.tokens_after} tokens")
print(f"Pruned: {result.pruned_count} messages")
print(f"Kept: pinned={result.kept['pinned']}, recent={result.kept['recent']}")
```

### Protected Memory

Mark critical messages that must never be pruned:

```python
from compact import mark_protected, Message

# Helper function (recommended)
policy = mark_protected(
    "POLICY: Always verify before deploying",
    label="Deployment Policy"
)

# Direct creation
constraint = Message(
    role="developer",
    content="Critical constraint: No production changes",
    meta={
        "protected": True,
        "label": "Critical Constraint",
        "priority": "high"
    }
)

# System roles are auto-protected
system_msg = Message(
    role="system",
    content="You are a helpful coding assistant"
)  # ← Always preserved

# Add to message list
messages = []
messages.append(policy)
messages.append(constraint)
# ... rest of messages ...
```

### Summarization Strategies

Four built-in strategies, configured via `CompactPolicy.strategy`:

| Strategy | Best For | Output |
|----------|----------|--------|
| **task_state** | Coding, development | Goals, entities, constraints, decisions, blockers |
| **brief** | Research, exploration | Short bullets, key citations, current status |
| **decision_log** | Troubleshooting, debugging | Chronological decisions with rationale |
| **code_delta** | Code review, refactoring | File changes, functions touched, reasoning |

```python
from compact import CompactPolicy

# Switch strategies
brief_policy = CompactPolicy(strategy="brief")
decision_policy = CompactPolicy(strategy="decision_log")
code_policy = CompactPolicy(strategy="code_delta")
```

### Configuration Loading

```python
from compact.config import ConfigLoader

# Load from YAML + environment
config = ConfigLoader.load(
    config_path="config.yaml",
    merge_env=True  # Override with env vars
)

# Load from environment only
config = ConfigLoader.load(merge_env=True)

# Create example config
from compact.config import create_example_config
create_example_config("config.yaml")
```

## Observability

### Ariadne Integration

Compaction events are exported as structured spans to Ariadne Trace Viewer for real-time visibility:

#### Event Types

1. **compact.token_estimate**
   - Fired: Before every compaction check
   - Data: Total tokens, breakdown (system/messages/tools), usage %
   - Use: Monitor context growth over time

2. **compact.trigger_decision**
   - Fired: When compaction is evaluated
   - Data: Trigger reason, policy applied, usage %
   - Use: Understand why compaction happened

3. **compact.summary_created**
   - Fired: After successful summarization
   - Data: Summary text, token count, compression ratio
   - Use: Review summary quality, adjust strategy if needed

4. **compact.pruned_messages**
   - Fired: After pruning
   - Data: Count pruned, kept counts by layer, token reduction %
   - Use: Track message retention patterns

5. **compact.error**
   - Fired: On failures (insufficient budget, API errors)
   - Data: Error type, message, fallback action
   - Use: Debug issues and monitor reliability

#### Viewing Events

```bash
# Start Ariadne viewer
cd /path/to/ariadne
pnpm dev

# View at http://localhost:5173
# API endpoint: http://localhost:5175/ingest
```

Events appear in the trace tree with:
- Hierarchical spans showing compaction flow
- Timeline visualization with durations
- Inspector tabs showing full event payloads
- Privacy controls for sensitive data

#### Exporting Events Manually

```python
from compact.exporters import AriadneExporter, ConsoleExporter

# Export to Ariadne
ariadne_exp = AriadneExporter(
    ariadne_url="http://localhost:5175/ingest",
    timeout=2.0  # Never blocks longer than 2 seconds
)

# Export to console (stderr)
console_exp = ConsoleExporter(prefix="[MyApp]")

manager = CompactManager(exporter=console_exp)
```

### Console Logging

Events logged to stderr in JSON format:

```json
[Compaction] {"type": "compact.token_estimate", "properties": {"model": "gpt-4", "t_est": 112345, "usage_pct": 0.877}}
[Compaction] {"type": "compact.trigger_decision", "properties": {"triggered": true, "reason": "usage_pct >= trigger_pct"}}
```

Redirect to file:

```bash
python my_agent.py 2> compaction.log

# Monitor in real-time
tail -f compaction.log
```

### Metrics & Monitoring

Key metrics to track:

```python
# Tokens saved per session
tokens_saved = result.tokens_before - result.tokens_after

# Compression ratio
ratio = result.tokens_after / result.tokens_before

# Pruning effectiveness
pruned_pct = result.pruned_count / len(original_messages) * 100

# Message retention
kept_pct = 100 - pruned_pct
```

Example dashboard query:
```
SELECT
  session_id,
  COUNT(*) as compactions,
  AVG(tokens_before) as avg_before,
  AVG(tokens_after) as avg_after,
  AVG((tokens_before - tokens_after) / tokens_before) as avg_compression
FROM compaction_events
WHERE event_type = "compact.pruned_messages"
GROUP BY session_id
```

## Testing

### Running Tests with uv

```bash
# Run all tests
uv run pytest

# Run with verbose output
uv run pytest -v

# Run specific test file
uv run pytest tests/test_policy.py

# Run specific test function
uv run pytest tests/test_policy.py::TestMessagePartitioner::test_partition_protected_flag

# Stop on first failure (useful for debugging)
uv run pytest -x
```

### Coverage Reports

```bash
# Generate HTML coverage report
uv run pytest --cov=compact --cov-report=html

# View report
open htmlcov/index.html  # macOS/Linux
# or
start htmlcov/index.html  # Windows

# Coverage in terminal
uv run pytest --cov=compact --cov-report=term-missing

# Require minimum coverage
uv run pytest --cov=compact --cov-fail-under=85
```

### Test Organization

```
tests/
├── test_types.py          # Type system validation
├── test_estimators.py     # Token estimation accuracy
├── test_policy.py         # Message partitioning logic
├── conftest.py            # Pytest fixtures
└── fixtures/
    └── golden_summaries/  # Deterministic test fixtures
```

### Writing Tests

```python
# tests/test_my_feature.py
import pytest
from compact import CompactManager, CompactPolicy

@pytest.fixture
def my_manager():
    """Create a manager for testing."""
    return CompactManager()

def test_my_feature(my_manager):
    """Test description."""
    result = my_manager.manual_compact("session-1", [])
    assert result.tokens_after >= 0
```

### Property-Based Testing

```bash
# Install hypothesis for property-based tests
uv pip install hypothesis

# Run property tests
uv run pytest tests/ -m property_based
```

### Performance Benchmarks

```python
# tests/test_performance.py
import pytest
from compact import CompactManager, Message

@pytest.mark.benchmark
def test_partition_performance(benchmark):
    """Benchmark message partitioning."""
    manager = CompactManager()
    messages = [Message("user", f"Message {i}") for i in range(1000)]

    def run():
        return manager.partitioner.partition(messages)

    result = benchmark(run)
    assert result is not None
```

Run benchmarks:
```bash
uv run pytest tests/ --benchmark-only
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

### Install dev dependencies with uv

```bash
# Install development dependencies
uv pip install -e ".[dev]"

# Or sync entire environment with lock file
uv sync --all-extras
```

### Run tests

```bash
# Run all tests
uv run pytest

# Run with coverage report
uv run pytest --cov=compact --cov-report=html

# Run specific test file
uv run pytest tests/test_policy.py -v

# Run with verbose output and stop on first failure
uv run pytest -x -v
```

### Type checking

```bash
# Check types with strict mode
uv run mypy compact --strict

# Check specific module
uv run mypy compact/manager.py
```

### Linting and formatting

```bash
# Check code style
uv run ruff check .

# Auto-fix issues
uv run ruff check . --fix

# Format code
uv run ruff format .
```

### Building and packaging

```bash
# Build distribution
uv run pip install build
uv run python -m build

# Check package contents
tar -tzf dist/ariadne-compaction-0.1.0.tar.gz
```

## Contributing

1. **Write tests first**: Add tests in `tests/` directory before implementing features
2. **Ensure coverage**: Run `pytest --cov=compact` and maintain ≥85% coverage
3. **Type-check**: Always run `mypy compact --strict` before committing
4. **Lint**: Fix all issues with `ruff check . --fix`
5. **Document**: Update README and docstrings for public APIs
6. **Commit**: Use clear, descriptive commit messages

### Development Workflow

```bash
# Create feature branch
git checkout -b feature/my-feature

# Make changes
# ... edit files ...

# Run checks
uv run pytest
uv run mypy compact --strict
uv run ruff check . --fix

# Commit
git add .
git commit -m "feat: add my-feature"

# Push
git push origin feature/my-feature
```

## License

MIT - See LICENSE file

## Real-World Examples

### Example 1: Coding Assistant with Context Management

```python
from openai_agents import Agent, Runner
from compact import CompactManager, mark_protected
from compact.hooks import create_before_model_call_hook

# Define coding assistant
assistant = Agent(
    name="CodeAssistant",
    instructions="""You are a Python coding assistant.
    Help users with:
    - Writing and debugging code
    - Refactoring and optimization
    - Testing and documentation"""
)

# Set up compaction with protective policies
compaction_manager = CompactManager()

CODING_POLICIES = [
    mark_protected(
        """CODING STANDARDS:
- Follow PEP 8
- Type hints required for all functions
- Minimum 80% test coverage
- No imports at module level without justification""",
        label="Coding Standards"
    ),
    mark_protected(
        """CONSTRAINTS:
- Never modify production code without explicit approval
- Test all changes before suggesting
- Document breaking changes
- Only Python 3.9+""",
        label="Project Constraints"
    ),
]

# Initialize runner with compaction
runner = Runner(
    assistant,
    hooks={
        "before_model_call": create_before_model_call_hook(compaction_manager)
    }
)

# Use in conversation
messages = CODING_POLICIES + [
    {"role": "user", "content": "Help me refactor this authentication module"}
]

response = runner.run(messages)
print(response)
```

### Example 2: Research Session with Automatic Archival

```python
from compact import CompactManager, CompactConfig, CompactPolicy
from compact.adapters import FileStorageAdapter
from compact.exporters import AriadneExporter

# Configure for research session
research_policy = CompactPolicy(
    strategy="brief",  # Short bullets with citations
    trigger_pct=0.90,  # Allow more context growth
    keep_recent_turns=10,  # Keep more recent interactions
)

config = CompactConfig(
    model="gpt-4",
    max_context_tokens=128000,
    policy=research_policy
)

# Setup storage
storage = FileStorageAdapter(base_path=".compact/research_sessions")

# Setup tracing
tracer = AriadneExporter(trace_id="research-session-001")

# Create manager
manager = CompactManager(config=config, exporter=tracer)

# Long research session
session_id = "research-001"
messages = [...]

# Each model call checks for compaction
while True:
    # Preflight check
    compacted = manager.preflight(session_id, messages)

    # Get model response
    response = agent.run(compacted)
    messages.append({"role": "assistant", "content": response})

    # Check if we should manually save
    if len(messages) % 50 == 0:
        # Archive current session
        storage.save_transcript(session_id, messages)
        print(f"✓ Archived session at {len(messages)} messages")
```

### Example 3: Production Agent with Monitoring

```python
import json
from datetime import datetime
from compact import CompactManager, CompactConfig
from compact.exporters import ConsoleExporter

class MonitoringExporter:
    """Export compaction events with detailed monitoring."""

    def __init__(self):
        self.events = []
        self.metrics = {}

    def emit_event(self, event_type, properties, payload=None):
        event = {
            "timestamp": datetime.utcnow().isoformat(),
            "type": event_type,
            "properties": properties,
            "payload": payload
        }
        self.events.append(event)

        # Track metrics
        if event_type == "compact.pruned_messages":
            reduction = properties.get("reduction_pct", 0)
            pruned = properties.get("pruned_count", 0)

            self.metrics.setdefault("total_pruned", 0)
            self.metrics["total_pruned"] += pruned

            self.metrics.setdefault("total_reductions", []).append(reduction)

            avg_reduction = sum(self.metrics["total_reductions"]) / len(
                self.metrics["total_reductions"]
            )
            print(f"Compaction: {pruned} messages pruned ({reduction:.1f}% reduction)")
            print(f"Average reduction: {avg_reduction:.1f}%")

    def flush(self):
        # Send to monitoring system
        for event in self.events:
            # In production, send to Datadog, Prometheus, etc.
            print(json.dumps(event, indent=2))
        self.events.clear()

# Use in production
monitor = MonitoringExporter()
config = CompactConfig()
manager = CompactManager(config=config, exporter=monitor)

# Run agent loop
while True:
    messages = get_session_messages()
    compacted = manager.preflight("prod-session", messages)
    response = agent.run(compacted)
    messages.append(response)
```

### Example 4: Handling Summarization Failures

```python
from compact import CompactManager, SummarizationError
import logging

logger = logging.getLogger(__name__)

manager = CompactManager()

try:
    result = manager.manual_compact("session-001", messages)

    if result.was_triggered:
        if result.summary:
            logger.info(f"Summary created: {len(result.summary.content)} chars")
        else:
            logger.warning("Compaction completed without summary (pruning-only fallback)")

        logger.info(f"Token reduction: {result.tokens_before} → {result.tokens_after}")

except SummarizationError as e:
    logger.error(f"Summarization failed: {e}")
    # Compaction was skipped, proceed with original messages
    result = None

except Exception as e:
    logger.error(f"Unexpected error: {e}", exc_info=True)
    result = None

# Continue with result or original messages
final_messages = result.messages if result else messages
```

## FAQ

**Q: How do I know if compaction is helping?**
A: Monitor metrics in Ariadne or your observability platform:
- Average tokens before/after compaction
- Message pruning rate
- Summary compression ratio
- Session success rate (should stay >95%)

**Q: Can I disable compaction for specific sessions?**
A: Yes, don't call `preflight()` for that session:
```python
if session_id in exempt_sessions:
    compacted = messages
else:
    compacted = manager.preflight(session_id, messages)
```

**Q: What if protected memory exceeds budget?**
A: Reduce protected messages or increase `max_context_tokens`. Compaction will error with guidance.

**Q: How do I handle different model context windows?**
A: Set `max_context_tokens` per model:
```python
config = CompactConfig(
    model="gpt-3.5-turbo",
    max_context_tokens=4096,  # Smaller window
)
```

**Q: Can I use a different summarization model?**
A: Yes, pass custom summarizer:
```python
from compact.summarizer import Summarizer

cheaper_summarizer = Summarizer(model="gpt-3.5-turbo")
manager = CompactManager(summarizer=cheaper_summarizer)
```

## References

- [Ariadne Trace Viewer](https://github.com/ThomasRohde/ariadne)
- [OpenAI Agents SDK](https://github.com/openai/agents-sdk)
- [tiktoken Documentation](https://github.com/openai/tiktoken)
- [Context Window Management Patterns](https://openai.com/research)
- [Token Accounting Best Practices](https://platform.openai.com/docs/guides/tokens)
