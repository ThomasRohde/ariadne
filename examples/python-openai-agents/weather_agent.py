"""
Weather Agent Example with Ariadne Tracing

Demonstrates OpenAI Agents SDK integration with Ariadne real-time trace viewer.
This example creates an agent with tools that can fetch weather information
and explain weather concepts.
"""

import asyncio
import os
import sys
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
    from agents.tracing import set_trace_processors
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

    return {
        "location": location,
        "temperature": f"{data['temp']}{data['unit']}",
        "conditions": data["conditions"],
        "humidity": f"{data['humidity']}%",
        "timestamp": datetime.now().isoformat()
    }


@function_tool
def explain_weather_term(term: str) -> str:
    """
    Explain a weather-related term.

    Args:
        term: Weather term to explain

    Returns:
        Explanation of the term
    """
    explanations = {
        "humidity": "The amount of water vapor in the air, expressed as a percentage.",
        "precipitation": "Any form of water that falls from clouds, including rain, snow, sleet, or hail.",
        "barometric pressure": "The pressure exerted by the atmosphere at a given point, measured in millibars or inches of mercury.",
        "wind chill": "The perceived temperature on exposed skin due to wind, making it feel colder than the actual air temperature.",
        "heat index": "A measure of how hot it feels when relative humidity is combined with actual air temperature.",
    }

    term_lower = term.lower()
    return explanations.get(term_lower, f"No explanation available for '{term}'")


async def main():
    """Run the weather agent with Ariadne tracing."""

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

    # Create agent with tools
    print("\nCreating weather agent...")
    agent = Agent(
        name="Weather Assistant",
        instructions="""You are a helpful weather assistant. You can:
        1. Get current weather for any location
        2. Explain weather-related terms

        Always be friendly and provide clear, concise information.""",
        tools=[get_weather, explain_weather_term]
    )

    # Example queries
    queries = [
        "What's the weather like in Paris?",
        "Compare the weather in London and Tokyo",
        "What does humidity mean?",
    ]

    print("\nRunning example queries...")
    print("=" * 60)

    for i, query in enumerate(queries, 1):
        print(f"\n[Query {i}] {query}")
        print("-" * 60)

        try:
            result = await Runner.run(agent, query)
            print(f"[Response] {result.final_output}")
        except Exception as e:
            print(f"[Error] {e}")

        print()

    print("=" * 60)
    print("\nView traces in real-time at: http://localhost:5173")
    print("\nNote: Make sure the Ariadne API server is running:")
    print("  cd packages/api && pnpm dev")


def cli() -> None:
    """Console script entry point used by the package metadata."""
    asyncio.run(main())


if __name__ == "__main__":
    cli()
