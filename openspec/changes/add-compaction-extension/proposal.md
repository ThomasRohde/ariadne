# Compaction Extension Proposal

## Why

Long-running OpenAI agent sessions (coding assistants, deep research, troubleshooting, multi-step workflows) accumulate conversation history until they hit model context limits. Without proactive management, runs fail or degrade. We need a **production-ready, observable compaction extension** that:

- Monitors token usage per-run/per-session
- Triggers **deterministic compaction** (summarization + pruning) before limits are hit
- Preserves **critical facts** (protected memory) while discarding low-signal history
- Emits **rich tracing telemetry** for observability via Ariadne Trace Viewer
- Provides portable, SDK-agnostic implementation with OpenAI Agents SDK integration

This addresses a critical gap in agent reliability: context exhaustion is a common failure mode that currently requires manual intervention or session restarts, losing valuable accumulated context.

## What Changes

This proposal adds a complete auto-compaction system as a **demonstrator example** in `examples/compaction/`:

### Core Components
- **Token Budget Monitoring**: Pluggable token estimator (tiktoken-compatible) with live accounting for system prompts, tools, memory, and history
- **Compaction Manager**: Orchestrates pre-flight token checks, trigger decisions, and compaction execution
- **Summarization Engine**: Built-in strategies (task-state, brief, decision-log, code-delta) with few-shot prompt templates
- **Protected Memory**: Taggable items that never get compacted (policies, constraints, requirements)
- **History Pruning**: FIFO, recency-biased, and stage-aware policies (e.g., keep last N tool I/O pairs)
- **Storage Adapters**: Pluggable archival (filesystem, S3) with redaction hooks
- **Tracing Integration**: **First-class OpenAI SDK tracing** with structured span events exported to Ariadne

### Configuration & API
- YAML/JSON config with sensible defaults
- Python API: `CompactManager`, `CompactPolicy`, `CompactConfig`
- Middleware hooks for OpenAI Agents SDK: `before_model_call`, `after_model_call`
- Manual trigger command: `/compact`

### Observability (Ariadne Integration)
- Structured trace events: `compact.token_estimate`, `compact.trigger_decision`, `compact.summary_created`, `compact.pruned_messages`
- HTTP exporter to Ariadne viewer for real-time compaction telemetry
- Timeline visualization of compaction events within agent runs
- Payload inspection (summaries, policy decisions, token counts)

### Testing & Documentation
- Unit tests with golden summary fixtures
- Property tests (invariants like "protected items never pruned")
- Soak tests (1k runs, no context-limit errors)
- Integration example: coding assistant with compaction enabled
- Security tests (redaction, no secret leaks)

## Impact

- **Affected specs**: `compaction` (new capability)
- **Affected code**:
  - `examples/compaction/` - Full Python implementation (new)
  - `examples/compaction/compact/` - Core package modules (new)
  - `examples/compaction/examples/` - Integration demos (new)
  - `examples/compaction/tests/` - Comprehensive test suite (new)
  - `examples/compaction/docs/` - User documentation (new)
  - Integration with existing Ariadne HTTP exporter pattern from `examples/python-openai-agents/`

- **Dependencies**:
  - `tiktoken` (token estimation)
  - `pyyaml` (config parsing)
  - `openai` (Agents SDK integration, optional hydration)
  - `openai-agents` (OpenAI Agents SDK)
  - `python-dotenv` (environment configuration)
  - `httpx` or `requests` (HTTP client for Ariadne exporter)
  - Ariadne backend (POST /ingest for trace telemetry)

- **Development Tools**:
  - `uv` package manager (following Ariadne project conventions)
  - `pytest` (testing framework)
  - `pytest-cov` (coverage reporting)
  - `ruff` (linting and formatting)
  - `mypy` (type checking)
  - Python 3.11+ (required for OpenAI Agents SDK)

- **Non-breaking**: This is a **new, standalone example** with zero impact on existing Ariadne viewer functionality
- **Production-ready**: Includes all operational concerns (redaction, archival, failure modes, observability)

## Success Criteria

- ✅ Sessions exceeding 75% context window remain stable through compaction (>95% success in soak tests)
- ✅ Zero hard context-limit exceptions in synthetic long-history tests
- ✅ Summaries retain >90% of key entities/constraints (eval rubric)
- ✅ Compaction telemetry appears in Ariadne viewer within <200ms of decision point
- ✅ Single-file config enablement in <10 LOC
- ✅ Comprehensive test coverage (≥85%) with passing `pytest`

## Migration Plan

N/A - New capability, no migration required.

## Rollout Plan

- **v0.1 (Prototype)**: Minimal policy, console exporter, filesystem storage, basic tracing
- **v0.2**: Ariadne HTTP exporter, deterministic prompts, golden summary tests
- **v0.3**: Advanced pruning policies, semantic clustering (optional), S3 adapter
- **v1.0**: Production-ready, full docs, API freeze, comprehensive observability
