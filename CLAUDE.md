<!-- OPENSPEC:START -->
# OpenSpec Instructions

These instructions are for AI assistants working in this project.

Always open `@/openspec/AGENTS.md` when the request:
- Mentions planning or proposals (words like proposal, spec, change, plan)
- Introduces new capabilities, breaking changes, architecture shifts, or big performance/security work
- Sounds ambiguous and you need the authoritative spec before coding

Use `@/openspec/AGENTS.md` to learn:
- How to create and apply change proposals
- Spec format and conventions
- Project structure and guidelines

Keep this managed block so 'openspec update' can refresh the instructions.

<!-- OPENSPEC:END -->

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ariadne Trace Viewer** is a production-ready, local-first trace viewer for the OpenAI Agents SDK. It streams agent telemetry to a rich React UI in <1 second without requiring cloud infrastructure, databases, or authentication.

**Key capabilities:**
- Real-time SSE streaming from Hono API to React UI
- In-memory bounded ring buffer (default 10k events) for memory safety
- Privacy-first design with per-event reveal controls
- OpenAI-style dashboard with hierarchical trace trees and tabbed inspector
- Python HTTP exporter for seamless OpenAI Agents SDK integration
- Local-only localhost deployment (no network exposure)

## Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| **Package Manager** | pnpm | 8+ |
| **Runtime** | Node.js | 20+ |
| **Backend** | Hono + TypeScript | 4.6.14 / 5.7.3 |
| **Frontend** | React + Vite | 18.3.1 / 6.0.7 |
| **Validation** | Zod | 3.24.1 |
| **CSS** | Tailwind CSS | 3.4.17 |
| **UI Components** | Radix UI + shadcn/ui | 1.x |
| **Testing** | Vitest | 2.1.8 |
| **Linting** | ESLint + TypeScript ESLint | 9.37.0 |

## Monorepo Structure

```
/api              # Hono API server (port 5175)
  ├── src/routes/
  │   ├── ingest.ts         # POST /ingest - validates & stores events
  │   ├── events.ts         # GET /events - SSE stream
  │   └── health.ts         # GET /healthz - readiness probe
  ├── src/store/
  │   ├── eventStore.ts     # Singleton with ring buffer + trace indexing
  │   ├── ringBuffer.ts     # Bounded circular buffer (default 10k)
  │   └── sseManager.ts     # SSE connection pool & broadcasting
  └── src/middleware/       # Zod validation, size limits, error handling

/web              # React + Vite UI (port 5173)
  ├── src/components/
  │   ├── AgentTraceTree.tsx        # Hierarchical trace renderer
  │   ├── TraceInspector.tsx        # Tabbed Response/Properties/Raw JSON
  │   ├── FilterControls.tsx        # Search, trace ID, kind filters
  │   ├── TraceTimeline.tsx         # Duration bars visualization
  │   └── ui/                       # shadcn/ui component library
  ├── src/hooks/
  │   ├── useStreamControl.ts       # Pause/resume + event buffering
  │   └── usePrivacyStore.ts        # Per-event data visibility state
  └── src/utils/
      ├── traceTree.ts              # Hierarchical tree building
      └── privacy.ts                # Redaction logic

/packages/shared  # Shared TypeScript types & Zod schemas
  ├── src/types.ts                 # TraceEvent, SpanEvent, IngestPayload
  └── src/schemas.ts               # Zod validation schemas

/examples/python-openai-agents
  ├── http_exporter.py             # Production-grade HTTP exporter
  └── weather_agent.py             # Sample integration
```

## Build & Development Commands

### Core Commands

```bash
# Install and bootstrap (required first time)
pnpm install
pnpm --filter @ariadne/shared build

# Development (API:5175 + Web:5173 concurrently)
pnpm dev                    # Both services
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

# Integration tests
pnpm test:timeline          # Timeline visualization test
bash test-privacy.sh        # Privacy controls test
bash test-stream-control.sh # Stream pause/resume test
```

### Important: Shared Package Rebuild

**After editing `packages/shared/src/types.ts` or `schemas.ts`:**
```bash
pnpm --filter @ariadne/shared build
```

Both API and Web import the compiled `.d.ts` files. Skipping this is the most common cause of type mismatches.

## Architecture Patterns

### 1. Event Lifecycle

```
OpenAI Agents SDK
       ↓
POST /ingest (batch or single)
       ↓
Zod validation + truncation (256 KB limit)
       ↓
EventStore (Ring Buffer + TraceIndex Map)
       ↓
SSE Manager broadcasts via GET /events
       ↓
React App (AgentTraceTree + TraceInspector)
```

### 2. Memory Safety

- **Ring Buffer:** Bounded circular buffer prevents unbounded memory growth. Default 10k events (~20-30 MB).
- **Eviction:** Oldest events removed when buffer full.
- **Configuration:** Adjust `MAX_EVENTS` env var (backend) and `VITE_MAX_TRACES` (frontend) in sync.

### 3. Type Safety

