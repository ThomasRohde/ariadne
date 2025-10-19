# Implementation Tasks

## 1. Project Setup & Structure

- [ ] 1.1 Create `examples/compaction/` directory structure
- [ ] 1.2 Initialize Python package with `pyproject.toml` (setuptools build backend, uv package manager)
  - [ ] Follow pattern from `examples/python-openai-agents/pyproject.toml`
  - [ ] Include `requirements.txt` and `requirements-dev.txt` mirroring dependencies
  - [ ] Configure ruff for linting (line-length=100, target-version=py311)
  - [ ] Add CLI entry point via `[project.scripts]`
- [ ] 1.3 Create `compact/` package with `__init__.py`
- [ ] 1.4 Set up testing infrastructure (pytest, fixtures directory)
- [ ] 1.5 Create `examples/` subdirectory for integration demos
- [ ] 1.6 Create `docs/` subdirectory for user documentation
- [ ] 1.7 Add `.gitignore` for Python artifacts (`.venv/`, `__pycache__/`, `*.pyc`, `.pytest_cache/`, `.ruff_cache/`) and `.compact/` archive directory
- [ ] 1.8 Add `uv.lock` file after initial dependency installation

## 2. Core Type System & Protocols

- [ ] 2.1 Implement `compact/types.py` with core dataclasses:
  - [ ] `Message` (role, content, meta)
  - [ ] `CompactPolicy` (trigger thresholds, keep counts, strategy)
  - [ ] `CompactConfig` (model, max_context_tokens, adapters)
- [ ] 2.2 Implement `compact/protocols.py` with SPIs:
  - [ ] `TokenEstimator` protocol
  - [ ] `StorageAdapter` protocol
  - [ ] `Exporter` protocol (for observability)
  - [ ] `Summarizer` protocol
- [ ] 2.3 Add Zod-equivalent validation (Pydantic or dataclass validators)

## 3. Token Estimation

- [ ] 3.1 Implement `compact/estimators/tiktoken.py`:
  - [ ] `TiktokenEstimator` class with model-specific encoding
  - [ ] Message serialization for accurate token counts
  - [ ] System prompt + tools schema accounting
- [ ] 3.2 Implement `compact/estimators/noop.py` (testing/mocking)
- [ ] 3.3 Write unit tests for estimators with known token counts

## 4. Compaction Algorithm

- [ ] 4.1 Implement `compact/policy.py`:
  - [ ] Message partitioning logic (pinned, recent, tool I/O, remainder)
  - [ ] Budget calculation with buffer reserves
  - [ ] Trigger threshold evaluation
- [ ] 4.2 Implement fallback logic (reduce keep counts if over budget)
- [ ] 4.3 Write unit tests for partitioning and edge cases
- [ ] 4.4 Add property tests (e.g., "protected never pruned")

## 5. Summarization Engine

- [ ] 5.1 Implement `compact/summarizer.py`:
  - [ ] `Summarizer` base class with OpenAI API integration
  - [ ] Few-shot prompt templates for strategies:
    - [ ] `task_state`: goals, entities, constraints, decisions
    - [ ] `brief`: short bullet summary
    - [ ] `decision_log`: chronological decision ledger
    - [ ] `code_delta`: file changes summary
- [ ] 5.2 Add retry logic with exponential backoff
- [ ] 5.3 Implement fallback to cheaper models if summarization fails
- [ ] 5.4 Write golden summary tests (seeded, deterministic)

## 6. Compaction Manager

- [ ] 6.1 Implement `compact/manager.py`:
  - [ ] `CompactManager` class with config initialization
  - [ ] `preflight(session_id, messages)` - main orchestration
  - [ ] `manual_compact(session_id, messages, note)` - explicit trigger
- [ ] 6.2 Integrate token estimation, partitioning, summarization, pruning
- [ ] 6.3 Emit structured events at each decision point
- [ ] 6.4 Handle failure modes gracefully (fallback to pruning-only)
- [ ] 6.5 Write integration tests with synthetic message histories

## 7. Storage Adapters

- [ ] 7.1 Implement `compact/adapters/fs.py`:
  - [ ] `FileStorage` with `.compact/archive/{session_id}/` structure
  - [ ] `save_transcript()` - full pre-compact history
  - [ ] `save_summary()` - compaction summaries by step
  - [ ] `save_event()` - structured event logs
- [ ] 7.2 Implement `compact/adapters/s3.py` (optional):
  - [ ] S3 client with boto3
  - [ ] KMS encryption support
  - [ ] IAM role-based access
- [ ] 7.3 Implement redaction hooks (regex patterns for secrets)
- [ ] 7.4 Write security tests (ensure no PII/secrets leak)

## 8. Observability & Tracing

- [ ] 8.1 Implement `compact/exporters/console.py`:
  - [ ] Structured JSON logging to stderr
  - [ ] Event schema with timestamps, session IDs, counts
- [ ] 8.2 Implement `compact/exporters/ariadne.py`:
  - [ ] HTTP exporter to Ariadne `/ingest` endpoint
  - [ ] OpenAI SDK tracing integration (span events)
  - [ ] Non-blocking with timeout (≤2s)
  - [ ] Batching for efficiency
- [ ] 8.3 Define trace event schema:
  - [ ] `compact.token_estimate` (before compaction)
  - [ ] `compact.trigger_decision` (trigger fired/skipped)
  - [ ] `compact.summary_created` (summary content + token count)
  - [ ] `compact.pruned_messages` (count, policy applied)
  - [ ] `compact.error` (failure modes)
