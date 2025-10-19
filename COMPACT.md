# COMPACT.md
# PRD: Auto-Compaction & Context Management Extension for OpenAI Agents SDK

**Owner:** Platform AI / Agent Frameworks  
**Target Implementer:** Code agent (e.g., Codex CLI)  
**Status:** Draft v1.0 (developer-ready)  
**Scope:** General-purpose extension package for OpenAI Agents SDK projects enabling automatic context compaction, summarization, and memory layering with deterministic hooks.

---

## 1. Problem Statement

Long-running agent sessions (coding assistants, deep research, troubleshooting, multi-step workflows) accumulate history until they hit model context limits. Without proactive management, runs fail or degrade. We need a **portable, SDK-agnostic extension** that:
- Monitors token usage per-run/per-session.
- Triggers **deterministic compaction** (summarization + pruning) before limits are hit.
- Preserves **critical facts** (protected memory) while discarding low-signal history.
- Surfaces **traceable** actions for audit/observability and supports offline archival.

**Non-goals (v1):**
- General long-term knowledge bases or RAG pipelines.
- Cross-session semantic deduplication beyond simple heuristics.
- Vendor-managed storage; the extension will be pluggable into user storage backends.

---

## 2. Objectives & Key Results (OKRs)

### O1. Reliability
- **KR1:** Sessions exceeding 75% of window remain stable through compaction (>95% success across 1,000-run soak test).
- **KR2:** Zero hard context-limit exceptions in CI test suite with synthetic long histories.

### O2. Quality
- **KR3:** Task success rate drop due to compaction < 3% (measured by regression harness).  
- **KR4:** Summaries retain >90% of key entities/constraints per eval rubric.

### O3. Operability
- **KR5:** Compaction decisions and artifacts appear in tracing within <200ms of decision point.  
- **KR6:** Single-file drop-in config with sensible defaults; enable in <10 LOC.

---

## 3. Requirements

### 3.1 Functional
1. **Token Budget Monitoring**
   - Pluggable token estimator (`tiktoken`-compatible or provider-specific).
   - Live accounting for: system prompt, tools schema, memory, history, user input.
2. **Compaction Triggers**
   - Thresholds: percentage (e.g., 0.8), absolute tokens left, or “soft + hard” dual threshold.
   - Manual trigger (`/compact`), programmatic API, and **pre-flight** auto-trigger.
3. **Summarization Strategies**
   - Built-in templates: *extractive brief*, *task state*, *step ledger*, *requirements ledger*, *code delta*, *decision log*.
   - Few-shot prompt templates with **role-weighted salience** and **protected fields**.
4. **Protected Memory**
   - Taggable items never compacted (e.g., policies, constraints, credentials redacted, acceptance criteria).
5. **History Pruning Policies**
   - FIFO, **recency-biased keep**, semantic cluster keep (placeholder API), or **stage-aware** keep (e.g., keep last N tool I/O pairs).
6. **Memory Layers**
   - **Ephemeral recent** (last K turns), **Session summary** (rolling), **Pinned protected** (immutable until replaced).
7. **Observability**
   - Structured events for: token_estimate, trigger_decision, summary_created, pruned_messages, policy_applied.
   - Exporters: console, OpenTelemetry (OTLP), custom callback.
8. **Archival**
   - Full transcript & summaries persisted via user-supplied `StorageAdapter` (filesystem, S3, DB). Redaction hooks.
9. **Failure Modes**
   - If summarization fails: fallback to **policy-only pruning** with warning and trace event.
10. **SDK Integration**
    - Works with **OpenAI Agents SDK** `Agent/Runner` via middleware hooks (`before_run`, `before_model_call`, `after_model_call`).

### 3.2 Non-Functional
- **Performance:** Overhead < 10% wall time at steady state on long sessions.
- **Security:** No PII leaves process unless routed through explicit StorageAdapter. Redaction policies applied before export.
- **Config:** YAML/JSON; env overrides supported.
- **Testability:** Deterministic seeds; golden-summary fixtures; synthetic history generators.
- **Portability:** No hard dependency on vector DBs; optional adapters permitted.

---

## 4. API Design

### 4.1 Core Types (Python)
```python
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Literal, Optional, Protocol, Sequence, Tuple

Role = Literal["system", "developer", "assistant", "user", "tool"]

@dataclass
class Message:
    role: Role
    content: str
    meta: Dict[str, Any] = None  # e.g., tool_name, turn_id, protected:bool

class TokenEstimator(Protocol):
    def estimate(self, messages: Sequence[Message], model: str) -> int: ...

class StorageAdapter(Protocol):
    def save_transcript(self, session_id: str, transcript: Sequence[Message]) -> None: ...
    def save_summary(self, session_id: str, summary: Message, step: int) -> None: ...
    def save_event(self, session_id: str, event: Dict[str, Any]) -> None: ...

class Exporter(Protocol):
    def emit(self, event: Dict[str, Any]) -> None: ...

@dataclass
class CompactPolicy:
    trigger_pct: float = 0.85            # auto-compact when est >= 85% of window
    hard_cap_buffer: int = 1024          # tokens reserved for next user/tool step
    keep_recent_turns: int = 6
    keep_tool_io_pairs: int = 4
    roles_never_prune: Tuple[Role, ...] = ("system", "developer")
    protected_flag: str = "protected"    # meta key
    strategy: Literal["task_state","brief","decision_log"] = "task_state"

@dataclass
class CompactConfig:
    model: str
    max_context_tokens: int
    policy: CompactPolicy = CompactPolicy()
    token_estimator: Optional[TokenEstimator] = None
    storage: Optional[StorageAdapter] = None
    exporter: Optional[Exporter] = None
    redact: Optional[Callable[[Message], Message]] = None
```

