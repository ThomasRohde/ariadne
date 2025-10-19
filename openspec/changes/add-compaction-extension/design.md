# Compaction Extension Design

## Context

Long-running OpenAI agent sessions accumulate conversation history that eventually exceeds model context limits (e.g., 128k tokens for GPT-4). Without intervention, this causes:
- Silent degradation (oldest context dropped without summarization)
- Hard failures (requests rejected)
- Loss of critical context (requirements, constraints, decisions)

This design specifies a **production-ready compaction extension** that proactively manages context via deterministic summarization and pruning, with **first-class observability** via Ariadne Trace Viewer.

### Stakeholders
- **Agent developers**: Need reliable, zero-config compaction
- **SREs/operators**: Need observability, audit trails, and failure modes
- **Security teams**: Need redaction, encryption, and compliance

### Constraints
- **Performance**: Compaction overhead <10% wall time
- **Reliability**: >95% success rate in 1k-run soak tests
- **Observability**: <200ms latency for trace events to appear in Ariadne
- **Security**: No PII leaks; redaction by default
- **Compatibility**: Works with OpenAI Agents SDK via middleware hooks
- **Development**: Follows Ariadne project conventions (uv package manager, setuptools build backend, ruff linting, Python 3.11+)

## Goals / Non-Goals

### Goals
1. **Automatic context management**: Trigger compaction before hitting limits (default 85% threshold)
2. **Information preservation**: Retain >90% of key entities/constraints via smart summarization
3. **Rich tracing**: Emit structured span events for Ariadne visualization
4. **Flexible policies**: Support multiple pruning strategies and summarization styles
5. **Production-ready**: Redaction, archival, failure handling, deterministic testing
6. **SDK-agnostic core**: Thin adapter layer for OpenAI Agents SDK (extensible to other frameworks)

### Non-Goals
1. **General knowledge bases**: Not building a RAG pipeline or vector DB
2. **Cross-session reasoning**: No semantic deduplication across sessions (v1)
3. **Vendor-managed storage**: Users provide their own storage backends
4. **Real-time streaming compaction**: Compaction is synchronous per-turn (async is future work)

## Decisions

### 1. Architecture: Middleware Pattern

**Decision**: Implement as **middleware hook** (`before_model_call`) in OpenAI Agents SDK rather than forking the SDK or post-processing.

**Rationale**:
- **Non-invasive**: Zero changes to SDK core; drop-in integration
- **Observability**: Hook execution is already traced by SDK
- **Timing**: Pre-flight execution ensures compacted messages reach the model
- **Fallback**: If compaction fails, can proceed with original messages (graceful degradation)

**Alternatives considered**:
- ❌ **Post-processing**: Too late; request already rejected if over limit
- ❌ **SDK fork**: Maintenance burden; breaks compatibility
- ⚠️ **Client-side proxy**: Adds latency; harder to trace

**Implementation**:
```python
def before_model_call(ctx):
    ctx.messages = manager.preflight(ctx.session_id, ctx.messages)

runner = Runner(agent, hooks={"before_model_call": before_model_call})
```

---

### 2. Token Estimation: tiktoken with Caching

**Decision**: Use `tiktoken` library with per-model encoding, cached at manager initialization.

**Rationale**:
- **Accuracy**: tiktoken uses official OpenAI tokenizers (same as API)
- **Speed**: Encoding cached; <1ms overhead per message batch
- **Compatibility**: Supports all OpenAI models (gpt-4, gpt-3.5, o1, etc.)

**Alternatives considered**:
- ❌ **Heuristic (chars/4)**: Too inaccurate (±20% error)
- ❌ **API call**: Adds 50-100ms latency; requires network
- ⚠️ **Provider-specific estimators**: Future work for non-OpenAI models

**Edge cases**:
- **Tool schemas**: Estimated separately; added to base count
- **System prompts**: Included in budget calculation
- **Truncated payloads**: Warn if input >256KB (same as Ariadne ingestion limit)

---

### 3. Summarization: Few-Shot Prompts with Deterministic Seeds

**Decision**: Use **few-shot prompt templates** with the same model (or a cheaper model if configured) for summarization. Support deterministic seeds for reproducibility.

