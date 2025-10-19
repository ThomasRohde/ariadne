# Ariadne + OpenAI Agents SDK Example

This example demonstrates comprehensive tracing integration between the OpenAI Agents SDK and Ariadne's real-time trace viewer, showcasing advanced tracing patterns and best practices.

## Overview

The example creates a Weather Assistant agent that demonstrates:
- **Tool usage**: Fetch current weather for locations
- **Knowledge retrieval**: Explain weather-related terminology
- **Multi-tool queries**: Handle complex queries using multiple tools
- **Comprehensive tracing**: Higher-level traces, custom spans, metadata, and error tracking

All agent operations are automatically traced and exported to Ariadne for real-time visualization with rich context.

## Tracing Features Demonstrated

This example showcases the full spectrum of OpenAI Agents SDK tracing capabilities:

### 1. **Automatic Tracing**
- LLM generation spans with full request/response data
- Function tool calls with inputs and outputs
- Agent execution spans with reasoning steps
- Hierarchical span relationships

### 2. **Higher-Level Trace Wrapping**
```python
with trace(
    workflow_name="Weather Agent Demo",
    group_id=session_id,
):
    # Multiple agent runs grouped under single trace
    result = await Runner.run(agent, query)
```

### 3. **Custom Spans**
```python
with custom_span(name=f"fetch_weather_data_{location}_{unit}"):
    # Track custom operations with descriptive names
    # Include parameter values in the name for context
```

### 4. **Simple Agent Runs**
```python
# Clean, simple API with automatic tracing
result = await Runner.run(agent, query)
```

### 5. **Session Grouping**
- All queries in a single run share a `group_id`
- Easy filtering and correlation in the viewer
- Conversation thread tracking

### 6. **Error Tracing**
- Automatic error capture with stack traces
- Error spans linked to parent operations
- Graceful degradation on failures

## Prerequisites

1. **OpenAI API Key**: You need an OpenAI API key to run the agent
2. **Ariadne API Server**: Must be running on `http://localhost:5175`
3. **Python 3.11+**: Required for the OpenAI Agents SDK
4. **uv**: Package manager (recommended)

## Quick Start

### 1. Setup Environment

```bash
# Navigate to this directory
cd examples/python-openai-agents

# Create and activate virtual environment with uv
uv venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install the example and its dependencies
uv pip install .
```

### 2. Configure API Key

```bash
# Copy environment template
cp .env.example .env

# Edit .env and add your OpenAI API key
# OPENAI_API_KEY=sk-your-key-here
```

### 3. Start Ariadne Services

In separate terminals:

```bash
# Terminal 1: Start API server
cd ../../packages/api
pnpm dev

# Terminal 2: Start Web UI
cd ../../packages/web
pnpm dev
```

The Ariadne viewer will be available at: http://localhost:5173

### 4. Run the Example

After installation, the entry point is available as `ariadne-weather-agent`:

```bash
# In the examples/python-openai-agents directory
ariadne-weather-agent
```

## What You'll See

### In the Terminal

The agent will process four example queries demonstrating different capabilities:
1. **Simple query**: "What's the weather like in Paris?"
2. **Multi-tool comparison**: "Compare the weather in London and Tokyo"
3. **Knowledge retrieval**: "What does humidity mean?"
4. **Complex multi-tool**: "Tell me about the weather in Sydney and explain what dew point means"

Each query shows:
- Query number and text
- Agent's response
- Trace and session IDs for correlation

Example output:
```
📊 Trace ID: trace_abc123def456...
🔗 Session ID: session_7f8e9a0b1c2d

[Query 1] What's the weather like in Paris?
--------------------------------------------------------------
[Response] The current weather in Paris is 18°C with partly cloudy conditions...
```

### In the Ariadne Viewer (http://localhost:5173)

You'll see comprehensive trace visualization with:

#### **Trace Hierarchy**
```
Weather Agent Demo (trace)
├── initialize_agent (custom_span)
├── process_query_1 (custom_span)
│   ├── agent.run (agent_span)
│   │   ├── generation (generation_span)
│   │   └── tool.get_weather (function_span)
│   │       └── fetch_weather_data_Paris (custom_span)
├── process_query_2 (custom_span)
│   ├── agent.run (agent_span)
│   │   ├── generation (generation_span)
│   │   ├── tool.get_weather → London (function_span)
│   │   ├── tool.get_weather → Tokyo (function_span)
│   │   └── generation (generation_span)
...
```

#### **Rich Span Details**
- **Metadata**: Query numbers, session IDs, custom tags
- **Timing**: Start/end timestamps, duration
- **Inputs/Outputs**: Full request and response data
- **Token Usage**: Model consumption metrics
- **Error Context**: Stack traces when failures occur

#### **Filtering & Navigation**
- Filter by `group_id` to see all queries in a session
- Filter by span `kind` (agent, generation, function, custom)
- Navigate parent-child relationships
- Timeline view of concurrent operations

## Project Structure