- [ ] 8.4 Implement OTLP exporter (optional, for OpenTelemetry)
- [ ] 8.5 Add heartbeat/connection health checks

## 9. OpenAI Agents SDK Integration

- [ ] 9.1 Implement `compact/hooks.py`:
  - [ ] `before_model_call` middleware hook
  - [ ] Context extraction (session_id, messages, model, tools)
  - [ ] Message injection post-compaction
- [ ] 9.2 Add configuration helpers for Agent/Runner setup
- [ ] 9.3 Implement protected memory marking helpers
- [ ] 9.4 Write integration example (`examples/coding_assistant.py`)

## 10. Configuration System

- [ ] 10.1 Implement `compact/config.py`:
  - [ ] YAML/JSON parsing
  - [ ] Environment variable overrides
  - [ ] Default policy values
  - [ ] Validation with clear error messages
- [ ] 10.2 Create example config file (`config.example.yaml`)
- [ ] 10.3 Document all configuration options

## 11. CLI Tool

- [ ] 11.1 Implement `compactctl` CLI:
  - [ ] `dry-run` - show compaction plan without executing
  - [ ] `diff` - compare pre/post compaction messages
  - [ ] `compact` - manual compaction trigger
  - [ ] `validate-config` - config file validation
- [ ] 11.2 Add CLI entry point in `pyproject.toml`

## 12. Examples & Demos

- [ ] 12.1 Create `examples/agents_sdk_minimal.py`:
  - [ ] Minimal integration (≤10 LOC)
  - [ ] Console exporter
  - [ ] Filesystem storage
- [ ] 12.2 Create `examples/coding_session.py`:
  - [ ] Realistic coding assistant scenario
  - [ ] Ariadne tracing integration
  - [ ] Protected memory (policy, constraints)
  - [ ] Manual `/compact` command
- [ ] 12.3 Create `examples/long_research.py`:
  - [ ] Synthetic long-running session (>128k tokens)
  - [ ] Multiple compaction rounds
  - [ ] Demonstrate memory layering
- [ ] 12.4 Add README with quick start guide

## 13. Testing

- [ ] 13.1 Write unit tests:
  - [ ] Token estimator accuracy
  - [ ] Message partitioning logic
  - [ ] Policy enforcement
  - [ ] Redaction patterns
- [ ] 13.2 Write golden summary tests:
  - [ ] Seeded, deterministic summaries
  - [ ] Eval rubric (key entity retention >90%)
- [ ] 13.3 Write property tests:
  - [ ] Protected items never pruned
  - [ ] Post-compaction always under budget
- [ ] 13.4 Write soak tests:
  - [ ] 1,000 runs with random tool I/O density
  - [ ] Assert zero context-limit errors
- [ ] 13.5 Write regression tests:
  - [ ] Task success rate delta <3%
- [ ] 13.6 Write security tests:
  - [ ] Redaction applied on export
  - [ ] No secrets in storage adapters
- [ ] 13.7 Achieve ≥85% test coverage

## 14. Documentation

- [ ] 14.1 Write `README.md`:
  - [ ] Overview and motivation
  - [ ] Prerequisites (Python 3.11+, uv package manager, OpenAI API key)
  - [ ] Quick start with uv workflow:
    - [ ] `uv venv` + `source .venv/bin/activate`
    - [ ] `uv pip install .`
    - [ ] Environment configuration (.env file)
  - [ ] Minimal integration example (≤10 LOC)
  - [ ] Configuration reference
  - [ ] API documentation
  - [ ] Development section (`uv pip install -r requirements-dev.txt`, ruff commands)
- [ ] 14.2 Write `SECURITY.md`:
  - [ ] Redaction patterns
  - [ ] PII/PCI compliance
  - [ ] Encryption (storage adapters)
  - [ ] Audit logging
- [ ] 14.3 Write `MIGRATION.md` (placeholder for future versions)
- [ ] 14.4 Create `docs/ARCHITECTURE.md`:
  - [ ] System diagram
  - [ ] Data flow
  - [ ] Extension points
- [ ] 14.5 Create `docs/OBSERVABILITY.md`:
  - [ ] Trace event schema
  - [ ] Ariadne integration guide
  - [ ] OTLP configuration
- [ ] 14.6 Add inline code documentation (docstrings)

## 15. Integration with Ariadne Viewer

- [ ] 15.1 Test Ariadne HTTP exporter with compaction events
- [ ] 15.2 Verify trace tree rendering in Ariadne UI
- [ ] 15.3 Add timeline visualization for compaction events
- [ ] 15.4 Test privacy controls for summary payloads
- [ ] 15.5 Document Ariadne-specific configuration

## 16. Quality Gates

- [ ] 16.1 Run `pytest` with ≥85% coverage
- [ ] 16.2 Run type checker (mypy) with strict mode
- [ ] 16.3 Run linter (ruff or pylint)
- [ ] 16.4 Validate long-session synthetic test (≥3× model window)
- [ ] 16.5 Validate manual `/compact` reduces tokens by ≥40%
- [ ] 16.6 Smoke test with Ariadne viewer (compaction events visible)

## 17. Deployment Preparation

- [ ] 17.1 Add LICENSE file (MIT)
- [ ] 17.2 Create `CHANGELOG.md`
- [ ] 17.3 Tag v0.1 release
- [ ] 17.4 Prepare rollout plan for v0.2, v0.3, v1.0
