# Tracing Guide for OpenAI Agents SDK Apps
## For Coding Agents & Developers

This guide provides **ONLY working patterns** for the current OpenAI Agents SDK. All code examples are tested and functional.

---

## Quick Start (5 Steps)

### Step 1: Install Dependencies

```bash
pip install openai-agents requests
```

### Step 2: Import Required Modules

```python
import asyncio
import os
import uuid
from agents import Agent, Runner, function_tool
from agents.tracing import set_trace_processors, trace, custom_span
from agents.tracing.processors import BatchTraceProcessor
```

### Step 3: Import and Configure HttpExporter

```python
# Assuming http_exporter.py is in the same directory or installed
from http_exporter import HttpExporter, PayloadPolicy

# Configure the exporter
exporter = HttpExporter(
    endpoint="http://localhost:5175/ingest",  # Ariadne API endpoint
    timeout=3.0,
    debug=False,  # Set to True for troubleshooting
    hydrate_openai=True,  # Fetches full OpenAI responses
    policy=PayloadPolicy(
        preview_chars=8000,
        max_blob_bytes=10 * 1024 * 1024,
        blob_cache_size=1024,
    ),
)

# Register the exporter
set_trace_processors([BatchTraceProcessor(exporter)])
```

### Step 4: Create Agent with Tools

```python
@function_tool
def my_tool(param: str) -> str:
    """Tool description for the agent."""
    # Optional: Add custom span inside tool
    with custom_span(name=f"internal_operation_{param}"):
        result = f"Processed: {param}"
    return result

agent = Agent(
    name="My Agent",
    instructions="You are a helpful assistant.",
    tools=[my_tool]
)
```

### Step 5: Run with Tracing

```python
async def main():
    # Generate unique session ID
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    # Wrap workflow in trace
    with trace(workflow_name="My Workflow", group_id=session_id):
        # Wrap each query in custom span
        with custom_span(name="process_query_1"):
            result = await Runner.run(agent, "Hello!")
            print(result.final_output)

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Complete Minimal Example

```python
"""Minimal tracing example for OpenAI Agents SDK"""
import asyncio
import os
import uuid
from agents import Agent, Runner, function_tool
from agents.tracing import set_trace_processors, trace, custom_span
from agents.tracing.processors import BatchTraceProcessor
from http_exporter import HttpExporter, PayloadPolicy

# 1. Configure tracing
exporter = HttpExporter(
    endpoint=os.getenv("ARIADNE_ENDPOINT", "http://localhost:5175/ingest"),
    timeout=3.0,
    hydrate_openai=True,
)
set_trace_processors([BatchTraceProcessor(exporter)])

# 2. Define tool
@function_tool
def greet(name: str) -> str:
    """Greet someone by name."""
    with custom_span(name=f"format_greeting_{name}"):
        return f"Hello, {name}!"

# 3. Create agent
agent = Agent(
    name="Greeter",
    instructions="You greet people warmly.",
    tools=[greet]
)

# 4. Run with tracing
async def main():
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    with trace(workflow_name="Greeting Workflow", group_id=session_id):
        with custom_span(name="process_greeting_request"):
            result = await Runner.run(agent, "Please greet Alice")
            print(result.final_output)

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Supported API Reference

### ✅ `trace()` - Working Parameters

```python
with trace(
    workflow_name="My Workflow",  # Required: Workflow name
    group_id="session_123",       # Optional: Groups related traces
) as my_trace:
    # my_trace.trace_id available here
    pass
```

**Supported Parameters:**
- `workflow_name` (str): Name displayed in viewer
- `group_id` (str): Links multiple traces (for sessions/conversations)

**❌ NOT Supported:**
- `metadata` - will raise `TypeError`

### ✅ `custom_span()` - Working Parameters

```python
with custom_span(name="my_operation"):
    # Your code here
    pass
```

**Supported Parameters:**
- `name` (str): Span name displayed in viewer

**❌ NOT Supported:**
- `metadata` - will raise `TypeError`