**Rationale**:
- **Quality**: LLMs excel at extractive summarization with guidance
- **Flexibility**: Templates easily customizable per domain (coding, research, support)
- **Determinism**: Fixed seed + temperature=0 → reproducible summaries for testing
- **Cost control**: Allow fallback to cheaper model (e.g., gpt-3.5) for summarization

**Strategies**:
1. **task_state**: Goals, entities, constraints, decisions, blockers (default for coding)
2. **brief**: Short bullet summary + key citations (default for research)
3. **decision_log**: Chronological decision ledger (default for troubleshooting)
4. **code_delta**: File-level change summary with functions/APIs touched

**Prompt template example** (task_state):
```
You are summarizing a conversation for compaction.
Extract ONLY:
- Goals and success criteria
- Key entities, ids, filenames, branches, environments
- Constraints (security, compliance, SLAs, budgets)
- Decisions taken + rationale
- Outstanding actions / blockers
- Sources/citations (names only)

Output a tight, factual summary (<= {max_tokens} tokens). Do NOT invent details.

--- CONVERSATION HISTORY ---
{remainder_messages}
```

**Failure modes**:
- If summarization fails (API error, refusal): Fallback to **pruning-only** with warning event
- If summary exceeds budget: Retry with shorter max_tokens (50% reduction, max 2 retries)

**Alternatives considered**:
- ❌ **Extractive (keyword-based)**: Loses context; brittle for complex sessions
- ❌ **External summarizer service**: Adds latency and security risk
- ⚠️ **Semantic clustering**: Future work (v0.3) for redundancy detection

---

### 4. Protected Memory: Metadata Tagging

**Decision**: Use **message-level metadata** (`meta["protected"] = True`) to mark items never compacted.

**Rationale**:
- **Explicit**: Developer controls what's critical (policies, requirements, constraints)
- **Flexible**: No magic heuristics; clear semantics
- **Auditable**: Protected items logged in trace events

**Usage**:
```python
messages.append(Message(
    role="developer",
    content=POLICY_TEXT,
    meta={"protected": True, "label": "Security Policy"}
))
```

**Partitioning logic**:
1. **Pinned**: `role in roles_never_prune` OR `meta.get("protected") == True`
2. **Recent**: Last `keep_recent_turns` (assistant/user pairs)
3. **Tool I/O**: Last `keep_tool_io_pairs` (tool call + output)
4. **Remainder**: Eligible for summarization

**Edge cases**:
- If protected items alone exceed budget: Raise `CompactError(InsufficientBudget)` (cannot proceed)
- If protected + recent + tool I/O > budget: Incrementally reduce keep counts (floor = 1)

**Alternatives considered**:
- ❌ **Role-only protection**: Too coarse; can't protect specific user messages
- ❌ **Keyword detection**: Brittle; hard to test

---

### 5. Memory Layers: Three-Tier Model

**Decision**: Organize context into **three conceptual layers** (not separate stores, but logical partitions):

| Layer | Purpose | Lifespan | Example |
|-------|---------|----------|---------|
| **Pinned Protected** | Immutable policies, constraints | Entire session | Security policy, acceptance criteria |
| **Session Summary** | Rolling summary of pruned history | Replaced on compaction | Previous compaction summaries |
| **Ephemeral Recent** | Recent turns, tool I/O | Kept as-is, may be pruned next round | Last 6 user/assistant pairs, last 4 tool I/O |

**Rationale**:
- **Clarity**: Developers understand what's kept vs. summarized vs. dropped
- **Efficiency**: Avoid redundant summaries (only summarize remainder)
- **Auditability**: Each layer logged separately in trace events

**Compaction output structure**:
```
[Pinned Protected Messages]
[Session Summary - COMPACT-SUMMARY vN]
[Ephemeral Recent Messages]
```

**Alternatives considered**:
- ❌ **Single flat list**: Loses layer semantics; hard to debug
- ❌ **Persistent external memory**: Adds complexity; not needed for v1

---

### 6. Observability: OpenAI SDK Tracing + Ariadne Integration