### 4.2 Manager
```python
class CompactManager:
    def __init__(self, cfg: CompactConfig): ...
    def preflight(self, session_id: str, messages: Sequence[Message]) -> Sequence[Message]:
        """Estimate tokens, decide on compaction, return possibly-compact messages"""
    def manual_compact(self, session_id: str, messages: Sequence[Message], note:str="manual") -> Sequence[Message]: ...
```

### 4.3 Summarizer SPI
```python
class Summarizer(Protocol):
    def summarize(self, messages: Sequence[Message], style: str, keep_keys: Sequence[str]) -> Message: ...

# Default implementation uses the same model (or a cheaper model) via a prompt template.
```

### 4.4 Agents SDK Wiring (Middleware)
```python
# Pseudocode illustrating OpenAI Agents SDK integration
from agents import Agent, Runner

manager = CompactManager(cfg)

def before_model_call(ctx):
    # ctx has: session_id, model, messages, tools, system, developer, etc.
    ctx.messages = manager.preflight(ctx.session_id, ctx.messages)

runner = Runner(agent, hooks={"before_model_call": before_model_call})
```

---

## 5. Compaction Algorithm

1. **Estimate** token usage `T_est` for `messages + system + developer + tool_schemas`.
2. Compute **budget**: `B = max_context_tokens - hard_cap_buffer`.
3. If `T_est / max_context_tokens >= trigger_pct` → **Compact**.
4. **Partition** messages:
   - *Pinned:* roles in `roles_never_prune` + `meta[protected_flag] == True`.
   - *Recent:* last `keep_recent_turns` (assistant/user).
   - *Tool I/O:* last `keep_tool_io_pairs` tool calls + tool outputs.
   - *Remainder:* eligible for summarization.
5. **Summarize** remainder with selected `strategy`:
   - `task_state`: entities, goals, constraints, decisions, open actions.
   - `brief`: short bullet brief + key refs.
   - `decision_log`: chronological ledger of decisions and rationales.
6. **Insert** a single `assistant` message: `content = "<COMPACT-SUMMARY vN> ..."`
7. **Prune** remainder from outbound payload (but keep full copy in archival storage).
8. **Re-estimate** to ensure `<= B`; if still > B, incrementally reduce `keep_recent_turns` then `keep_tool_io_pairs` (floor = 1 each), else fail with explicit error suggesting manual intervention.
9. **Emit events** to `exporter` + persist artifacts via `storage`.

---

## 6. Prompt Templates (Built-ins)

### 6.1 Task-State Summary
```
You are summarizing a conversation for compaction.
Extract ONLY:
- Goals and success criteria
- Key entities, ids, filenames, branches, environments
- Constraints (security, compliance, SLAs, budgets)
- Decisions taken + rationale
- Outstanding actions / blockers
- Sources/citations (names only)
Output a tight, factual summary (<= N tokens). Do NOT invent details.
```

### 6.2 Decision Log
```
Produce a concise chronological decision ledger:
[step_id] decision :: rationale :: inputs (brief) :: outputs (brief)
Keep neutral tone. No restatements.
```

### 6.3 Code Delta
```
Summarize code modifications as diffs-like bullets:
- file_path: summary of changes (functions, APIs touched, side effects)
Focus on what changed, why, and follow-ups.
```

---

## 7. Configuration

### 7.1 YAML
```yaml
model: "gpt-5-reasoning"      # example
max_context_tokens: 128000
policy:
  trigger_pct: 0.85
  hard_cap_buffer: 1500
  keep_recent_turns: 6
  keep_tool_io_pairs: 4
  roles_never_prune: ["system","developer"]
  protected_flag: "protected"
  strategy: "task_state"
telemetry:
  exporter: "console"         # console | otlp | custom
storage:
  adapter: "fs"               # fs | s3 | custom
  path: "./.compact/archive"
redaction:
  enabled: true
  patterns:
    - "(?i)api[_-]?key\\s*[:=]\\s*\\S+"
    - "(?i)password\\s*[:=]\\s*\\S+"
```

---

## 8. Integration Examples