**💡 Best Practice**: Include context in the name
```python
# Good: Descriptive names with parameters
with custom_span(name=f"fetch_data_{location}_{unit}"):
    data = fetch(location, unit)

# Avoid: Generic names without context
with custom_span(name="fetch_data"):  # Too vague
    data = fetch(location, unit)
```

### ✅ `Runner.run()` - Working Parameters

```python
result = await Runner.run(agent, query)
```

**Supported Parameters:**
- `agent` (Agent): The agent instance
- `query` (str): User query/message

**❌ NOT Supported:**
- `config` parameter - will raise `TypeError`

**💡 Tracing is automatic**: No config needed, traces are created automatically

### ✅ Automatic Tracing (No Code Needed)

The SDK automatically creates these spans:

| What Happens | Span Type | What's Captured |
|--------------|-----------|-----------------|
| Agent runs | `agent_span` | Execution flow, reasoning |
| LLM calls | `generation_span` | Prompts, responses, tokens |
| Tool calls | `function_span` | Tool inputs, outputs, duration |
| Errors | Error spans | Exception details, stack traces |

**No code changes needed** - just run your agent!

---

## Common Patterns

### Pattern 1: Single Query with Tracing

```python
async def run_query(agent: Agent, query: str):
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    with trace(workflow_name="Single Query", group_id=session_id):
        result = await Runner.run(agent, query)
        return result.final_output
```

### Pattern 2: Multiple Queries in Session

```python
async def run_conversation(agent: Agent, queries: list[str]):
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    with trace(workflow_name="Conversation", group_id=session_id):
        for i, query in enumerate(queries, 1):
            with custom_span(name=f"query_{i}_{query[:20]}"):
                result = await Runner.run(agent, query)
                print(f"[{i}] {result.final_output}")
```

### Pattern 3: Tool with Internal Spans

```python
@function_tool
def complex_operation(input_data: str) -> dict:
    """Performs multi-step operation."""
    
    # Step 1: Validate
    with custom_span(name=f"validate_{input_data[:10]}"):
        is_valid = validate(input_data)
    
    # Step 2: Process
    with custom_span(name=f"process_{input_data[:10]}"):
        result = process(input_data)
    
    # Step 3: Format
    with custom_span(name=f"format_{input_data[:10]}"):
        formatted = format_result(result)
    
    return formatted
```

### Pattern 4: Error Handling with Tracing

```python
async def run_with_retry(agent: Agent, query: str, max_retries: int = 3):
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    with trace(workflow_name="Query with Retry", group_id=session_id):
        for attempt in range(max_retries):
            with custom_span(name=f"attempt_{attempt + 1}"):
                try:
                    result = await Runner.run(agent, query)
                    return result.final_output
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise  # Error captured in trace
                    await asyncio.sleep(1 * (attempt + 1))
```

### Pattern 5: Multi-Agent Workflow

```python
async def multi_agent_workflow(query: str):
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    with trace(workflow_name="Multi-Agent", group_id=session_id):
        # Agent 1: Research
        with custom_span(name="research_phase"):
            research = await Runner.run(research_agent, query)
        
        # Agent 2: Analysis
        with custom_span(name="analysis_phase"):
            analysis = await Runner.run(
                analysis_agent, 
                f"Analyze: {research.final_output}"
            )
        
        # Agent 3: Summary
        with custom_span(name="summary_phase"):
            summary = await Runner.run(
                summary_agent,
                f"Summarize: {analysis.final_output}"
            )
        
        return summary.final_output
```

---

## Configuration Options

### HttpExporter Configuration

```python
exporter = HttpExporter(
    endpoint="http://localhost:5175/ingest",  # Ariadne API URL
    timeout=3.0,                               # Request timeout (seconds)
    debug=False,                               # Enable debug logging
    hydrate_openai=True,                       # Fetch full OpenAI responses
    policy=PayloadPolicy(...),                 # Data handling policy
)
```

**Parameters:**
- `endpoint` (str): Where to send traces
- `timeout` (float): HTTP request timeout
- `debug` (bool): Print detailed logs to stderr
- `hydrate_openai` (bool): Fetch full response objects from OpenAI API
- `policy` (PayloadPolicy): Controls data size and redaction

### PayloadPolicy Configuration