**Decision**: Emit **structured span events** using OpenAI Agents SDK tracing primitives, exported to Ariadne via HTTP exporter.

**Trace event schema**:
```python
{
    "type": "span",
    "trace_id": "session-abc-123",
    "span_id": "compact-preflight-xyz",
    "parent_id": "before_model_call-xyz",
    "name": "compact.trigger_decision",
    "timestamp": "2025-10-19T12:34:56Z",
    "duration_ms": 42,
    "status": "ok",
    "properties": {
        "model": "gpt-4",
        "t_est": 112345,
        "max_tokens": 128000,
        "trigger_pct": 0.85,
        "triggered": true,
        "policy": {
            "keep_recent_turns": 6,
            "keep_tool_io_pairs": 4,
            "strategy": "task_state"
        },
        "kept": {
            "pinned": 3,
            "recent_turns": 6,
            "tool_pairs": 4
        },
        "pruned_count": 47,
        "summary_tokens": 480
    },
    "payload": "{...}" # JSON-encoded for Ariadne inspector
}
```

**Event types**:
1. `compact.token_estimate` - Before compaction decision (always emitted)
2. `compact.trigger_decision` - Compaction triggered or skipped
3. `compact.summary_created` - Summary content + token count
4. `compact.pruned_messages` - Count + IDs of pruned messages
5. `compact.error` - Failure modes (summarization failed, budget exceeded)

**Ariadne integration**:
- Reuse existing HTTP exporter pattern from `examples/python-openai-agents/http_exporter.py`
- Non-blocking POST to `/ingest` (timeout ≤2s)
- Batching for efficiency (flush on compaction completion)
- Redaction applied before export (same as storage adapters)

**Timeline visualization**:
- Compaction events appear as distinct spans in Ariadne trace tree
- Duration bars show summarization latency
- Inspector reveals summary content, policy decisions, token counts

**Alternatives considered**:
- ❌ **Console-only logging**: Not observable in production; hard to correlate with agent actions
- ❌ **OTLP only**: Requires external collector; higher barrier to entry (added as optional v0.2+)
- ⚠️ **Custom telemetry format**: Reinventing the wheel; prefer OpenAI SDK primitives

---

### 7. Storage & Archival: Pluggable Adapters

**Decision**: Define `StorageAdapter` protocol with implementations for filesystem (default) and S3 (optional).

**Protocol**:
```python
class StorageAdapter(Protocol):
    def save_transcript(self, session_id: str, transcript: Sequence[Message]) -> None: ...
    def save_summary(self, session_id: str, summary: Message, step: int) -> None: ...
    def save_event(self, session_id: str, event: Dict[str, Any]) -> None: ...
```

**Filesystem adapter** (`.compact/archive/{session_id}/`):
```
.compact/archive/
└── session-abc-123/
    ├── transcript-pre-compact-001.jsonl   # Full history before 1st compaction
    ├── summary-001.json                   # 1st compaction summary
    ├── transcript-pre-compact-002.jsonl   # Full history before 2nd compaction
    ├── summary-002.json                   # 2nd compaction summary
    └── events.jsonl                       # All compaction events
```

**S3 adapter** (optional):
- Same structure under `s3://{bucket}/{prefix}/{session_id}/`
- KMS encryption via boto3 client config
- IAM role-based access (no hardcoded credentials)

**Redaction hooks**:
- Apply regex patterns before export: `(?i)api[_-]?key\s*[:=]\s*\S+`, `(?i)password\s*[:=]\s*\S+`
- Configurable via YAML: `redaction.patterns`
- Optional callback for custom redaction logic

**Retention**:
- Filesystem: Manual cleanup (document in README)
- S3: Use S3 lifecycle policies

**Alternatives considered**:
- ❌ **SQLite**: Overkill for append-only logs; harder to inspect
- ❌ **Vendor-managed storage**: Privacy concerns; vendor lock-in

---

### 8. Configuration: YAML with Env Overrides

**Decision**: Primary config via YAML file, with environment variable overrides for CI/production.

