# Project Context

## Purpose

**Ariadne Trace Viewer** is a production-ready, local-first trace viewer for the OpenAI Agents SDK. It streams agent telemetry to a rich React UI in <1 second without requiring cloud infrastructure, databases, or authentication.

**Key capabilities:**
- Real-time SSE streaming from Hono API to React UI
- In-memory bounded ring buffer (default 10k events) for memory safety
- Privacy-first design with per-event reveal controls
- OpenAI-style dashboard with hierarchical trace trees and tabbed inspector
- Python HTTP exporter for seamless OpenAI Agents SDK integration
- Local-only localhost deployment (no network exposure)

## Tech Stack

- **Package Manager:** pnpm 8+
- **Runtime:** Node.js 20+
- **Backend:** Hono 4.6.14+ TypeScript 5.7.3+
- **Frontend:** React 18.3.1+, Vite 6.0.7+
- **Validation:** Zod 3.24.1
- **Styling:** Tailwind CSS 3.4.17
- **UI Components:** Radix UI + shadcn/ui 1.x
- **Testing:** Vitest 2.1.8
- **Linting:** ESLint 9.37.0 + TypeScript ESLint

## Project Conventions

### Code Style

- **Language:** TypeScript strict mode (all files)
- **Module system:** ESM (Node.js 20+ native support)
- **Imports:** Use `.js` extensions for relative imports (Vite/Node bundler compliance)
- **Formatting:** Enforced via ESLint + Prettier (run `pnpm lint`)
- **Naming:**
  - Components: PascalCase (e.g., `AgentTraceTree.tsx`)
  - Functions/utilities: camelCase (e.g., `buildTraceTree()`)
  - Constants: SCREAMING_SNAKE_CASE (e.g., `MAX_EVENTS`)
  - Handler functions: `handleX*` prefix (e.g., `handleFilterChange`)
  - Hooks: `useX*` prefix (e.g., `useStreamControl`)
- **Files:** kebab-case (e.g., `trace-inspector.tsx`)

### Architecture Patterns

1. **Event Lifecycle:**
   - OpenAI Agents SDK → POST /ingest → Zod validation + truncation (256 KB limit) → EventStore (Ring Buffer + TraceIndex Map) → SSE Manager broadcast → React UI (AgentTraceTree + TraceInspector)

2. **Memory Safety:**
   - Bounded ring buffer prevents unbounded memory growth (default 10k events ≈ 20-30 MB)
   - Oldest events automatically evicted when buffer full
   - Configurable via `MAX_EVENTS` env var (backend) and `VITE_MAX_TRACES` (frontend)

3. **Type Safety:**
   - Dual validation: TypeScript types + Zod schemas (compile-time + runtime)
   - Pattern: Always use `z.infer<typeof schema>` instead of hand-rolled types
   - Schema changes require rebuilding shared package: `pnpm --filter @ariadne/shared build`

4. **Privacy by Default:**
   - Sensitive data hidden until explicitly revealed per-event
   - Hook: `usePrivacyStore` manages global reveal state
   - Pattern: Respect `shouldHideData(eventId)` checks; expose via unified reveal mechanism in TraceInspector

5. **Stream Control:**
   - Centralized pause/resume in `useStreamControl.ts` hook with client-side event buffering
   - Space bar toggles pause (not in input fields)
   - Pattern: New stream UX features must coordinate via this hook

6. **SSE Framing:**
   - Maintain `data: {json}\n\n` format
   - Heartbeat comments every 15s to keep connections alive

### Testing Strategy

- **Unit tests:** Vitest (`pnpm test`)
- **Type validation:** TypeScript strict mode (`pnpm typecheck`)
- **Linting:** ESLint (`pnpm lint`)
- **Integration tests:** Bash scripts for regression checks:
  - `bash test-privacy.sh` - Privacy controls
  - `bash test-stream-control.sh` - Stream pause/resume
  - `bash test-timeline.sh` - Timeline visualization
- **Quality gate:** Always run before merging:
  ```bash
  pnpm test && pnpm typecheck && pnpm lint
  ```
- **Smoke test:**
  ```bash
  curl http://localhost:5175/ingest
  curl http://localhost:5175/healthz
  ```

### Git Workflow

- **Branch strategy:** Feature branches off `master`
- **Commit message style:** Conventional commits (feat:, fix:, refactor:, docs:)
- **Examples:**
  - `feat: add privacy reveal toggle to trace inspector`
  - `fix: prevent memory leak in SSE manager`
  - `refactor: consolidate trace tree building logic`
- **Before merging:** Ensure all tests pass and no TypeScript errors
- **PR expectations:** Include test coverage, reference related issues

