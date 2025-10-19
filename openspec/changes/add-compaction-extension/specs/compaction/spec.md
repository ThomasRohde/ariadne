# Compaction Capability Specification

## ADDED Requirements

### Requirement: Token Budget Monitoring

The system SHALL provide real-time token usage estimation for agent conversation sessions including system prompts, developer messages, tools schemas, conversation history, and user input.

#### Scenario: Accurate token estimation using tiktoken

- **WHEN** a conversation contains 10 user messages, 10 assistant responses, 5 tool calls, a system prompt, and a developer message
- **THEN** the system SHALL estimate total tokens using tiktoken with model-specific encoding
- **AND** the estimate SHALL include system prompt tokens, developer message tokens, tools schema tokens, and all message content tokens
- **AND** the estimation overhead SHALL be less than 10 milliseconds per batch

#### Scenario: Budget calculation with buffer reserve

- **WHEN** the model has a max context of 128,000 tokens and hard_cap_buffer is configured as 1,500 tokens
- **THEN** the available budget SHALL be calculated as 126,500 tokens (max - buffer)
- **AND** the buffer SHALL be reserved for the next user input and tool responses

---

### Requirement: Compaction Trigger Thresholds

The system SHALL automatically trigger compaction when estimated token usage exceeds a configurable percentage threshold of the maximum context window.

#### Scenario: Automatic trigger at 85% threshold

- **WHEN** estimated token usage reaches 108,800 tokens (85% of 128,000)
- **AND** the trigger_pct policy is set to 0.85
- **THEN** the system SHALL trigger compaction before the next model call
- **AND** a `compact.trigger_decision` trace event SHALL be emitted with triggered=true

#### Scenario: No trigger below threshold

- **WHEN** estimated token usage is 96,000 tokens (75% of 128,000)
- **AND** the trigger_pct policy is set to 0.85
- **THEN** the system SHALL NOT trigger compaction
- **AND** a `compact.trigger_decision` trace event SHALL be emitted with triggered=false

---

### Requirement: Manual Compaction Command

The system SHALL support explicit manual compaction via a programmatic API independent of automatic trigger thresholds.

#### Scenario: Manual compaction via API

- **WHEN** a developer calls `manager.manual_compact(session_id, messages, note="user-requested")`
- **THEN** the system SHALL execute compaction regardless of current token usage
- **AND** a trace event SHALL include the manual trigger note
- **AND** the compacted messages SHALL be returned

---

### Requirement: Summarization Strategies

The system SHALL support multiple built-in summarization strategies with few-shot prompt templates optimized for different agent workflows.

#### Scenario: Task-state summarization for coding sessions

- **WHEN** compaction is triggered with strategy="task_state"
- **THEN** the system SHALL generate a summary extracting:
  - Goals and success criteria
  - Key entities, identifiers, filenames, branches, environments
  - Constraints (security, compliance, SLAs, budgets)
  - Decisions taken with rationale
  - Outstanding actions and blockers
  - Source citations
- **AND** the summary SHALL be deterministic when using a fixed seed and temperature=0

#### Scenario: Decision-log summarization for troubleshooting

- **WHEN** compaction is triggered with strategy="decision_log"
- **THEN** the system SHALL generate a chronological decision ledger in the format:
  - [step_id] decision :: rationale :: inputs (brief) :: outputs (brief)
- **AND** the ledger SHALL maintain chronological ordering
- **AND** no details SHALL be invented beyond the input messages

#### Scenario: Code-delta summarization for code changes

- **WHEN** compaction is triggered with strategy="code_delta"
- **THEN** the system SHALL generate a summary of code modifications as diff-like bullets:
  - file_path: summary of changes (functions, APIs touched, side effects)
- **AND** the summary SHALL focus on what changed, why, and follow-up actions

---

### Requirement: Protected Memory

The system SHALL preserve messages marked as protected from all compaction and pruning operations.

#### Scenario: Protected message never pruned

- **WHEN** a message has `meta["protected"] = True`
- **AND** compaction is triggered
- **THEN** the message SHALL remain in the output messages unchanged
- **AND** the message SHALL NOT be included in the summarization input (remainder)

#### Scenario: Role-based protection

- **WHEN** a message has `role="system"` or `role="developer"`
- **AND** the policy includes these roles in `roles_never_prune`
- **THEN** the message SHALL remain in the output messages unchanged
- **AND** the message SHALL NOT be pruned even if compaction is triggered

#### Scenario: Budget exhaustion with protected-only messages

- **WHEN** protected messages alone exceed the available budget
- **THEN** the system SHALL raise `CompactError(InsufficientBudget)`
- **AND** a `compact.error` trace event SHALL be emitted
- **AND** the error message SHALL include guidance to reduce protected memory or increase model context limit