**Example**:
```yaml
model: "gpt-4"
max_context_tokens: 128000

policy:
  trigger_pct: 0.85
  hard_cap_buffer: 1500
  keep_recent_turns: 6
  keep_tool_io_pairs: 4
  roles_never_prune: ["system", "developer"]
  protected_flag: "protected"
  strategy: "task_state"

telemetry:
  exporter: "ariadne"  # console | ariadne | otlp | custom
  ariadne_url: "http://localhost:5175/ingest"

storage:
  adapter: "fs"  # fs | s3 | custom
  path: "./.compact/archive"

redaction:
  enabled: true
  patterns:
    - "(?i)api[_-]?key\\s*[:=]\\s*\\S+"
    - "(?i)password\\s*[:=]\\s*\\S+"
```

**Environment overrides**:
- `COMPACT_MODEL=gpt-3.5-turbo` overrides `model`
- `COMPACT_TRIGGER_PCT=0.9` overrides `policy.trigger_pct`
- `COMPACT_ARIADNE_URL=...` overrides `telemetry.ariadne_url`

**Validation**:
- Pydantic models for type safety
- Clear error messages with field paths (e.g., "policy.trigger_pct must be 0.0-1.0")

**Defaults** (sensible for most use cases):
```python
CompactPolicy(
    trigger_pct=0.85,
    hard_cap_buffer=1500,
    keep_recent_turns=6,
    keep_tool_io_pairs=4,
    roles_never_prune=("system", "developer"),
    protected_flag="protected",
    strategy="task_state"
)
```

**Alternatives considered**:
- ❌ **JSON only**: Less readable; no comments
- ❌ **Code-only config**: Harder for operators to tweak

---

### 9. Testing Strategy: Determinism + Golden Fixtures

**Decision**: Prioritize **deterministic, reproducible tests** via seeded summarization and golden fixtures.

**Test pyramid**:
1. **Unit tests** (fast, isolated):
   - Token estimation accuracy (known examples: "hello" → 1 token)
   - Partitioning logic (protected, recent, tool I/O, remainder)
   - Policy enforcement (trigger thresholds, budget calculations)
   - Redaction patterns (secrets removed)

2. **Golden summary tests** (deterministic):
   - Fixed seed + temperature=0 → same summary every time
   - Fixtures: `tests/fixtures/golden_summaries/task_state_001.json`
   - Eval rubric: Check for key entities, constraints, decisions

3. **Property tests** (invariants):
   - "Protected items never pruned" (after 100 random runs)
   - "Post-compaction always under budget" (varied inputs)
   - "No secrets in exported data" (redaction applied)

4. **Soak tests** (reliability):
   - 1,000 runs with random tool I/O density
   - Assert zero `CompactError(InsufficientBudget)` exceptions
   - Track success rate (target: >95%)

5. **Regression tests** (task success):
   - Known agent tasks (e.g., "refactor authentication module")
   - Measure success delta pre/post compaction (target: <3%)

6. **Integration tests** (Ariadne):
   - Spin up Ariadne API on port 5175
   - Trigger compaction
   - Assert trace events appear in `/events` SSE stream
   - Verify timeline visualization

**Coverage target**: ≥85% line coverage (pytest-cov)

**Alternatives considered**:
- ❌ **Manual testing only**: Not scalable; hard to catch regressions
- ❌ **End-to-end only**: Too slow; flaky

---

## Risks / Trade-offs

### Risk 1: Information Loss via Aggressive Summarization
**Impact**: Agent forgets critical details; task success rate drops.

**Mitigation**:
- Protected memory for explicit constraints
- Decision log strategy preserves rationale
- Eval rubric tracks key entity retention (>90%)
- Regression tests measure task success delta (<3%)

### Risk 2: Latency Spikes from Summarization
**Impact**: Compaction adds 1-2s per turn; user-facing slowdown.

**Mitigation**:
- Run compaction **before** user turn when idle (pre-flight timing)
- Use cheaper/faster summarizer model (e.g., gpt-3.5 instead of gpt-4)
- Cache summarization results for identical remainder (future work)
- Async compaction in background (v0.3+)

### Risk 3: Compliance / PII Leakage
**Impact**: Secrets or PII exported to storage/Ariadne without redaction.

