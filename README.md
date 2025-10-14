<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-green.svg" alt="License: MIT"></a>
  <a href="https://pnpm.io"><img src="https://img.shields.io/badge/pnpm-8.x-ffd23f.svg" alt="pnpm"></a>
  <a href="docs/PRD.md"><img src="https://img.shields.io/badge/Spec-PRD-blue.svg" alt="PRD"></a>
</p>

# Ariadne Trace Viewer

A lightning-fast, local trace viewer for the OpenAI Agents SDK.

Ariadne is a production-ready, local-first trace viewer that streams OpenAI Agents SDK telemetry to a rich React UI in under a second. The stack is intentionally simple—Hono API, in-memory ring buffer, SSE fan-out, and a Vite frontend—so teams can introspect agents without provisioning cloud infrastructure or third-party tooling.

> ✅ Five minutes from clone to streaming traces. No database. No auth. Everything stays on localhost.

## Table of Contents

1. [Why Ariadne](#why-ariadne)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Feature Highlights](#feature-highlights)
5. [Using the Python Exporter](#using-the-python-exporter)
6. [API Reference](#api-reference)
7. [Web UI Walkthrough](#web-ui-walkthrough)
8. [Configuration](#configuration)
9. [Development Workflow](#development-workflow)
10. [Production Readiness Checklist](#production-readiness-checklist)
11. [Troubleshooting](#troubleshooting)
12. [Contributing](#contributing)
13. [License](#license)

## Why Ariadne

**Name origin:** Ariadne handed Theseus a crimson thread so he could brave the labyrinth, slay the Minotaur, and still find his way back out. The trace viewer plays the same role—capturing every span, tool call, and decision so you can rewind an agent run, follow the thread of execution, and fix the monster hiding in a maze of logs.

- **Local-first debugging:** Keep confidential traces on your workstation while iterating on agents.
- **Real-time visibility:** Server-Sent Events deliver <1s latency from ingress to UI.
- **Privacy controls:** Sensitive payloads stay hidden until explicitly revealed.
- **Agent-native exporters:** Drop-in Python http exporter mirrors the OpenAI dashboard semantics.
- **Minimal surface area:** The entire runtime is a single Node process plus a React client served via Vite.

## Quick Start

### Prerequisites

- Node.js 20+
- `pnpm` 8+

### Install & Run

```bash
git clone https://github.com/your-org/ariadne.git
cd ariadne

# Install workspace dependencies
pnpm install

# Build the shared types (API + web depend on this output)
pnpm --filter @ariadne/shared build

# Launch the API (5175) and Web UI (5173) together
pnpm dev
```

Open http://localhost:5173 to view traces. A health probe is available at http://localhost:5175/healthz.

### Smoke Test with curl

```bash
curl -X POST http://localhost:5175/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "type": "trace",
    "trace_id": "demo-trace",
    "name": "Weather agent run",
    "started_at": "2025-10-14T10:00:00Z",
    "ended_at": "2025-10-14T10:00:06Z",
    "metadata": { "team": "agents" }
  }'

curl -X POST http://localhost:5175/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "type": "span",
    "trace_id": "demo-trace",
    "span_id": "fetch-weather",
    "kind": "tool.run",
    "name": "Call Weather API",
    "started_at": "2025-10-14T10:00:01Z",
    "ended_at": "2025-10-14T10:00:04Z",
    "data": { "location": "Berlin", "status": "200" },
    "status": "ok"
  }'
```

## Architecture

```
┌─────────────────────────┐      POST /ingest       ┌─────────────────────┐
│ Agents SDK application │ ───────────────────────▶ │ Hono API (Node 20+) │
└─────────────────────────┘                        └────────┬────────────┘
                                                            │
                                                In-memory ring buffer
                                                            │
                                      SSE /events fan-out   ▼
                                                  ┌───────────────────────┐
                                                  │ React + Vite UI       │
                                                  │ (localhost:5173)      │
                                                  │ • OpenAI-style layout │
                                                  │ • Tabbed inspector    │
                                                  │ • Real-time tree view │
                                                  └───────────────────────┘
```

- **API:** Hono router validates payloads with Zod, appends to the `EventStore`, and broadcasts via SSE.
- **Storage:** Bounded ring buffer with trace index (default 10k events) prevents unbounded memory growth.
- **Frontend:** React with shadcn/ui components, consuming SSE stream via hooks. Renders hierarchical trace tree with type-specific icons and tabbed inspector panel.
- **Privacy:** `usePrivacyStore` keeps sensitive payloads hidden until per-item reveal across all inspector tabs.
- **Stream Control:** `useStreamControl` manages pause/resume with client-side buffering.

## Feature Highlights

- **Real-time streaming** with automatic reconnect and pause/resume buffering.
- **OpenAI-inspired UI** with professional cyan/teal color scheme, left sidebar navigation, and tabbed inspector.
- **Hierarchical trace tree** with type-specific icons (Agent, Tool, Handoff, API) and inline duration bars.
- **Tabbed inspector interface** with Response, Properties, and Raw JSON views for detailed analysis.
- **Advanced filtering** by trace ID, span kind, event type, and free-text search across names and payloads.
- **Privacy-first design:** Data payloads hidden by default with unified reveal buttons across all inspector tabs.
- **Keyboard shortcuts** (Space toggles stream pause). Buffered event counter while paused.
- **Resizable panels** with desktop drag-to-resize and keyboard controls.
- **Dark/light theme support** with integrated theme toggle in sidebar.
- **Optional OpenAI response hydration** when using the Python exporter with an API key.

## UI Design

The interface follows OpenAI's trace dashboard aesthetic with a clean, professional appearance:

### Visual Design
- **Primary color:** Cyan/teal (#06B6D4) for actions, agent icons, and primary UI elements
- **Background:** Pure white in light mode, dark gray in dark mode
- **Typography:** Inter font family with clear weight hierarchy, monospace for technical identifiers
- **Spacing:** Generous whitespace with consistent padding and vertical rhythm

### Color-Coded Elements
- **Cyan:** Agent spans and primary actions
- **Green:** Tool/function calls
- **Orange:** Handoffs and in-progress spans
- **Gray:** API calls and secondary elements
- **Rose:** Error states

### Status Indicators
- **Connection badge:** Green (connected), amber (connecting), red (disconnected)
- **Timeline bars:** Solid bars for complete spans, dashed outlines for incomplete spans
- **Duration display:** Inline text showing span execution time

## Using the Python Exporter

The repo ships with a production-grade exporter at `examples/python-openai-agents/http_exporter.py`. It batches trace/span events, redacts secrets, and optionally hydrates OpenAI response IDs.

### 1. Install dependencies

```bash
cd examples/python-openai-agents
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 2. Run the sample weather agent

```bash
export ARIADNE_ENDPOINT="http://localhost:5175/ingest"
python weather_agent.py
```

### 3. Embed in your own project

```python
from agents.tracing import set_trace_processors
from agents.tracing.processors import BatchTraceProcessor
from http_exporter import HttpExporter

endpoint = os.getenv("ARIADNE_ENDPOINT", "http://localhost:5175/ingest")
exporter = HttpExporter(endpoint=endpoint, timeout=2.0, hydrate_openai=True)

set_trace_processors([
    BatchTraceProcessor(exporter)
])
```

**Best practices**

- Keep `timeout` ≤ 2s so tracing never blocks the main agent loop.
- Redaction is enabled by default; review `PayloadPolicy` for keys/patterns you need to extend.
- Hydration requires `OPENAI_API_KEY`; disable with `hydrate_openai=False` if unavailable.
- The exporter never raises on network errors; monitor stderr for `[Ariadne]` warnings.

## API Reference

### POST `/ingest`

- Accepts a single trace/span event or `{ "batch": [ ... ] }`.
- Validates against shared Zod schemas; returns `400` with issue details on failure.
- Rejects payloads > 256 KB and trims oversize strings.

### GET `/events`

- SSE stream (`text/event-stream`). Emits one JSON payload per event.
- Query params: `traceId`, `kinds` (comma-separated), `since` (ISO timestamp).
- Emits heartbeat comments every 15 seconds to keep proxies alive.

### GET `/healthz`

- Returns `{ "status": "ok" }` for readiness/liveness checks.

## Web UI Walkthrough

The UI follows an OpenAI-inspired dashboard aesthetic with a professional cyan/teal color scheme and clean, minimal design.

### Layout Structure

- **Left Sidebar (60px):** Vertical icon-based navigation with Dashboard, Logs, Storage, Settings, and theme toggle buttons.
- **Top Header:** Application title ("Ariadne Trace Viewer"), connection status badge, and stream controls (pause/resume with keyboard shortcut support via Space bar).
- **Main Split View:** Resizable two-panel layout with trace explorer on the left and inspector on the right.

### Trace Explorer (Left Panel)

- **Hierarchical tree view** showing "Triage Agent" with nested traces and spans in a clean, flat list style.
- **Type-specific icons** for visual recognition (Agent: cyan, Tool: green, Handoff: orange, API: gray).
- **Inline timeline bars** (48px wide) showing span duration with color coding:
  - Cyan for normal spans
  - Amber for in-progress (missing `ended_at`)
  - Rose for errors
- **Expandable/collapsible** trace groups with clear indentation hierarchy.
- **Status badges** for `type`, `kind`, `status` on each item.
- **Trace count display** showing total number of filtered traces.

### Inspector (Right Panel)

Tabbed interface with three views:

- **Response Tab:** Displays extracted model output/response data with expand/collapse for long content. Shows "Reveal Data" button when privacy mode is active.
- **Properties Tab:** Shows configuration and data sections with clean key-value pairs. Data section includes a reveal button when hidden.
- **Raw Tab:** JSON payload view with syntax highlighting. Protected by privacy mode with reveal button.

### Privacy Controls

- **Global privacy toggle** available in the left sidebar settings (not currently exposed in UI but accessible via code).
- **Per-event reveal buttons** in all three inspector tabs - clicking "Reveal Data" in any tab reveals data across all tabs for that span.
- **Privacy-first default:** Sensitive payloads are hidden on first load until explicitly revealed.

### Stream Controls

- **Pause/Resume button** in top header - pauses the incoming event stream and buffers new events.
- **Buffered event counter** badge appears when paused, showing how many events are waiting.
- **Keyboard shortcut:** Press Space to toggle pause/resume (when not focused in input fields).
- **Clear button** to remove all events and reset the view.

### Panel Resizing

- **Adjustable inspector width:** Drag the 1px resize handle between panels (desktop only).
- **Constraints:** Min explorer 400px, inspector 380-800px, default 550px.
- **Keyboard resize:** Arrow keys when handle is focused.

## Configuration

Environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `5175` | API listen port (binds to 127.0.0.1 by default). |
| `MAX_EVENTS` | `10000` | Ring buffer size before oldest events are evicted. |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed origin for the web client. |
| `VITE_API_URL` | `http://localhost:5175` | Frontend SSE/API base URL. |
| `VITE_MAX_TRACES` | `200` | Client-side trace retention limit. |

## Development Workflow

- `pnpm dev` – run API and web concurrently.
- `pnpm test` – run Vitest suites across packages.
- `pnpm typecheck` – strict TypeScript validation (required before merging).
- `pnpm build` – build shared types, API, and web bundles.
- `test-*.sh` – integration scripts for timeline, privacy, performance, stream control.

After touching `packages/shared`, rerun `pnpm --filter @ariadne/shared build` before restarting services.

## Production Readiness Checklist

- [ ] Run behind an HTTPS reverse proxy if exposing beyond localhost.
- [ ] Increase `MAX_EVENTS` cautiously based on available RAM (approx 10k events ≈ 20–30 MB).
- [ ] Keep exporters non-blocking: review timeout/retry policies.
- [ ] Monitor stderr logs for exporter delivery failures.
- [ ] Back up exported events externally if long-term retention is required (Ariadne stores in memory only).

## Troubleshooting

- **Nothing in the UI?** Verify `curl http://localhost:5175/healthz` returns ok and check browser console for CORS errors.
- **SSE reconnect loops?** Ensure `CORS_ORIGIN` matches the scheme+origin serving the frontend.
- **Missing span payloads?** Privacy mode hides data by default—click the "Reveal Data" button in any inspector tab (Response, Properties, or Raw) to show sensitive data.
- **Response tab shows "No response data available"?** Check if privacy mode is hiding the data. Click "Reveal Data" to see if there's actual response content.
- **Large payload drops?** `/ingest` caps body size at 256 KB; trim data in exporters before sending.
- **Type mismatches?** Run `pnpm typecheck` to surface schema drift early.
- **Panels not resizing?** Resize handle only works on desktop (lg breakpoint, 1024px+). Use mouse drag or arrow keys when focused on the handle.

## Contributing

Issues and pull requests are welcome. Please run `pnpm test && pnpm typecheck` and follow the privacy defaults when adding new features. For larger changes, consult `openspec/AGENTS.md` and open a proposal before coding.

## License

MIT. See [LICENSE](LICENSE) for details.

---

Built with Hono, React, Vite, TypeScript, and Zod to bring OpenAI agent traces to your terminal in real time.