---

### Requirement: History Pruning Policies

The system SHALL support configurable pruning policies to retain recent conversation turns and tool I/O pairs while summarizing older content.

#### Scenario: Keep recent turns policy

- **WHEN** the policy specifies `keep_recent_turns=6`
- **AND** there are 20 user/assistant message pairs
- **THEN** the last 6 pairs SHALL be kept unchanged
- **AND** the older 14 pairs SHALL be eligible for summarization

#### Scenario: Keep tool I/O pairs policy

- **WHEN** the policy specifies `keep_tool_io_pairs=4`
- **AND** there are 10 tool call + tool output pairs
- **THEN** the last 4 pairs SHALL be kept unchanged
- **AND** the older 6 pairs SHALL be eligible for summarization

#### Scenario: Incremental reduction on budget overflow

- **WHEN** protected + recent + tool I/O messages exceed the budget after summarization
- **THEN** the system SHALL incrementally reduce `keep_recent_turns` by 1
- **AND** if still over budget, SHALL reduce `keep_tool_io_pairs` by 1
- **AND** SHALL repeat until under budget or both counts reach 1
- **AND** if still over budget at floor (1, 1), SHALL raise `CompactError(InsufficientBudget)`

---

### Requirement: Memory Layers

The system SHALL organize conversation context into three conceptual layers: Pinned Protected, Session Summary, and Ephemeral Recent.

#### Scenario: Three-layer output structure

- **WHEN** compaction completes successfully
- **THEN** the output messages SHALL be ordered as:
  1. Pinned Protected messages (system, developer, protected-flagged)
  2. Session Summary (single assistant message with `<COMPACT-SUMMARY vN>` prefix)
  3. Ephemeral Recent messages (recent turns + tool I/O)
- **AND** the layer breakdown SHALL be logged in the `compact.pruned_messages` trace event

#### Scenario: Rolling session summary replacement

- **WHEN** a second compaction is triggered in the same session
- **THEN** the previous `<COMPACT-SUMMARY>` message SHALL be included in the remainder for re-summarization
- **AND** the new summary SHALL incorporate the previous summary's key facts
- **AND** only one `<COMPACT-SUMMARY>` message SHALL exist in the output

---

### Requirement: Observability via Tracing

The system SHALL emit structured trace events at all compaction decision points using OpenAI Agents SDK tracing primitives.

#### Scenario: Token estimate event

- **WHEN** the preflight hook estimates token usage
- **THEN** a `compact.token_estimate` span event SHALL be emitted
- **AND** the event SHALL include properties: model, t_est, max_tokens, usage_pct, breakdown (system, developer, tools_schema, messages)
- **AND** the event SHALL be exported to Ariadne within 200ms

#### Scenario: Trigger decision event

- **WHEN** the system evaluates whether to trigger compaction
- **THEN** a `compact.trigger_decision` span event SHALL be emitted
- **AND** the event SHALL include properties: triggered (boolean), reason, policy (trigger_pct, hard_cap_buffer, strategy)
- **AND** if triggered=true, the event SHALL include kept counts (pinned, recent_turns, tool_pairs) and pruned_count

#### Scenario: Summary created event

- **WHEN** summarization completes successfully
- **THEN** a `compact.summary_created` span event SHALL be emitted
- **AND** the event SHALL include properties: strategy, input_messages, summary_tokens, compression_ratio
- **AND** the payload SHALL contain the summary content (JSON-encoded)

#### Scenario: Error event on failure

- **WHEN** compaction fails due to budget exhaustion or summarization error
- **THEN** a `compact.error` span event SHALL be emitted with status="error"
- **AND** the event SHALL include properties: error_type, message, fallback (action taken)

---

### Requirement: Ariadne Trace Viewer Integration

The system SHALL export compaction trace events to Ariadne Trace Viewer via HTTP POST to the `/ingest` endpoint.

#### Scenario: Non-blocking HTTP export

- **WHEN** a trace event is emitted
- **THEN** the system SHALL POST the event to Ariadne's `/ingest` endpoint
- **AND** the request timeout SHALL be less than or equal to 2 seconds
- **AND** the export SHALL NOT block the agent's main execution loop
- **AND** export failures SHALL be logged to stderr with `[Ariadne]` prefix but SHALL NOT raise exceptions

#### Scenario: Timeline visualization in Ariadne UI

- **WHEN** compaction events are ingested by Ariadne
- **THEN** the events SHALL appear as distinct spans in the trace tree
- **AND** duration bars SHALL visualize summarization latency
- **AND** the inspector SHALL reveal summary content, policy decisions, and token counts via the payload