- **Dual validation:** TypeScript types + Zod schemas ensure compile-time + runtime safety.
- **Pattern:** Always use `z.infer<typeof schema>` instead of hand-rolled types.
- **SSE framing:** Maintain `data: {json}\n\n` format; heartbeat comments every 15s.

### 4. Privacy by Default

- **Hidden payloads:** Sensitive data hidden until explicitly revealed per-event.
- **Hook:** `usePrivacyStore` manages global reveal state; reuse reveal buttons from `TraceInspector.tsx`.
- **Patterns:** Respect `shouldHideData(eventId)` checks; expose via unified reveal mechanism.

### 5. Stream Control

- **Pause/Resume:** Centralized in `useStreamControl.ts` hook with client-side event buffering.
- **Keyboard:** Space bar toggles pause (not in input fields).
- **Pattern:** New stream UX features must coordinate via this hook.

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

## Coding Patterns

### 1. Input Validation (Always Untrusted)

```typescript
// /api/src/routes/ingest.ts pattern
const parsed = PayloadSchema.safeParse(body);
if (!parsed.success) {
  return ctx.json({ issues: parsed.error.issues }, 400);
}
const event = parsed.data;
eventStore.append(event);
```

### 2. SSE Response Format

```typescript
// Maintain SSE framing: "data: {json}\n\n"
ctx.header("Content-Type", "text/event-stream");
ctx.header("Cache-Control", "no-cache");
// Emit: `data: ${JSON.stringify(event)}\n\n`
// Heartbeat: `: heartbeat\n\n` every 15s
```

### 3. React Component Pattern (Privacy + Filtering)

```typescript
// /web/src/components/FilterControls.tsx pattern
const Component = () => {
  const { traces, setFilter } = useGlobalStore();
  const { shouldHideData } = usePrivacyStore();

  const handleFilterChange = (name, value) => {
    setFilter({ ...filters, [name]: value });
  };

  return (
    <div>
      {/* Use handleX* naming convention */}
    </div>
  );
};
```

### 4. TypeScript + Zod Inference

```typescript
// Define schema once, infer type
const EventSchema = z.object({
  type: z.enum(['trace', 'span']),
  trace_id: z.string(),
  // ...
});

type Event = z.infer<typeof EventSchema>;
// No manual type definitions needed
```

### 5. ESM Imports

```typescript
// Always use .js extensions for relative imports (Vite/Node bundler)
import { helper } from './utils/helpers.js';
import * as schemas from '@ariadne/shared/schemas.js';
```

## Testing Strategy

- **Unit tests:** Vitest (run `pnpm test`)
- **Golden fixtures:** Pre-computed summaries for deterministic comparisons
- **Integration scripts:** `test-*.sh` for regression checks (timeline, privacy, stream control)
- **Type safety:** `pnpm typecheck` before merging (strict mode)
- **Smoke test:** `curl http://localhost:5175/ingest` + verify browser UI

## Common Issues & Fixes

| Issue | Cause | Fix |
|-------|-------|-----|
| Type mismatches after schema edit | Forgot to rebuild shared package | Run `pnpm --filter @ariadne/shared build` |
| CORS errors in browser | `CORS_ORIGIN` env mismatch | Verify `api/config.ts` matches frontend origin |
| SSE reconnect loops | HTTPS/HTTP scheme mismatch | Ensure CORS_ORIGIN scheme matches frontend URL |
| Missing payload data | Privacy mode enabled | Click "Reveal Data" in any inspector tab |
| Large payloads rejected | Exceeds 256 KB limit | Trim in exporter before sending |
| UI doesn't update | SSE connection failed | Check browser console; verify healthz: `curl http://localhost:5175/healthz` |

## Python Exporter Integration

Reference: `/examples/python-openai-agents/http_exporter.py`

**Key patterns:**
- **Non-blocking:** Never raises on network errors; logs to stderr as `[Ariadne]` warnings.
- **Batching:** Groups events before POST to `/ingest`.
- **Redaction:** Hides secrets by default (review `PayloadPolicy` for custom patterns).
- **Hydration:** Optional OpenAI response enrichment (requires `OPENAI_API_KEY`).
- **Timeout:** Keep ≤ 2s so tracing never blocks agent loop.

## Production Readiness

Before deploying:
1. Run behind HTTPS reverse proxy if exposing beyond localhost.
2. Monitor `MAX_EVENTS` based on available RAM (10k events ≈ 20-30 MB).
3. Keep exporters non-blocking (review timeout/retry policies).
4. Back up exported events externally if long-term retention needed (Ariadne stores in memory only).
5. Run `pnpm typecheck && pnpm test` before merging.

## Contributing Checklist

- [ ] Run `pnpm install` and bootstrap shared package
- [ ] Test locally: `pnpm dev` on localhost:5173
- [ ] Run quality gates: `pnpm test && pnpm typecheck && pnpm lint`
- [ ] Respect privacy defaults (sensitive data hidden by default)
- [ ] For schema changes: update both `types.ts` and `schemas.ts`, rebuild shared
- [ ] For large features: consult `/COMPACT.md` (auto-compaction extension spec)