```
examples/python-openai-agents/
├── README.md              # This file
├── requirements.txt       # Python dependencies (mirrors pyproject metadata)
├── requirements-dev.txt   # Development dependencies
├── pyproject.toml         # Project metadata, tools, and entry point
├── .env.example           # Environment template
├── weather_agent.py       # Main example application
└── .venv/                 # Virtual environment (gitignored)
```

## How It Works

### 1. Trace Processor Setup

The exporter is configured as a custom trace processor for the OpenAI Agents SDK:

```python
from http_exporter import HttpExporter, PayloadPolicy
from agents.tracing import set_trace_processors
from agents.tracing.processors import BatchTraceProcessor

# Configure policy for payload handling
policy = PayloadPolicy(
    preview_chars=8000,        # Preview length for large outputs
    max_blob_bytes=10 * 1024 * 1024,  # 10MB blob limit
    blob_cache_size=1024,      # Deduplication cache
)

# Create exporter with Ariadne endpoint
exporter = HttpExporter(
    endpoint="http://localhost:5175/ingest",
    timeout=3.0,
    debug=False,               # Enable for troubleshooting
    hydrate_openai=True,       # Fetch full OpenAI responses
    policy=policy,
)

# Register as trace processor
set_trace_processors([BatchTraceProcessor(exporter)])
```

### 2. Higher-Level Trace Wrapping

Group multiple agent runs under a single workflow trace:

```python
# Generate session ID for grouping
session_id = f"session_{uuid.uuid4().hex[:12]}"

# Wrap entire workflow in a trace
with trace(
    workflow_name="Weather Agent Demo",
    group_id=session_id,
    metadata={
        "environment": "development",
        "timestamp": datetime.now().isoformat(),
        "session_id": session_id,
    }
) as demo_trace:
    # All operations here share the same trace
    for query in queries:
        result = await Runner.run(agent, query)
```

### 3. Custom Spans for Operations

Add custom instrumentation for internal operations:

```python
@function_tool
def get_weather(location: str, unit: str = "celsius") -> dict:
    # Create custom span with descriptive name including parameters
    with custom_span(name=f"fetch_weather_data_{location}_{unit}"):
        # Your implementation here
        data = fetch_data(location)
    return data
```

### 4. Simple Agent Runs

The API is clean and simple - just pass the agent and query:

```python
result = await Runner.run(agent, query)
```

Tracing happens automatically through the configured trace processor.

### 5. Export Pipeline

The `HttpExporter` handles:
- **Batching**: Efficient grouping of events
- **Hydration**: Fetching full OpenAI response objects via API
- **Redaction**: Removing sensitive data (API keys, tokens)
- **Deduplication**: Caching large outputs by hash
- **Error handling**: Non-blocking failures, automatic retries
- **Formatting**: Converting SDK spans to Ariadne event format

## Automatic SDK Tracing

The SDK automatically creates spans for:
- **Agent runs**: `agent_span()` wraps each agent execution
- **LLM generations**: `generation_span()` captures model calls
- **Tool calls**: `function_span()` tracks tool invocations
- **Errors**: Exceptions are automatically captured with context

## Customization

### Disable Tracing Globally

```bash
# Set environment variable
export OPENAI_AGENTS_DISABLE_TRACING=1
```

### Change the Model

```python
agent = Agent(
    model="gpt-4",  # or "gpt-4o", "gpt-3.5-turbo", etc.
    name="Weather Assistant",
    ...
)
```

### Add Custom Tools

```python
from agents import function_tool

@function_tool
def my_custom_tool(param: str) -> str:
    """Tool description shown to the agent."""
    # Optionally add custom span for internal tracking
    with custom_span(name=f"my_operation_{param}"):
        result = process(param)
    return result

agent = Agent(
    tools=[my_custom_tool, get_weather, explain_weather_term]
)
```

### Adjust Ariadne Endpoint

```bash
# In .env file
ARIADNE_ENDPOINT=http://your-server:5175/ingest
```

### Enable Debug Mode

```bash
# In .env file
ARIADNE_DEBUG=true
```

This will print:
- Payload previews before sending
- Hydration attempts and results
- Export success/failure details

### Custom Payload Policy

```python
from http_exporter import PayloadPolicy

# Customize data handling
policy = PayloadPolicy(
    preview_chars=5000,           # Longer previews
    max_blob_bytes=20 * 1024 * 1024,  # 20MB blobs
    blob_cache_size=2048,         # Larger cache
    redact_keys=("api_key", "password", "secret", "token"),
    redact_patterns=(
        re.compile(r"sk-[A-Za-z0-9]{20,}"),  # API keys
        re.compile(r'Bearer\s+[A-Za-z0-9\-_\.=]{10,}'),  # Tokens
    ),
)

exporter = HttpExporter(policy=policy)
```

## Development

### Install Development Dependencies

```bash
uv pip install -r requirements-dev.txt
```

### Run Tests (when added)

```bash
pytest
```

### Code Formatting

```bash
ruff check .
ruff format .
```

## Troubleshooting

### "Error: openai-agents not installed"