### 8.1 Minimal Enablement (Python)
```python
from compact import CompactConfig, CompactManager, ConsoleExporter, FileStorage, TiktokenEstimator

cfg = CompactConfig(
    model="gpt-5-reasoning",
    max_context_tokens=128_000,
    token_estimator=TiktokenEstimator(),
    exporter=ConsoleExporter(),
    storage=FileStorage("./.compact/archive")
)
manager = CompactManager(cfg)

def before_model_call(ctx):
    ctx.messages = manager.preflight(ctx.session_id, ctx.messages)

runner = Runner(agent, hooks={"before_model_call": before_model_call})
runner.run()
```

### 8.2 Marking Protected Context
```python
messages.append(Message(role="developer", content=POLICY_TEXT, meta={"protected": True}))
```

### 8.3 Manual Command
```python
ctx.messages = manager.manual_compact(ctx.session_id, ctx.messages, note="user-command")
```

---

## 9. Observability & Tracing

- **Event schema (JSON):**
```json
{
  "ts": "2025-10-19T06:00:00Z",
  "session_id": "abc",
  "event": "compact.trigger_decision",
  "model": "gpt-5-reasoning",
  "t_est": 112345,
  "max": 128000,
  "policy": {"trigger_pct": 0.85, "buffer": 1500},
  "kept": {"pinned": 3, "recent_turns": 6, "tool_pairs": 4},
  "pruned_count": 47,
  "summary_tokens": 480
}
```
- **OTLP mapping:** event as SpanEvent on `before_model_call` span; attributes include counts and policy.

---

## 10. Security, Privacy, Compliance

- **Redaction:** Apply regex / function redaction to messages before export or storage.
- **PII/PCI:** Default deny-list; allow-list required to export PII fields.
- **Audit:** Always archive **pre-compact** full transcript in `StorageAdapter` (configurable retention).
- **Access Control:** Storage adapters should support KMS encryption and scoped IAM roles.
- **Determinism:** Provide fixed seed and deterministic prompts for reproducible summaries (useful for regulated environments).

---

## 11. Edge Cases & Failure Modes

- **Model refuses summarization:** Retry with “brief” style; on repeated failure fallback to pruning-only.
- **Over-budget after summary:** Reduce `keep_recent_turns` and `keep_tool_io_pairs` down to 1; if still over, raise `CompactError(InsufficientBudget)`.
- **Malformed tool messages:** Skip-compaction for that turn but log event and continue.
- **User disables redaction:** Emit high-severity warning event before exporting.
- **Mixed-model runs:** Use cheapest summarizer model if provided; otherwise same model.

---

## 12. Testing Strategy

1. **Unit:** token estimator mocks; partitioning; policy enforcement; redaction; exporter calls.
2. **Golden summaries:** fixtures with expected summaries (seeded).
3. **Property tests:** invariant “protected items never pruned”.
4. **Soak tests:** 1k runs, random tool I/O density, assert zero context-limit errors.
5. **Regression:** task harness measuring success deltas pre/post compaction (<3% allowed).
6. **Security tests:** ensure redaction on export; verify no secrets leak.

---

## 13. Deliverables

- `compact/` Python package:
  - `manager.py`, `policy.py`, `summarizer.py`, `adapters/{fs,s3,custom}.py`, `exporters/{console,otlp,custom}.py`, `estimators/{tiktoken,noop}.py`
  - `hooks.py` (Agents SDK glue), `exceptions.py`, `config.py`
- CLI: `compactctl` for dry-run, diff, and manual compaction.
- Examples: `examples/agents_sdk_minimal.py`, `examples/coding_session.py`
- Docs: `README.md`, `SECURITY.md`, `MIGRATION.md`
- Tests: `tests/**`

---

## 14. Rollout Plan

- **v0.1 (Prototype):** Minimal policy; console exporter; fs storage.
- **v0.2:** OTLP exporter; S3 adapter; deterministic prompts.
- **v0.3:** Semantic keep (optional cosine clustering) behind feature flag.
- **v1.0:** GA; performance tuning; full docs; API freeze.

---

## 15. Risks & Mitigations

- **Information loss:** Aggressive templates might drop critical context → Protected memory + decision log + eval rubric.
- **Latency spikes:** Summarization adds a model call → run compaction **before** user turn when idle; or use smaller/cheaper summarizer model.
- **Compliance:** Leaking secrets via storage/export → default redaction + encryption; deny export by default.
- **User confusion:** Agent “forgets” details → expose `/compact` event notices and surface “what I remember now” command.

---

## 16. Acceptance Criteria (for CI)

- `pytest -q` passes with coverage ≥ 85%.
- Long-session synthetic test (≥ 3× model window tokens) completes without context-limit errors.
- OTLP exporter validated against local collector (logs contain `compact.trigger_decision`).
- Manual `/compact` reduces token estimate by ≥ 40% on prepared fixture.

---

## 17. License & Notes

- MIT (example; adjust to org policy).  
- No dependency on OpenAI Vector Stores required.  
- Extension is SDK-agnostic at core with thin adapters for OpenAI Agents SDK hooks.
