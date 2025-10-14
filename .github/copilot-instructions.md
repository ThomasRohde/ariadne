# Ariadne AI Agent Instructions

## Quick Orientation
- Local-first trace viewer: API (`api/src/**`) ingests events, caches them in the ring buffer (`eventStore.ts`, `ringBuffer.ts`), and broadcasts over SSE (`sseManager.ts`) to the Vite/React UI in `web/src/**`.
- Event lifecycle: exporter `POST /ingest` → Zod validation → append to in-memory store → `GET /events` stream (`data: {json}\n\n`) → React `App.tsx` filters/renders `AgentTraceTree` and `TraceInspector`.
- Shared types live in `packages/shared`; both API and web import the emitted `.d.ts` files, so rebuild the package whenever `schemas.ts` or `types.ts` change.
- Everything runs on localhost, bounded by `MAX_EVENTS` (default 10k) before eviction; no DB/auth layers to patch.

## Core Workflows
- Install & bootstrap with `pnpm install` then `pnpm --filter @ariadne/shared build`; run dev stack via `pnpm dev` (API :5175, web :5173).
- After editing shared schemas, rerun the shared build before restarting other packages; missing this is the most common cause of stale types.
- Run `pnpm test` (Vitest across packages) and `pnpm typecheck` (strict TS) before shipping; integration scripts (`test-timeline.sh`, `test-privacy.sh`) live at repo root for regression checks.
- For manual smoke tests use `curl http://localhost:5175/ingest` and watch the UI; `/healthz` confirms the API is up.

## Coding Patterns
- Treat all external payloads as untrusted: follow the pattern in `api/src/routes/ingest.ts` to `safeParse` before touching the store; return structured 400 responses on failure.
- Server responses must preserve SSE framing (`data: ...` + blank line) and heartbeat comments; see `createEventStream` + `SseManager.broadcast` before tweaking.
- Maintain `.js` extensions on relative imports (ESM bundler resolution) and lean on `z.infer<schema>` instead of hand-rolled types.
- React side relies on Zustand (`usePrivacyStore`, `useStreamControl`) with event handlers prefixed `handle*`; keep new components consistent with `web/src/components/FilterControls.tsx` and friends.
- Privacy defaults matter: respect `shouldHideData(eventId)` and reuse the reveal mechanics in `TraceInspector.tsx` when exposing payloads.

## Integration Hooks
- Python exporter reference lives in `examples/python-openai-agents/http_exporter.py`; it batches, redacts, and never raises on network failures—mirror that non-blocking behavior in new exporters.
- Keyboard + buffering logic is centralized in `useStreamControl.ts`; if you add stream UX features, coordinate via this hook instead of ad-hoc state.
- Timeline rendering and trace grouping flow through `web/src/utils/traceTree.ts` and `TraceTimeline.tsx`; update both when adjusting hierarchy or duration math.

## Process Expectations
- Significant capability or schema changes go through OpenSpec (`openspec/AGENTS.md`, `openspec/changes/**`); scaffold a change, run `openspec validate <change-id> --strict`, then implement.
- When raising `MAX_EVENTS` or mutating eviction policy, adjust both the store constants and client limits (`VITE_MAX_TRACES`) to avoid UI drift.
- Before touching SSE endpoints, verify CORS and origin settings (`api/config.ts`, `web/src/config.ts`) to keep reconnect loops at bay.

## Helpful References
- API store internals: `api/src/store/eventStore.ts`, `ringBuffer.ts`
- SSE wiring: `api/src/routes/events.ts`, `api/src/store/sseManager.ts`
- UI entry points: `web/src/App.tsx`, `web/src/components/TraceInspector.tsx`
- Config + build: root `README.md`, `pnpm-workspace.yaml`