---

### Requirement: Archival Storage

The system SHALL persist full conversation transcripts and compaction summaries via pluggable storage adapters before pruning.

#### Scenario: Filesystem storage adapter

- **WHEN** compaction is triggered with storage adapter="fs"
- **THEN** the system SHALL save the pre-compaction full transcript to `.compact/archive/{session_id}/transcript-pre-compact-{step:03d}.jsonl`
- **AND** SHALL save the compaction summary to `.compact/archive/{session_id}/summary-{step:03d}.json`
- **AND** SHALL save all trace events to `.compact/archive/{session_id}/events.jsonl`

#### Scenario: S3 storage adapter with encryption

- **WHEN** compaction is triggered with storage adapter="s3"
- **THEN** the system SHALL upload transcripts and summaries to `s3://{bucket}/{prefix}/{session_id}/`
- **AND** SHALL use KMS encryption if configured
- **AND** SHALL use IAM role-based access (no hardcoded credentials)

#### Scenario: Redaction before archival

- **WHEN** redaction is enabled (default) with regex patterns
- **THEN** the system SHALL apply redaction patterns to all messages before saving
- **AND** patterns SHALL match common secrets: API keys (`(?i)api[_-]?key\s*[:=]\s*\S+`), passwords (`(?i)password\s*[:=]\s*\S+`)
- **AND** redacted content SHALL be replaced with `<REDACTED>`
- **AND** if redaction is disabled, a high-severity warning event SHALL be emitted before export

---

### Requirement: Configuration System

The system SHALL support YAML/JSON configuration files with environment variable overrides and sensible defaults.

#### Scenario: YAML configuration loading

- **WHEN** a config file `compact.yaml` is provided
- **THEN** the system SHALL parse the YAML and validate all fields using Pydantic models
- **AND** validation errors SHALL include clear field paths (e.g., "policy.trigger_pct must be 0.0-1.0")

#### Scenario: Environment variable overrides

- **WHEN** environment variable `COMPACT_TRIGGER_PCT=0.9` is set
- **AND** the config file specifies `policy.trigger_pct: 0.85`
- **THEN** the environment variable SHALL take precedence
- **AND** the effective value SHALL be 0.9

#### Scenario: Sensible defaults

- **WHEN** no configuration is provided
- **THEN** the system SHALL use default values:
  - trigger_pct: 0.85
  - hard_cap_buffer: 1500
  - keep_recent_turns: 6
  - keep_tool_io_pairs: 4
  - roles_never_prune: ["system", "developer"]
  - strategy: "task_state"

---

### Requirement: OpenAI Agents SDK Integration

The system SHALL integrate with OpenAI Agents SDK via middleware hooks without requiring SDK modifications.

#### Scenario: Before-model-call hook integration

- **WHEN** the `before_model_call` middleware hook is executed
- **THEN** the hook SHALL call `manager.preflight(ctx.session_id, ctx.messages)`
- **AND** SHALL replace `ctx.messages` with the compacted messages if compaction was triggered
- **AND** the modified messages SHALL be passed to the model API call

#### Scenario: Minimal enablement (less than 10 lines of code)

- **WHEN** a developer wants to enable compaction
- **THEN** the integration SHALL require fewer than 10 lines of code:
  ```python
  from compact import CompactConfig, CompactManager

  cfg = CompactConfig(model="gpt-4", max_context_tokens=128_000)
  manager = CompactManager(cfg)

  def before_model_call(ctx):
      ctx.messages = manager.preflight(ctx.session_id, ctx.messages)

  runner = Runner(agent, hooks={"before_model_call": before_model_call})
  ```

---

### Requirement: Failure Mode Handling

The system SHALL gracefully handle failures with fallback policies and comprehensive error reporting.

#### Scenario: Summarization API failure fallback

- **WHEN** the summarization API call fails with a network or API error
- **THEN** the system SHALL fallback to pruning-only (no summary inserted)
- **AND** a `compact.error` trace event SHALL be emitted with fallback="pruning-only"
- **AND** the original compaction SHALL still complete by pruning the remainder messages

#### Scenario: Summary exceeds budget retry

- **WHEN** the generated summary exceeds the max_tokens parameter
- **THEN** the system SHALL retry with max_tokens reduced by 50%
- **AND** SHALL retry a maximum of 2 times
- **AND** if still over budget, SHALL fallback to pruning-only

#### Scenario: Model refusal handling

- **WHEN** the model refuses to generate a summary (e.g., content policy violation)
- **THEN** the system SHALL retry with the "brief" strategy
- **AND** if the brief strategy also fails, SHALL fallback to pruning-only
- **AND** all failures SHALL be logged with full context in trace events