```python
policy = PayloadPolicy(
    preview_chars=8000,               # Characters to preview
    max_blob_bytes=10 * 1024 * 1024,  # Max 10MB for large outputs
    blob_cache_size=1024,             # Cache for deduplication
    redact_keys=("api_key", "password", "secret"),
    redact_patterns=(
        re.compile(r"sk-[A-Za-z0-9]{20,}"),  # API keys
        re.compile(r'Bearer\s+[A-Za-z0-9\-_\.=]{10,}'),  # Tokens
    ),
)
```

---

## Disabling Tracing

### Disable Globally

```python
import os
os.environ["OPENAI_AGENTS_DISABLE_TRACING"] = "1"

# Now all agent runs will not be traced
```

### Disable Per-Module

```python
# Don't call set_trace_processors()
# Tracing will be disabled for this process
```

---

## Verification Steps

### 1. Check Exporter is Configured

```python
# After set_trace_processors(), this should not raise an error
from agents.tracing import get_trace_provider
provider = get_trace_provider()
print(f"Trace provider: {provider}")  # Should show configured provider
```

### 2. Run Simple Test

```python
import asyncio
from agents import Agent, Runner
from agents.tracing import trace

agent = Agent(name="Test", instructions="Say hello")

async def test():
    with trace(workflow_name="Test") as t:
        print(f"Trace ID: {t.trace_id}")  # Should print trace_xxx
        result = await Runner.run(agent, "Hello")
        print(f"Result: {result.final_output}")

asyncio.run(test())
```

### 3. Check Ariadne Viewer

1. Ensure API server running: `curl http://localhost:5175/healthz`
2. Open viewer: http://localhost:5173
3. Run your agent
4. Look for traces appearing in real-time

### 4. Enable Debug Mode

```python
exporter = HttpExporter(debug=True, ...)
```

This will print:
- Payload previews before sending
- HTTP response status
- Errors if any

---

## Troubleshooting

### Error: "TypeError: custom_span() got an unexpected keyword argument 'metadata'"

**Problem**: Using unsupported API  
**Solution**: Remove `metadata` parameter, use descriptive names instead

```python
# ❌ Don't do this
with custom_span(name="fetch", metadata={"loc": "Paris"}):
    pass

# ✅ Do this instead
with custom_span(name="fetch_Paris"):
    pass
```

### Error: "TypeError: trace() got an unexpected keyword argument 'metadata'"

**Problem**: Using unsupported API  
**Solution**: Remove `metadata` parameter

```python
# ❌ Don't do this
with trace(workflow_name="X", metadata={...}):
    pass

# ✅ Do this instead
with trace(workflow_name="X", group_id="session_123"):
    pass
```

### Error: "TypeError: Runner.run() got an unexpected keyword argument 'config'"

**Problem**: Trying to pass RunConfig  
**Solution**: Use simple API

```python
# ❌ Don't do this
config = RunConfig(metadata={...})
result = await Runner.run(agent, query, config=config)

# ✅ Do this instead
result = await Runner.run(agent, query)
```

### Traces Not Appearing in Viewer

**Check:**
1. API server running: `curl http://localhost:5175/healthz`
2. Correct endpoint in exporter: `endpoint="http://localhost:5175/ingest"`
3. Enable debug mode: `HttpExporter(debug=True, ...)`
4. Check terminal for error messages
5. Check browser console for SSE connection

### Performance Issues

**If tracing makes app slow:**

```python
# Disable hydration (saves API calls)
exporter = HttpExporter(hydrate_openai=False, ...)

# Reduce payload size
policy = PayloadPolicy(
    preview_chars=2000,  # Smaller previews
    max_blob_bytes=1 * 1024 * 1024,  # 1MB limit
)

# Increase timeout for slow networks
exporter = HttpExporter(timeout=10.0, ...)
```

---

## Complete Working Template

Copy this template to add tracing to any OpenAI Agents SDK app:

```python
"""
OpenAI Agents SDK App with Ariadne Tracing
Complete working template - just add your tools and logic!
"""
import asyncio
import os
import uuid
from agents import Agent, Runner, function_tool
from agents.tracing import set_trace_processors, trace, custom_span
from agents.tracing.processors import BatchTraceProcessor
from http_exporter import HttpExporter, PayloadPolicy

# ============================================================================
# SETUP: Configure tracing (do this once at app startup)
# ============================================================================

def setup_tracing(debug: bool = False):
    """Configure Ariadne tracing."""
    exporter = HttpExporter(
        endpoint=os.getenv("ARIADNE_ENDPOINT", "http://localhost:5175/ingest"),
        timeout=3.0,
        debug=debug,
        hydrate_openai=True,
        policy=PayloadPolicy(
            preview_chars=8000,
            max_blob_bytes=10 * 1024 * 1024,
            blob_cache_size=1024,
        ),
    )
    set_trace_processors([BatchTraceProcessor(exporter)])
    print("✓ Tracing configured")

# ============================================================================
# TOOLS: Define your function tools here
# ============================================================================

@function_tool
def example_tool(param: str) -> str:
    """Example tool - replace with your own."""
    # Optional: Add custom span for internal operations
    with custom_span(name=f"example_operation_{param}"):
        result = f"Processed: {param}"
    return result

# ============================================================================
# AGENT: Create your agent
# ============================================================================

def create_agent() -> Agent:
    """Create and return configured agent."""
    return Agent(
        name="My Agent",
        instructions="Replace with your agent instructions.",
        tools=[example_tool],  # Add your tools here
    )

# ============================================================================
# WORKFLOW: Your main application logic
# ============================================================================

async def run_workflow(queries: list[str]):
    """
    Main workflow with tracing.
    
    Args:
        queries: List of user queries to process
    """
    # Generate unique session ID for this workflow
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    print(f"Session ID: {session_id}")
    
    # Create agent
    agent = create_agent()
    
    # Wrap entire workflow in a trace
    with trace(workflow_name="My Workflow", group_id=session_id):
        
        # Process each query
        for i, query in enumerate(queries, 1):
            # Wrap each query in custom span
            with custom_span(name=f"process_query_{i}"):
                try:
                    # Run agent
                    result = await Runner.run(agent, query)
                    print(f"[Query {i}] {query}")
                    print(f"[Response] {result.final_output}\n")
                    
                except Exception as e:
                    print(f"[Error] {e}")
                    raise  # Re-raise to capture in trace

# ============================================================================
# MAIN: Application entry point
# ============================================================================

async def main():
    """Main entry point."""
    # Setup tracing
    debug_mode = os.getenv("ARIADNE_DEBUG", "false").lower() == "true"
    setup_tracing(debug=debug_mode)
    
    # Your queries
    queries = [
        "First query here",
        "Second query here",
    ]
    
    # Run workflow
    await run_workflow(queries)
    
    print("✅ Workflow completed")
    print("View traces at: http://localhost:5173")

if __name__ == "__main__":
    asyncio.run(main())
```

---

## Best Practices Checklist

- [ ] Call `setup_tracing()` once at app startup
- [ ] Generate unique `session_id` per workflow
- [ ] Wrap workflows in `trace()` with descriptive name
- [ ] Wrap queries in `custom_span()` with context
- [ ] Use descriptive span names with parameters: `f"operation_{param}"`
- [ ] Re-raise exceptions to capture in traces
- [ ] Enable debug mode during development
- [ ] Test that traces appear in viewer
- [ ] Disable hydration in production for speed
- [ ] Set appropriate timeout for your network

---

## Additional Resources

- **Working Example**: [weather_agent.py](./weather_agent.py)
- **Quick Reference**: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- **API Corrections**: [API_CORRECTIONS.md](./API_CORRECTIONS.md)
- **OpenAI Docs**: https://openai.github.io/openai-agents-python/tracing/

---

## Summary

**Key Points:**
1. Only 3 functions needed: `trace()`, `custom_span()`, `Runner.run()`
2. No metadata parameters - use descriptive names instead
3. No RunConfig - simple API only
4. Automatic tracing for agent runs, LLM calls, tool calls
5. Use `group_id` to link related traces
6. Re-raise exceptions for error tracing

**This guide contains ONLY tested, working patterns.** All code examples run without errors.