**Mitigation**:
- Redaction enabled by default
- Regex patterns for common secrets (API keys, passwords)
- Warn on export if redaction disabled
- Encrypt storage adapters (KMS for S3)
- Audit logs for all exports

### Risk 4: User Confusion ("Agent Forgot Everything!")
**Impact**: Users don't understand why agent lost context.

**Mitigation**:
- Emit trace event notices ("Compaction triggered")
- Add `/compact_status` command showing current memory layers
- Clear documentation on protected memory usage
- Expose "what I remember now" summary in UI (future work)

### Risk 5: Budget Exhaustion (Over-Budget After Compaction)
**Impact**: Incremental reduction of keep counts fails; `CompactError` raised; session blocked.

**Mitigation**:
- Fallback logic reduces keep_recent_turns and keep_tool_io_pairs to 1
- If still over budget: Raise explicit error with guidance ("Reduce protected memory or increase model context limit")
- Emit `compact.error` event for observability
- Document manual intervention steps

---

## Migration Plan

N/A - This is a new capability with no existing state.

**Future migrations** (if API changes):
- Config file version field (`version: "1.0"`)
- Auto-migration on load (backward compatibility)
- Deprecation warnings for old config keys

---

## Open Questions

### Q1: Should we support semantic clustering for redundancy detection?
**Context**: Repeated tool outputs or similar user questions could be deduplicated.

**Decision**: Defer to **v0.3** behind feature flag. Adds complexity (vector embeddings, cosine similarity) without proven need.

**Acceptance criteria**:
- Benchmark shows >20% token savings on real sessions
- Clustering cost <5% wall time
- No false-positive deduplication (high precision)

---

### Q2: Should compaction be async (background thread)?
**Context**: Summarization can take 1-2s; blocks main agent loop.

**Decision**: **Synchronous for v1** (simpler, deterministic). Async in **v0.3+** if benchmarks show user-facing latency issues.

**Acceptance criteria**:
- Median compaction latency >1s in production
- Background task isolation (no race conditions)
- Clear failure semantics (what if summarization fails after user message sent?)

---

### Q3: Should we support cross-session memory?
**Context**: Agents often have repeated conversations with same user (e.g., daily standups).

**Decision**: **Out of scope for v1**. Requires persistent knowledge base, semantic indexing, privacy controls.

**Future work**:
- `CompactManager` loads prior session summaries
- User-scoped memory namespace
- RAG integration (vector DB optional)

---

## Appendix: Event Schema Reference

### compact.token_estimate
```json
{
  "type": "span",
  "name": "compact.token_estimate",
  "properties": {
    "model": "gpt-4",
    "t_est": 112345,
    "max_tokens": 128000,
    "usage_pct": 0.877,
    "breakdown": {
      "system": 500,
      "developer": 200,
      "tools_schema": 1500,
      "messages": 110145
    }
  }
}
```

### compact.trigger_decision
```json
{
  "type": "span",
  "name": "compact.trigger_decision",
  "properties": {
    "triggered": true,
    "reason": "usage_pct >= trigger_pct",
    "policy": {
      "trigger_pct": 0.85,
      "hard_cap_buffer": 1500,
      "strategy": "task_state"
    }
  }
}
```

### compact.summary_created
```json
{
  "type": "span",
  "name": "compact.summary_created",
  "properties": {
    "strategy": "task_state",
    "input_messages": 47,
    "summary_tokens": 480,
    "compression_ratio": 0.042
  },
  "payload": "{\"summary\": \"Goals: Refactor auth module...\"}"
}
```

### compact.pruned_messages
```json
{
  "type": "span",
  "name": "compact.pruned_messages",
  "properties": {
    "pruned_count": 47,
    "kept": {
      "pinned": 3,
      "recent_turns": 6,
      "tool_pairs": 4
    }
  }
}
```

### compact.error
```json
{
  "type": "span",
  "name": "compact.error",
  "status": "error",
  "properties": {
    "error_type": "InsufficientBudget",
    "message": "Protected memory + recent + tool I/O exceeds budget",
    "fallback": "none"
  }
}
```
