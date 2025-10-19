"""
Weather Agent Example with Ariadne Tracing

Demonstrates OpenAI Agents SDK integration with Ariadne real-time trace viewer.
This example showcases comprehensive tracing patterns including:
- Higher-level trace wrapping for workflows
- Custom spans for operations
- Metadata and group IDs
- Error handling with tracing
- RunConfig customization
"""

import asyncio
import os
import sys
import uuid
from datetime import datetime
from typing import Literal

# Attempt to load .env support; fall back silently if python-dotenv is absent.
try:
    from dotenv import load_dotenv
except ImportError:  # python-dotenv is optional for this example
    def load_dotenv(*_args, **_kwargs):  # type: ignore[override]
        return False

from http_exporter import HttpExporter, PayloadPolicy

# Try to import OpenAI Agents SDK
try:
    from agents import Agent, Runner, function_tool
    from agents.tracing import (
        set_trace_processors,
        trace,
        custom_span,
    )
    from agents.tracing.processors import BatchTraceProcessor
except ImportError:
    print("Error: openai-agents not installed")
    print("Please install it with: uv pip install openai-agents")
    sys.exit(1)

# Load environment variables
load_dotenv()


# Define weather tool (simulated for demo purposes)
@function_tool
def get_weather(
    location: str,
    unit: Literal["celsius", "fahrenheit"] = "celsius"
) -> dict:
    """
    Get current weather for a location.

    Args:
        location: City name or location
        unit: Temperature unit (celsius or fahrenheit)

    Returns:
        Dictionary with weather information
    """
    # Use custom span to track internal operations
    with custom_span(name=f"fetch_weather_data_{location}_{unit}"):
        # Simulated weather data
        weather_data = {
            "Paris": {"temp": 18, "conditions": "Partly cloudy", "humidity": 65},
            "London": {"temp": 15, "conditions": "Rainy", "humidity": 80},
            "New York": {"temp": 22, "conditions": "Sunny", "humidity": 55},
            "Tokyo": {"temp": 25, "conditions": "Clear", "humidity": 60},
            "Sydney": {"temp": 20, "conditions": "Windy", "humidity": 70},
        }

        # Default weather if location not found
        data = weather_data.get(location, {
            "temp": 20,
            "conditions": "Unknown",
            "humidity": 50
        })

        # Convert to Fahrenheit if needed
        if unit == "fahrenheit":
            data["temp"] = int(data["temp"] * 9/5 + 32)
            data["unit"] = "°F"
        else:
            data["unit"] = "°C"

        result = {
            "location": location,
            "temperature": f"{data['temp']}{data['unit']}",
            "conditions": data["conditions"],
            "humidity": f"{data['humidity']}%",
            "timestamp": datetime.now().isoformat()
        }

    return result


@function_tool
def explain_weather_term(term: str) -> str:
    """
    Explain a weather-related term.

    Args:
        term: Weather term to explain

    Returns:
        Explanation of the term
    """
    with custom_span(name=f"lookup_weather_term_{term.replace(' ', '_')}"):
        explanations = {
            "humidity": "The amount of water vapor in the air, expressed as a percentage.",
            "precipitation": "Any form of water that falls from clouds, including rain, snow, sleet, or hail.",
            "barometric pressure": "The pressure exerted by the atmosphere at a given point, measured in millibars or inches of mercury.",
            "wind chill": "The perceived temperature on exposed skin due to wind, making it feel colder than the actual air temperature.",
            "heat index": "A measure of how hot it feels when relative humidity is combined with actual air temperature.",
            "dew point": "The temperature at which air becomes saturated and water vapor begins to condense into liquid water.",
            "visibility": "The distance at which objects can be clearly seen and identified, often affected by fog, rain, or pollution.",
        }

        term_lower = term.lower()
        explanation = explanations.get(term_lower, f"No explanation available for '{term}'")
    
    return explanation


