# Tracing Architecture Diagram

## Complete Tracing Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Weather Agent Application                        │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1. Setup
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      set_trace_processors([...])                         │
│                                                                           │
│  ┌──────────────────────┐         ┌────────────────────────────┐       │
│  │  BatchTraceProcessor │────────▶│      HttpExporter          │       │
│  │   (SDK Built-in)     │         │   (Ariadne Integration)    │       │
│  └──────────────────────┘         └────────────────────────────┘       │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 2. Agent Execution
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         Trace Hierarchy Created                          │
│                                                                           │
│  with trace(workflow_name="Weather Agent Demo", ...):                   │
│    │                                                                      │
│    ├─▶ with custom_span(name="initialize_agent"):                       │
│    │     Agent(...)                                                      │
│    │                                                                      │
│    ├─▶ with custom_span(name="process_query_1"):                        │
│    │     │                                                                │
│    │     └─▶ Runner.run(agent, query, config=...)                       │
│    │           │                                                          │
│    │           ├─▶ [agent_span] (automatic)                              │
│    │           │     │                                                    │
│    │           │     ├─▶ [generation_span] (automatic)                   │
│    │           │     │     - Prompt                                      │
│    │           │     │     - Model parameters                            │
│    │           │     │     - Response                                    │
│    │           │     │     - Token usage                                 │
│    │           │     │                                                    │
│    │           │     └─▶ [function_span] (automatic)                     │
│    │           │           │                                              │
│    │           │           └─▶ with custom_span(name="fetch_..."):       │
│    │           │                 # Your tool implementation               │
│    │           │                                                          │
│    │           └─▶ [generation_span] (final response)                    │
│    │                                                                      │
│    └─▶ ... more queries ...                                              │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 3. Export
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           HttpExporter Pipeline                           │
│                                                                           │
│  For each Trace/Span:                                                   │
│    │                                                                      │
│    ├─▶ Extract Data                                                      │
│    │     - Timestamps (ISO 8601)                                         │
│    │     - Metadata                                                      │
│    │     - Parent/child relationships                                    │
│    │     - Span data (inputs, outputs)                                  │
│    │                                                                      │
│    ├─▶ Hydrate OpenAI Responses (if enabled)                            │
│    │     - Fetch full response via API                                  │
│    │     - Cache by response_id                                         │
│    │                                                                      │
│    ├─▶ Redact Sensitive Data                                             │
│    │     - API keys: sk-***                                              │
│    │     - Tokens: Bearer ***                                            │
│    │     - Custom patterns                                               │
│    │                                                                      │
│    ├─▶ Extract Output Text                                               │
│    │     - Score candidates                                              │
│    │     - Select best output                                            │
│    │     - Create preview                                                │
│    │     - Deduplicate blobs                                             │
│    │                                                                      │
│    └─▶ Format as Ariadne Event                                           │
│          {                                                                │
│            type: "trace" | "span",                                       │
│            trace_id: "trace_...",                                        │
│            span_id: "span_...",                                          │
│            parent_id: "span_...",                                        │
│            kind: "agent" | "generation" | "function" | "custom",        │
│            started_at: "2025-...",                                       │
│            ended_at: "2025-...",                                         │
│            data: {...},                                                   │
│            metadata: {...}                                                │
│          }                                                                │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 4. Batch & Send
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   HTTP POST to Ariadne Ingest API                        │
│                                                                           │
│  POST http://localhost:5175/ingest                                       │
│  Content-Type: application/json                                          │
│                                                                           │
│  {                                                                        │
│    "batch": [                                                             │
│      { type: "trace", ... },                                             │
│      { type: "span", ... },                                              │
│      { type: "span", ... },                                              │
│      ...                                                                  │
│    ]                                                                      │
│  }                                                                        │
│                                                                           │
│  Error Handling:                                                         │
│    ├─▶ Timeout → Retry once → Log warning                               │
│    ├─▶ HTTP Error → Log details → Continue                              │
│    └─▶ Network Error → Log warning → Continue                           │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 5. Ingest & Store
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Ariadne API Server                               │
│                                                                           │
│  POST /ingest                                                            │
│    │                                                                      │
│    ├─▶ Zod Schema Validation                                             │
│    │     - Validate structure                                            │
│    │     - Type checking                                                 │
│    │     - Required fields                                               │
│    │                                                                      │
│    ├─▶ Append to Ring Buffer                                             │
│    │     - In-memory store                                               │
│    │     - Max 10k events                                                │
│    │     - FIFO eviction                                                 │
│    │                                                                      │
│    └─▶ Broadcast via SSE                                                 │
│          - All connected clients                                         │
│          - Real-time delivery                                            │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 6. Real-time Stream
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Ariadne Web Viewer                               │
│                                                                           │
│  GET /events (SSE)                                                       │
│    │                                                                      │
│    └─▶ React UI (http://localhost:5173)                                 │
│          │                                                                │
│          ├─▶ AgentTraceTree                                              │
│          │     - Hierarchical view                                       │
│          │     - Parent-child relationships                              │
│          │     - Expand/collapse                                         │
│          │                                                                │
│          ├─▶ TraceInspector                                              │
│          │     - Detailed span view                                      │
│          │     - Metadata display                                        │
│          │     - Input/output data                                       │
│          │                                                                │
│          ├─▶ TraceTimeline                                               │
│          │     - Chronological view                                      │
│          │     - Duration visualization                                  │
│          │     - Concurrent operations                                   │
│          │                                                                │
│          └─▶ FilterControls                                              │
│                - group_id filter                                         │
│                - kind filter                                             │
│                - status filter                                           │
│                - metadata search                                         │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Example

### Single Query Execution

```
User: "What's the weather like in Paris?"

1. Application creates trace:
   ┌─────────────────────────────────────────┐
   │ Trace: "Weather Agent Demo"             │
   │ trace_id: trace_abc123...                │
   │ group_id: session_7f8e9a...              │
   │ metadata: {environment: "development"}   │
   └─────────────────────────────────────────┘

2. Custom span for query:
   ┌─────────────────────────────────────────┐
   │ Span: "process_query_1"                  │
   │ span_id: span_def456...                  │
   │ parent_id: null                          │
   │ metadata: {query_text: "What's the..."}  │
   └─────────────────────────────────────────┘

3. SDK creates agent span:
   ┌─────────────────────────────────────────┐
   │ Span: "agent.run"                        │
   │ span_id: span_ghi789...                  │
   │ parent_id: span_def456...                │
   │ kind: "agent"                            │
   └─────────────────────────────────────────┘

4. SDK creates generation span:
   ┌─────────────────────────────────────────┐
   │ Span: "generation"                       │
   │ span_id: span_jkl012...                  │
   │ parent_id: span_ghi789...                │
   │ kind: "generation"                       │
   │ data: {prompt: [...], response: [...]}   │
   └─────────────────────────────────────────┘

5. SDK creates function span:
   ┌─────────────────────────────────────────┐
   │ Span: "tool.get_weather"                 │
   │ span_id: span_mno345...                  │
   │ parent_id: span_ghi789...                │
   │ kind: "function"                         │
   │ data: {args: {location: "Paris"}}        │
   └─────────────────────────────────────────┘

6. Custom span inside tool:
   ┌─────────────────────────────────────────┐
   │ Span: "fetch_weather_data_Paris"         │
   │ span_id: span_pqr678...                  │
   │ parent_id: span_mno345...                │
   │ kind: "custom"                           │
   │ metadata: {location: "Paris"}            │
   └─────────────────────────────────────────┘

7. Exporter batches all events → POST to API → SSE to viewer
```

## Metadata Propagation

```
┌─────────────────────────────────────────────────────────────────┐
│                    Trace Level (Workflow)                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ workflow_name: "Weather Agent Demo"                       │  │
│  │ group_id: "session_7f8e9a..."                             │  │
│  │ metadata: {                                                │  │
│  │   environment: "development",                             │  │
│  │   timestamp: "2025-10-19T...",                            │  │
│  │   session_id: "session_7f8e9a..."                         │  │
│  │ }                                                          │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │            Span Level (Custom - Query)                  │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │ name: "process_query_1"                           │  │    │
│  │  │ metadata: {                                        │  │    │
│  │  │   query_number: "1",                              │  │    │
│  │  │   query_text: "What's the weather...",           │  │    │
│  │  │   session_id: "session_7f8e9a..."                │  │    │
│  │  │ }                                                  │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  │                        │                                 │    │
│  │                        ▼                                 │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │       RunConfig Level (Agent Run)                 │  │    │
│  │  │  metadata: {                                       │  │    │
│  │  │    query_number: "1",                             │  │    │
│  │  │    query_text: "What's the weather...",          │  │    │
│  │  │    session_id: "session_7f8e9a..."               │  │    │
│  │  │  }                                                 │  │    │
│  │  │  trace_include_sensitive_data: true               │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  │                        │                                 │    │
│  │                        ▼                                 │    │
│  │  ┌───────────────────────────────────────────────────┐  │    │
│  │  │    Span Level (Custom - Tool Internal)            │  │    │
│  │  │  name: "fetch_weather_data_Paris"                 │  │    │
│  │  │  metadata: {                                       │  │    │
│  │  │    location: "Paris",                             │  │    │
│  │  │    unit: "celsius"                                │  │    │
│  │  │  }                                                 │  │    │
│  │  └───────────────────────────────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘

All levels inherit trace_id and maintain parent-child relationships
```

## Key Concepts

### 1. Trace
- Represents the entire workflow
- Has a unique `trace_id`
- Contains all spans for that workflow
- Can have a `group_id` to link multiple traces (e.g., conversation)

### 2. Span
- Represents a single operation
- Has `started_at` and `ended_at` timestamps
- References its `trace_id` and optional `parent_id`
- Contains `span_data` with operation details
- Has a `kind` (agent, generation, function, custom, etc.)

### 3. Hierarchy
- Traces contain spans
- Spans can have child spans
- Forms a tree structure
- Visualized in the Ariadne viewer

### 4. Metadata
- Attached at trace, span, and run levels
- Enables filtering and searching
- Provides business context
- Persisted and displayed in viewer