```bash
uv pip install -r requirements.txt
```

### "Error: OPENAI_API_KEY not set"

Make sure you've created a `.env` file with your API key:

```bash
cp .env.example .env
# Edit .env and add your key
```

### Traces Not Appearing in Viewer

1. **Check API server is running**: 
   ```bash
   curl http://localhost:5175/healthz
   ```

2. **Check Web UI is running**: Open http://localhost:5173

3. **Enable debug mode** to see what's being sent:
   ```bash
   export ARIADNE_DEBUG=true
   ariadne-weather-agent
   ```

4. **Check network**: Browser dev tools → Network tab → Filter for SSE

5. **Verify endpoint**: Make sure the API server is on the correct port

### Connection Errors

The exporter is non-blocking and fault-tolerant:
- **Timeouts**: Retries once, then continues
- **HTTP errors**: Logs error details, doesn't crash
- **Network failures**: Prints warning, continues execution

Your agent will always complete successfully even if tracing fails.

### Traces Appear But Missing Data

1. **Check sensitive data setting**:
   ```python
   config = RunConfig(trace_include_sensitive_data=True)
   ```

2. **Check payload policy limits**:
   ```python
   policy = PayloadPolicy(
       preview_chars=8000,  # Increase if truncated
       max_blob_bytes=10 * 1024 * 1024,  # Increase for large data
   )
   ```

3. **Verify hydration is enabled**:
   ```python
   exporter = HttpExporter(
       hydrate_openai=True,  # Requires OPENAI_API_KEY
   )
   ```

### Performance Issues

If the agent is slow due to tracing:

1. **Disable hydration** (avoids extra API calls):
   ```python
   exporter = HttpExporter(hydrate_openai=False)
   ```

2. **Reduce preview size**:
   ```python
   policy = PayloadPolicy(preview_chars=2000)
   ```

3. **Increase timeout** for slow networks:
   ```python
   exporter = HttpExporter(timeout=5.0)
   ```

## Learn More

### Documentation
- **[Agent Tracing Guide](./AGENT_TRACING_GUIDE.md)** - ⭐ **START HERE** - Complete guide with only working patterns
- [Quick Reference](./QUICK_REFERENCE.md) - Quick lookup for common patterns
- [API Corrections](./API_CORRECTIONS.md) - Explains differences from official docs
- [Architecture Diagram](./ARCHITECTURE.md) - Visual flow of tracing pipeline

### OpenAI Agents SDK
- [Official Tracing Documentation](https://openai.github.io/openai-agents-python/tracing/)
- [Traces and Spans](https://openai.github.io/openai-agents-python/tracing/#traces-and-spans)
- [Creating Custom Spans](https://openai.github.io/openai-agents-python/tracing/#creating-spans)
- [RunConfig Reference](https://openai.github.io/openai-agents-python/ref/run/#agents.run.RunConfig)
- [Tracing API Reference](https://openai.github.io/openai-agents-python/ref/tracing/)

### Ariadne
- [Main Documentation](../../README.md)
- [Architecture Overview](../../.github/copilot-instructions.md)
- [API Endpoints](../../api/src/routes/)
- [Event Schemas](../../packages/shared/src/schemas.ts)

### Related Resources
- [OpenAI Agents SDK GitHub](https://github.com/openai/openai-agents-python)
- [OpenAI Platform - Traces Dashboard](https://platform.openai.com/traces)
- [External Trace Processors](https://openai.github.io/openai-agents-python/tracing/#external-tracing-processors-list)

## Advanced Patterns

### Multi-Agent Workflows

Group multiple agents under a single trace:

```python
with trace(workflow_name="Multi-Agent System", group_id=session_id):
    # First agent
    research_result = await Runner.run(research_agent, query)
    
    # Second agent using first's output
    with custom_span(name="synthesis_phase"):
        synthesis_result = await Runner.run(
            synthesis_agent, 
            research_result.final_output
        )
```

### Conditional Tracing

Enable tracing only for certain conditions:

```python
if os.getenv("ENVIRONMENT") == "development":
    trace_enabled = True
else:
    trace_enabled = False

config = RunConfig(tracing_disabled=not trace_enabled)
```

### Error Recovery with Tracing

```python
with custom_span(name="query_with_retry", metadata={"max_retries": 3}):
    for attempt in range(3):
        try:
            result = await Runner.run(agent, query)
            break
        except Exception as e:
            if attempt == 2:
                raise  # Final attempt, let error propagate
            # Error is automatically captured in trace
            await asyncio.sleep(1 * (attempt + 1))
```

### Session Management

```python
# Track user sessions across multiple interactions
user_session_id = f"user_{user_id}_session_{session_num}"

with trace(
    workflow_name="Customer Service Bot",
    group_id=user_session_id,
    metadata={
        "user_id": user_id,
        "session_number": session_num,
        "start_time": datetime.now().isoformat(),
    }
):
    for message in conversation:
        result = await Runner.run(agent, message)
```

## License

Same as the parent Ariadne project.