async def run_weather_query(agent: Agent, query: str, query_num: int, session_id: str) -> None:
    """
    Run a single weather query with comprehensive tracing.
    
    Args:
        agent: The weather agent
        query: User query
        query_num: Query number for display
        session_id: Session identifier for grouping
    """
    print(f"\n[Query {query_num}] {query}")
    print("-" * 60)

    # Wrap each query in a custom span for better organization
    with custom_span(name=f"process_query_{query_num}_{query[:30].replace(' ', '_')}"):
        try:
            result = await Runner.run(agent, query)
            print(f"[Response] {result.final_output}")
            
        except Exception as e:
            print(f"[Error] {e}")
            # Re-raise to ensure error is captured in trace
            raise



async def main():
    """Run the weather agent with comprehensive Ariadne tracing."""

    # Check for OpenAI API key
    if not os.getenv("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY not set in environment")
        print("Create a .env file with: OPENAI_API_KEY=your_key_here")
        sys.exit(1)

    # Configure Ariadne exporter
    ariadne_endpoint = os.getenv("ARIADNE_ENDPOINT", "http://localhost:5175/ingest")
    print(f"Configuring Ariadne tracing to: {ariadne_endpoint}")

    try:
        # Enable debug mode to see validation errors
        debug_mode = os.getenv("ARIADNE_DEBUG", "false").lower() == "true"
        policy = PayloadPolicy(
            preview_chars=8000,
            max_blob_bytes=10 * 1024 * 1024,
            blob_cache_size=1024,
        )
        exporter = HttpExporter(
            endpoint=ariadne_endpoint,
            timeout=3.0,
            debug=debug_mode,
            hydrate_openai=True,
            policy=policy,
        )
        set_trace_processors([BatchTraceProcessor(exporter)])
        print("✓ Ariadne tracing configured")
        if debug_mode:
            print("  (Debug mode enabled)")
    except Exception as e:
        print(f"Warning: Failed to configure Ariadne tracing: {e}")
        print("Continuing without tracing...")

    # Generate a session ID to group all queries in this run
    session_id = f"session_{uuid.uuid4().hex[:12]}"
    
    # Wrap entire workflow in a higher-level trace
    # This groups all agent runs under a single workflow trace
    with trace(
        workflow_name="Weather Agent Demo",
        group_id=session_id,
    ) as demo_trace:
        print(f"\n📊 Trace ID: {demo_trace.trace_id}")
        print(f"🔗 Session ID: {session_id}")
        
        # Create agent with tools
        print("\nCreating weather agent...")
        with custom_span(name="initialize_weather_agent"):
            agent = Agent(
                name="Weather Assistant",
                instructions="""You are a helpful weather assistant. You can:
                1. Get current weather for any location
                2. Explain weather-related terms
                3. Compare weather across multiple cities

                Always be friendly and provide clear, concise information.
                When comparing weather, use multiple tool calls to gather all data.""",
                tools=[get_weather, explain_weather_term]
            )

        # Example queries demonstrating different tracing scenarios
        queries = [
            "What's the weather like in Paris?",
            "Compare the weather in London and Tokyo",
            "What does humidity mean?",
            "Tell me about the weather in Sydney and explain what dew point means",
        ]

        print("\nRunning example queries...")
        print("=" * 60)

        # Process queries with individual spans
        for i, query in enumerate(queries, 1):
            try:
                await run_weather_query(agent, query, i, session_id)
            except Exception as e:
                # Error is already logged in run_weather_query
                print(f"Continuing after error...")
            
            print()

        print("=" * 60)
        print("\n✅ All queries completed")
        print(f"\n📊 View traces in real-time at: http://localhost:5173")
        print(f"   Filter by group_id: {session_id}")
        print("\nNote: Make sure the Ariadne API server is running:")
        print("  cd api && pnpm dev")
        print("\nAnd the web UI is running:")
        print("  cd web && pnpm dev")



def cli() -> None:
    """Console script entry point used by the package metadata."""
    asyncio.run(main())


if __name__ == "__main__":
    cli()