## Domain Context

### Event Data Model
- **TraceEvent:** Root-level events with trace_id, spans, metadata
- **SpanEvent:** Child events within traces (parent_id links to parent span)
- **Properties:** type, timestamp, duration, status, payload, metadata
- **Payload:** Arbitrary JSON (string-encoded to prevent nested escaping issues)

### Trace Indexing
- In-memory `Map<trace_id, TraceIndex>` for O(1) trace lookups
- TraceIndex tracks: root event, all spans, parent-child relationships
- Critical for hierarchical rendering (AgentTraceTree)

### Privacy Model
- Default: all payloads hidden
- Per-event reveal toggle in TraceInspector tabs (Response/Properties/Raw JSON)
- State persisted in Zustand store (`usePrivacyStore`)
- Example: user clicks "Reveal Data" → `shouldHideData(eventId)` returns false → JSON rendered

### Stream Lifecycle
- SSE connection established on App mount
- Server broadcasts all new events to connected clients
- Client buffers events while paused (Space bar toggles)
- On resume, buffer flushed to UI in batches

## Important Constraints

1. **Memory Safety:** Ring buffer hard limit (`MAX_EVENTS`) prevents OOM crashes. Must monitor RAM usage in production.
2. **Localhost-only:** Binds 127.0.0.1:5175 (API) and 127.0.0.1:5173 (Web). No remote access without reverse proxy + HTTPS.
3. **Payload Truncation:** Single events >256 KB rejected. Exporter must trim large payloads.
4. **Privacy by Default:** All sensitive data hidden. Reveal is opt-in per event (security-first design).
5. **Transient Storage:** Events live in memory only. External backup required for long-term retention.
6. **Non-blocking Exporters:** Python HTTP exporter timeout ≤ 2s (never blocks agent loop).
7. **Shared Package Rebuild:** After editing `packages/shared/src/types.ts` or `schemas.ts`, must rebuild:
   ```bash
   pnpm --filter @ariadne/shared build
   ```

## External Dependencies

- **OpenAI Agents SDK:** Source telemetry events (Python HTTP exporter integration)
- **Hono:** Backend web framework (type-safe routing, middleware)
- **React 18:** Frontend UI (hooks, suspense)
- **Vite 6:** Build tooling (fast HMR, ESM native)
- **Zod:** Runtime validation (schema→type inference)
- **Tailwind CSS:** Utility-first styling
- **Radix UI / shadcn/ui:** Accessible component library
- **Vitest:** Fast unit testing (ESM-native)
- **TypeScript ESLint:** Linting + type checking

## Key Files & Responsibilities

| File | Purpose |
|------|---------|
| `/api/src/index.ts` | Server init, CORS, middleware mounting |
| `/api/src/store/eventStore.ts` | EventStore singleton—ring buffer + trace index |
| `/api/src/store/sseManager.ts` | SSE pool, broadcasting, heartbeat (15s) |
| `/api/src/routes/ingest.ts` | POST /ingest—Zod parse, size check, store append |
| `/web/src/App.tsx` | React root—SSE connection, global state, layout |
| `/web/src/components/TraceInspector.tsx` | Tabbed inspector with privacy controls |
| `/web/src/utils/traceTree.ts` | Builds hierarchical tree from flat spans |
| `/web/src/hooks/useStreamControl.ts` | Pause/resume buffering state |
| `/packages/shared/src/schemas.ts` | Zod schemas (runtime validators) |
| `/packages/shared/src/types.ts` | TypeScript types (must rebuild after changes) |

## Configuration

### Backend Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 5175 | API listen port (binds 127.0.0.1 only) |
| `HOST` | 127.0.0.1 | Bind address (localhost-only for security) |
| `MAX_EVENTS` | 10000 | Ring buffer capacity before eviction |
| `CORS_ORIGIN` | http://localhost:5173 | Allowed SSE client origin |

### Frontend Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_API_URL` | http://localhost:5175 | Backend API/SSE base URL |
| `VITE_MAX_TRACES` | 200 | Client-side trace retention limit |

## Development Commands

```bash
# Install and bootstrap
pnpm install
pnpm --filter @ariadne/shared build

# Development
pnpm dev                    # API:5175 + Web:5173 concurrently
pnpm dev:api                # API only
pnpm dev:web                # Web only

# Production build
pnpm build                  # All packages
pnpm build:api              # API only
pnpm build:web              # Web only

# Quality gates
pnpm test                   # Run all Vitest suites
pnpm typecheck              # Strict TypeScript validation
pnpm lint                   # ESLint validation
```
