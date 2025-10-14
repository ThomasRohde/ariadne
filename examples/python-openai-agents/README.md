# Ariadne + OpenAI Agents SDK Example

This example demonstrates how to integrate the OpenAI Agents SDK with Ariadne's real-time trace viewer.

## Overview

The example creates a Weather Assistant agent that can:
- Fetch current weather for any location
- Explain weather-related terminology
- Handle multiple queries with tool usage

All agent traces (LLM calls, tool usage, spans) are automatically exported to Ariadne for real-time visualization.

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

The agent will process three example queries:
1. "What's the weather like in Paris?"
2. "Compare the weather in London and Tokyo"
3. "What does humidity mean?"

Each query will show the agent's response.

### In the Ariadne Viewer (http://localhost:5173)

You'll see real-time trace events including:
- **Trace events**: Overall agent execution
- **LLM spans**: Model calls with token usage
- **Tool spans**: Function calls with inputs/outputs
- **Timing information**: Duration of each operation
- **Hierarchical view**: Parent-child relationships between spans

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

### 1. Exporter Configuration

```python
from http_exporter import HttpExporter
from agents.tracing import set_trace_processors
from agents.tracing.processors import BatchTraceProcessor

# Configure Ariadne exporter
set_trace_processors([
    BatchTraceProcessor(HttpExporter("http://localhost:5175/ingest"))
])
```

### 2. Agent Creation

```python
agent = Agent(
    model="gpt-4o-mini",
    name="Weather Assistant",
    instructions="...",
    tools=[get_weather, explain_weather_term]
)
```

### 3. Automatic Tracing

All agent operations are automatically traced:
- LLM API calls
- Tool invocations
- Agent reasoning steps

### 4. Real-time Export

The `HttpExporter` batches and sends events to Ariadne:
- Non-blocking (agent continues even if export fails)
- Automatic batching for efficiency
- ISO 8601 timestamps
- Privacy-aware (respects SDK settings)

## Customization

### Change the Model

```python
agent = Agent(
    model="gpt-4",  # or "gpt-3.5-turbo", etc.
    ...
)
```

### Add Your Own Tools

```python
def my_custom_tool(param: str) -> str:
    """Tool description for the agent."""
    return f"Result: {param}"

agent = Agent(
    tools=[my_custom_tool, get_weather, explain_weather_term]
)
```

### Adjust Ariadne Endpoint

```python
# In .env file
ARIADNE_ENDPOINT=http://your-server:5175/ingest
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

1. Check API server is running: `curl http://localhost:5175/healthz`
2. Check Web UI is running: Open http://localhost:5173
3. Check network in browser dev tools for SSE connection
4. Review terminal output for export errors

### Connection Errors

The exporter is non-blocking. If it can't reach Ariadne, it will:
- Print a warning to stderr
- Continue agent execution
- Not crash your application

## Learn More

- [Ariadne Documentation](../../README.md)
- [OpenAI Agents SDK](https://github.com/openai/openai-agents-python)
- [Feature Specification](../../specs/001-create-a-specification/spec.md)

## License

Same as the parent Ariadne project.