---

### Requirement: Security and Redaction

The system SHALL prevent PII and secret leakage via default-enabled redaction applied to all exports and storage operations.

#### Scenario: Default redaction enabled

- **WHEN** a compaction configuration is created without specifying redaction settings
- **THEN** redaction SHALL be enabled by default
- **AND** default regex patterns SHALL match: API keys, passwords, tokens, private keys

#### Scenario: Redaction applied before export

- **WHEN** a message containing an API key (`api_key=sk-abc123`) is exported to Ariadne
- **THEN** the content SHALL be redacted to `api_key=<REDACTED>`
- **AND** the original message SHALL remain unchanged in memory (redaction is copy-on-export)

#### Scenario: Audit logging for all exports

- **WHEN** a transcript is saved via a storage adapter
- **THEN** a trace event SHALL be emitted with event type `compact.archival`
- **AND** the event SHALL include: session_id, step, storage_adapter, file_path/S3_key
- **AND** the event SHALL be persisted in the events.jsonl log

---

### Requirement: Deterministic Testing Support

The system SHALL support deterministic summarization with fixed seeds and temperature controls for reproducible tests.

#### Scenario: Seeded summarization for golden tests

- **WHEN** summarization is invoked with seed=42 and temperature=0
- **THEN** the generated summary SHALL be identical across multiple runs with the same input
- **AND** golden fixture tests SHALL use this configuration to validate summary quality

#### Scenario: Property test invariants

- **WHEN** compaction is run 100 times with random message counts and content
- **THEN** the invariant "protected items never pruned" SHALL hold in all runs
- **AND** the invariant "post-compaction token count <= budget" SHALL hold in all runs

---

### Requirement: Performance and Overhead

The system SHALL maintain compaction overhead below 10% of total wall time for long-running agent sessions.

#### Scenario: Compaction overhead measurement

- **WHEN** a 1,000-turn agent session with 5 compaction rounds is executed
- **THEN** the total compaction time (token estimation + summarization + pruning) SHALL be less than 10% of total session wall time
- **AND** token estimation overhead SHALL be less than 10ms per preflight check

#### Scenario: Non-blocking tracing export

- **WHEN** trace events are exported to Ariadne
- **THEN** the export SHALL NOT block the main agent loop
- **AND** HTTP timeouts SHALL be enforced at 2 seconds
- **AND** failed exports SHALL be logged but SHALL NOT raise exceptions

---

### Requirement: Comprehensive Test Coverage

The system SHALL include unit tests, integration tests, golden summary tests, property tests, soak tests, and security tests with a minimum of 85% line coverage.

#### Scenario: Pytest quality gate

- **WHEN** `pytest` is executed on the compaction package
- **THEN** all tests SHALL pass
- **AND** code coverage SHALL be at least 85%
- **AND** the test suite SHALL include:
  - Unit tests for token estimation, partitioning, policy enforcement
  - Golden summary fixtures with deterministic seeds
  - Property tests for invariants (protected never pruned)
  - Soak tests (1,000 runs, zero context-limit errors)
  - Security tests (redaction applied, no secret leaks)

#### Scenario: Synthetic long-session test

- **WHEN** a synthetic session with 3× the model's context window (384,000 tokens for a 128k model) is executed
- **THEN** the session SHALL complete without `CompactError(InsufficientBudget)` exceptions
- **AND** multiple compaction rounds SHALL be triggered and succeed
- **AND** the final token count SHALL remain below the budget

---

### Requirement: Documentation and Examples

The system SHALL include comprehensive documentation covering architecture, configuration, API reference, security, and observability.

#### Scenario: Quick-start README

- **WHEN** a developer reads the README.md
- **THEN** they SHALL find:
  - Overview and motivation
  - Quick start with minimal example (≤10 LOC)
  - Configuration reference
  - API documentation
  - Link to detailed docs (ARCHITECTURE.md, SECURITY.md, OBSERVABILITY.md)

#### Scenario: Integration examples

- **WHEN** a developer explores the `examples/` directory
- **THEN** they SHALL find at least three examples:
  1. `agents_sdk_minimal.py` - Minimal integration with console exporter
  2. `coding_session.py` - Realistic coding assistant with Ariadne tracing
  3. `long_research.py` - Synthetic long session demonstrating multiple compaction rounds

#### Scenario: Observability documentation

- **WHEN** an operator reads OBSERVABILITY.md
- **THEN** they SHALL find:
  - Complete trace event schema reference
  - Ariadne integration setup guide
  - OTLP configuration (optional)
  - Timeline visualization examples
