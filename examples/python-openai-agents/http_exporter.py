"""
HTTP Exporter for OpenAI Agents SDK (Python)
Exports trace and span events to Ariadne viewer via HTTP POST.
Provides deterministic output extraction, optional response hydration,
deduplicated large outputs, and payload redaction controls.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import threading
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union, cast

import requests

try:
    import openai  # type: ignore
    _HAS_OPENAI = True
except Exception:  # pragma: no cover - optional dependency
    openai = None  # type: ignore
    _HAS_OPENAI = False

from agents.tracing import Span, SpanError, Trace

SpanType = Span[Any]
TraceType = Trace


@dataclass
class PayloadPolicy:
    """Tunable rules for exporter payload formatting."""

    large_output_span_kinds: Tuple[str, ...] = (
        "agent.run",
        "response.create",
        "llm.call",
        "planner.step",
        "tool.run",
        "tool.result",
        "function.call",
        "openai.response.create",
        "openai.chat.completions.create",
        "agent.step",
        "agent.finalize",
        "completion.create",
    )
    preview_chars: int = 2000
    max_blob_bytes: int = 5 * 1024 * 1024
    redact_keys: Tuple[str, ...] = ("api_key", "authorization", "cookie", "set-cookie", "password", "secret")
    redact_patterns: Tuple[re.Pattern[str], ...] = field(
        default_factory=lambda: (
            re.compile(r"sk-[A-Za-z0-9]{20,}"),
            re.compile(r'Bearer\s+[A-Za-z0-9\-_\.=]{10,}'),
        )
    )
    blob_cache_size: int = 512

_BANLIST_EXACT = set()


def _get_from_path(obj: Any, path: str) -> Any:
    cur = obj
    for token in path.split("."):
        if isinstance(cur, Mapping):
            cur = cur.get(token)
        elif isinstance(cur, (list, tuple)) and token.isdigit():
            idx = int(token)
            if 0 <= idx < len(cur):
                cur = cur[idx]
            else:
                return None
        else:
            return None
        if cur is None:
            return None
    return cur


def _to_plain_text(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, Mapping):
        if "text" in value and isinstance(value["text"], Mapping) and "value" in value["text"]:
            nested = value["text"]["value"]
            if isinstance(nested, str) and nested.strip():
                return nested.strip()
        if "text" in value and isinstance(value["text"], str) and value["text"].strip():
            return value["text"].strip()
        for key in ("output_text", "final_output", "message", "content", "result", "response"):
            if key in value:
                nested = _to_plain_text(value[key])
                if nested:
                    return nested
    if isinstance(value, (list, tuple)):
        parts = [part for part in (_to_plain_text(item) for item in value) if part]
        if parts:
            return "\n\n".join(parts)
    return None


def _span_data_as_dict(span_data: Any) -> Optional[Dict[str, Any]]:
    if span_data is None or not hasattr(span_data, "__dict__"):
        return None
    result: Dict[str, Any] = {}
    for key, value in span_data.__dict__.items():
        if key.startswith("_") or value is None:
            continue
        result[key] = value
    return result or None


def _redact_scalar(value: Any, policy: PayloadPolicy) -> Any:
    if isinstance(value, str):
        text = value
        for pattern in policy.redact_patterns:
            text = pattern.sub("[REDACTED]", text)
        return text
    if isinstance(value, (int, float, bool)) or value is None:
        return value
    # Fallback for anything else to ensure JSON-serializable
    try:
        return str(value)
    except Exception:
        return "<non-serializable>"


def _redact_tree(obj: Any, policy: PayloadPolicy) -> Any:
    if isinstance(obj, Mapping):
        result: Dict[str, Any] = {}
        for key, value in obj.items():
            if str(key).lower() in policy.redact_keys:
                result[str(key)] = "[REDACTED]"
            else:
                result[str(key)] = _redact_tree(value, policy)
        return result
    if isinstance(obj, list):
        return [_redact_tree(item, policy) for item in obj]
    return _redact_scalar(obj, policy)


def _preview_mapping_keys(mapping: Mapping[str, Any], limit: int = 6) -> List[str]:
    key_list = [str(key) for key in list(mapping.keys())[:limit]]
    try:
        if len(mapping) > limit:
            key_list.append("...more")
    except Exception:
        pass
    return key_list


def _preview_value(value: Any, max_len: int = 480) -> str:
    if value is None:
        return "None"
    try:
        if isinstance(value, (Mapping, list, tuple, set)):
            formatted = json.dumps(value, default=str, ensure_ascii=True, indent=2)
        else:
            formatted = repr(value)
    except Exception:
        formatted = repr(value)
    if len(formatted) > max_len:
        return formatted[: max_len - 3] + "..."
    return formatted


def _normalize_timestamp(timestamp: Any) -> Optional[str]:
    if not timestamp:
        return None
    text = str(timestamp)
    if text.endswith("+00:00") or text.endswith("-00:00"):
        return text[:-6] + "Z"
    return text


def _extract_metadata(metadata: Any) -> Optional[Dict[str, str]]:
    if not isinstance(metadata, Mapping):
        return None
    result: Dict[str, str] = {}
    for key, value in metadata.items():
        result[str(key)] = str(value)
    return result or None


def _convert_response_to_dict(response: Any) -> Optional[Dict[str, Any]]:
    if response is None:
        return None
    if isinstance(response, dict):
        return response
    for method_name in ("model_dump", "dict", "to_dict"):
        method = getattr(response, method_name, None)
        if callable(method):
            try:
                result = method()
            except TypeError:
                try:
                    result = method(exclude_none=True)  # type: ignore[arg-type]
                except Exception:
                    continue
            except Exception:
                continue
            if isinstance(result, dict):
                return result
    to_json = getattr(response, "to_json", None)
    if callable(to_json):
        try:
            maybe = to_json()
            if isinstance(maybe, dict):
                return maybe
        except Exception:
            pass
    if hasattr(response, "__dict__"):
        return {key: value for key, value in response.__dict__.items() if not str(key).startswith("_")}
    return None


def _coerce_text_value(value: Any, depth: int = 0) -> Optional[str]:
    if value is None or depth > 6:
        return None
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", errors="replace")
        except Exception:
            value = value.decode(errors="ignore")
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, (int, float, bool)):
        return str(value)
    if isinstance(value, Mapping):
        for key in ("output_text", "final_output", "message", "content", "result", "response", "text", "value"):
            if key in value:
                text = _coerce_text_value(value[key], depth + 1)
                if text:
                    return text
        for nested in value.values():
            text = _coerce_text_value(nested, depth + 1)
            if text:
                return text
    if isinstance(value, (list, tuple, set)):
        parts = [part for part in (_coerce_text_value(item, depth + 1) for item in value) if part]
        if parts:
            return "\n\n".join(parts)
    return None


def _looks_like_response_id(text: str) -> bool:
    if not text:
        return False
    if text.startswith("resp_"):
        suffix = text[5:]
        return bool(suffix) and suffix.isalnum()
    return False


def _score_text(text: str) -> float:
    """Score how much a string resembles natural language output."""
    if not text:
        return 0.0
    stripped = text.strip()
    if not stripped:
        return 0.0
    if stripped.lower() in {"low", "medium", "high", "true", "false", "str"}:
        return 0.1
    length = len(stripped)
    space_count = stripped.count(" ")
    punctuation_count = sum(stripped.count(p) for p in ".!?,:;")
    return length * 0.6 + space_count * 1.2 + punctuation_count * 2.0


def _extract_output_text(
    span: SpanType,
    span_data: Any,
    exported: Optional[Mapping[str, Any]]
) -> Optional[Tuple[str, str]]:
    candidates: List[Tuple[str, str]] = []

    for attr in ("final_output",):
        if hasattr(span, attr):
            text = _to_plain_text(getattr(span, attr))
            if text:
                candidates.append((text, f"span.{attr}"))

    for attr in ("output_text", "final_output", "answer", "content"):
        if hasattr(span_data, attr):
            text = _to_plain_text(getattr(span_data, attr))
            if text:
                candidates.append((text, f"span_data.{attr}"))

    if exported:
        known_paths: Tuple[Tuple[str, ...], ...] = (
            ("output_text",),
            ("output.0.content.0.text",),
            ("response.output_text",),
            ("response.output.0.content.0.text",),
            ("choices.0.message.content",),
            ("messages.0.content.0.text",),
            ("final_output",),
            ("answer",),
        )
        for group in known_paths:
            for path in group:
                value = _get_from_path(exported, path)
                text = _to_plain_text(value)
                if text:
                    candidates.append((text, f"export.{path}"))

        for key in ("message", "content", "result", "response"):
            if key in exported:
                text = _to_plain_text(exported[key])
                if text and len(text) >= 24:
                    candidates.append((text, f"export.{key}"))

    if not candidates:
        return None

    best_text, source = max(candidates, key=lambda item: _score_text(item[0]))
    best_score = _score_text(best_text)
    
    # Bypass score threshold for terminal or error spans
    span_kind = getattr(span_data, "type", None) or getattr(span, "kind", None) or "span"
    span_status = getattr(span, "status", "ok")
    is_terminal_or_error = (
        span_kind in {"agent.finalize", "agent.run.final"} or 
        span_status == "error"
    )
    
    if is_terminal_or_error or best_score >= 8.0:
        return best_text, source
    
    return None


def _hydrate_openai_response(resp_like: Any) -> Optional[Dict[str, Any]]:
    resp_id: Optional[str] = None

    if isinstance(resp_like, str) and _looks_like_response_id(resp_like):
        resp_id = resp_like
    elif isinstance(resp_like, Mapping):
        for key in ("id", "response_id", "responseId"):
            candidate = resp_like.get(key)
            if isinstance(candidate, str) and _looks_like_response_id(candidate):
                resp_id = candidate
                break
        if resp_id is None:
            response_field = resp_like.get("response")
            if isinstance(response_field, Mapping):
                inner_id = response_field.get("id")
                if isinstance(inner_id, str) and _looks_like_response_id(inner_id):
                    resp_id = inner_id
            elif isinstance(response_field, str) and _looks_like_response_id(response_field):
                resp_id = response_field
    else:
        candidate = getattr(resp_like, "id", None)
        if isinstance(candidate, str) and _looks_like_response_id(candidate):
            resp_id = candidate

    if not resp_id:
        return None
    if not _HAS_OPENAI:
        return None

    client_factory = getattr(openai, "OpenAI", None)
    if not callable(client_factory):
        return None

    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return None

    client = client_factory(api_key=api_key)
    try:
        try:
            response = client.responses.retrieve(resp_id)
        except Exception:
            response = client.responses.get(resp_id)  # type: ignore[attr-defined]
    except Exception:
        return None

    structured = _convert_response_to_dict(response)
    if not structured:
        return None
    return structured


class HttpExporter:
    """Exports trace and span events to the Ariadne trace viewer."""

    def __init__(
        self,
        endpoint: str = "http://localhost:5175/ingest",
        timeout: float = 2.0,
        debug: bool = False,
        hydrate_openai: bool = True,
        policy: Optional[PayloadPolicy] = None,
    ):
        self.endpoint = endpoint
        self.timeout = timeout
        self.debug = debug
        self.policy = policy or PayloadPolicy()
        self._hydrate_requested = hydrate_openai
        self._api_key_present = bool(os.getenv("OPENAI_API_KEY"))
        self.hydrate_openai = hydrate_openai and _HAS_OPENAI and self._api_key_present
        self._blob_cache: Dict[str, Dict[str, Union[str, int]]] = {}
        self._blob_order: List[str] = []
        self._last_output_hash_by_trace: Dict[str, str] = {}
        self._lock = threading.Lock()

    def _debug_print(self, message: str) -> None:
        if not self.debug:
            return
        print(f"[Ariadne Debug] {message}", file=__import__("sys").stderr)

    def export(self, items: Sequence[TraceType | SpanType]) -> None:
        with self._lock:
            events: List[Dict[str, Any]] = []

            for item in items:
                if isinstance(item, Trace):
                    events.append(self._event_from_trace(item))
                elif isinstance(item, Span):
                    events.append(self._event_from_span(item))

            if not events:
                return

            payload = {"batch": events}

            if self.debug:
                try:
                    preview = json.dumps(payload, indent=2)[:4000]
                except Exception:
                    preview = str(payload)[:4000]
                print(f"[Ariadne Debug] Payload preview:\n{preview}", file=__import__("sys").stderr)

            # Retry logic for network failures
            for attempt in range(2):  # 1 retry (2 total attempts)
                try:
                    response = requests.post(
                        self.endpoint,
                        json=payload,
                        timeout=self.timeout,
                        headers={"Content-Type": "application/json"},
                    )
                    response.raise_for_status()
                    break  # Success, exit retry loop
                except requests.Timeout:
                    if attempt == 0:
                        continue  # Retry on first timeout
                    # Final timeout, log and continue
                    print(f"[Ariadne] Request timed out after retry", file=__import__("sys").stderr)
                    break
                except requests.HTTPError as exc:
                    message = f"[Ariadne] Failed to export traces: {exc}"
                    try:
                        detail = exc.response.json()  # type: ignore[attr-defined]
                        message += f"\n{json.dumps(detail, indent=2)}"
                    except Exception:
                        pass
                    print(message, file=__import__("sys").stderr)
                    break  # Don't retry on HTTP errors
                except Exception as exc:
                    print(f"[Ariadne] Failed to export traces: {exc}", file=__import__("sys").stderr)
                    break  # Don't retry on other exceptions

    def _event_from_trace(self, trace: TraceType) -> Dict[str, Any]:
        event: Dict[str, Any] = {"type": "trace", "trace_id": trace.trace_id}
        name = getattr(trace, "name", None)
        if name:
            event["name"] = name
        group_id = getattr(trace, "group_id", None)
        if group_id:
            event["group_id"] = group_id
        started_at = _normalize_timestamp(getattr(trace, "started_at", None))
        if started_at:
            event["started_at"] = started_at
        ended_at = _normalize_timestamp(getattr(trace, "ended_at", None))
        if ended_at:
            event["ended_at"] = ended_at
        metadata = _extract_metadata(getattr(trace, "metadata", None))
        if metadata:
            event["metadata"] = metadata
        self._last_output_hash_by_trace.pop(trace.trace_id, None)
        return event

    def _event_from_span(self, span: SpanType) -> Dict[str, Any]:
        event: Dict[str, Any] = {
            "type": "span",
            "trace_id": span.trace_id,
            "span_id": span.span_id,
            "status": "ok",
        }

        if span.parent_id:
            event["parent_id"] = span.parent_id

        started_at = _normalize_timestamp(getattr(span, "started_at", None))
        if started_at:
            event["started_at"] = started_at
        ended_at = _normalize_timestamp(getattr(span, "ended_at", None))
        if ended_at:
            event["ended_at"] = ended_at

        span_data = getattr(span, "span_data", None)
        kind = getattr(span_data, "type", None) or getattr(span, "kind", None) or "span"
        kind_str = str(kind)
        event["kind"] = kind_str

        name = getattr(span_data, "name", None) or getattr(span, "name", None)
        if name:
            event["name"] = str(name)

        exported, data_payload = self._collect_span_payload(span_data)
        if data_payload:
            event["data"] = data_payload

        hydrated_export: Optional[Mapping[str, Any]] = None
        hydrate_candidate: Any = None
        hydrate_source: Optional[str] = None
        exported_keys_preview: List[str] = _preview_mapping_keys(exported) if exported else []
        span_data_has_response = hasattr(span_data, "response")

        if exported:
            response_value = exported.get("response")
            if response_value is not None:
                hydrate_candidate = response_value
                hydrate_source = "export.response"
            else:
                exported_id = exported.get("id")
                if exported_id is not None:
                    hydrate_candidate = exported_id
                    hydrate_source = "export.id"
            if hydrate_candidate is None:
                response_id = exported.get("response_id")
                if response_id is not None:
                    hydrate_candidate = response_id
                    hydrate_source = "export.response_id"
        if hydrate_candidate is None and span_data_has_response:
            hydrate_candidate = getattr(span_data, "response")
            hydrate_source = "span_data.response"

        candidate_type = type(hydrate_candidate).__name__ if hydrate_candidate is not None else "None"
        keys_repr = "[" + ", ".join(exported_keys_preview) + "]" if exported_keys_preview else "[]"

        if hydrate_candidate is None:
            if exported_keys_preview or span_data_has_response:
                self._debug_print(
                    f"Hydration inspect span_id={span.span_id} trace_id={span.trace_id} kind={kind_str} "
                    f"result=no_candidate source={hydrate_source or 'none'} exported_keys={keys_repr} "
                    f"span_data_has_response={span_data_has_response}"
                )
        elif not self.hydrate_openai:
            sanitized_candidate = _redact_tree(hydrate_candidate, self.policy)
            candidate_preview = _preview_value(sanitized_candidate)
            self._debug_print(
                f"Hydration inspect span_id={span.span_id} trace_id={span.trace_id} kind={kind_str} "
                f"result=disabled source={hydrate_source or 'unknown'} candidate_type={candidate_type} "
                f"requested={self._hydrate_requested} openai_available={_HAS_OPENAI} "
                f"api_key_present={self._api_key_present} candidate_preview={candidate_preview}"
            )
        else:
            hydrated_export = _hydrate_openai_response(hydrate_candidate)
            if hydrated_export:
                payload = event.setdefault("data", {})
                payload["hydrated"] = True
                payload["response"] = cast(Dict[str, Any], _redact_tree(hydrated_export, self.policy))
                hydrated_keys_preview = _preview_mapping_keys(hydrated_export)
                hydrated_keys_repr = (
                    "[" + ", ".join(hydrated_keys_preview) + "]" if hydrated_keys_preview else "[]"
                )
                self._debug_print(
                    f"Hydration inspect span_id={span.span_id} trace_id={span.trace_id} kind={kind_str} "
                    f"result=success source={hydrate_source or 'unknown'} candidate_type={candidate_type} "
                    f"hydrated_keys={hydrated_keys_repr}"
                )
            else:
                sanitized_candidate = _redact_tree(hydrate_candidate, self.policy)
                candidate_preview = _preview_value(sanitized_candidate)
                self._debug_print(
                    f"Hydration inspect span_id={span.span_id} trace_id={span.trace_id} kind={kind_str} "
                    f"result=failed source={hydrate_source or 'unknown'} candidate_type={candidate_type} "
                    f"candidate_preview={candidate_preview}"
                )

        best_output = _extract_output_text(span, span_data, hydrated_export or exported)
        if best_output:
            text, source = best_output
            digest = hashlib.sha256(text.encode("utf-8", errors="ignore")).hexdigest()
            attach_large = (
                kind_str in self.policy.large_output_span_kinds
                or any(token in kind_str for token in ("response", "completion", "agent", "llm"))
            )
            last_digest = self._last_output_hash_by_trace.get(span.trace_id)

            if attach_large or digest != last_digest:
                self._last_output_hash_by_trace[span.trace_id] = digest
                payload = event.setdefault("data", {})
                preview = text[: self.policy.preview_chars] if self.policy.preview_chars > 0 else text
                payload["output_preview"] = preview
                payload["output_len"] = len(text)
                payload["output_source"] = source

                if attach_large:
                    blob_id, blob_text = self._maybe_make_blob(digest, text)
                    if blob_id:
                        payload["output_blob_ref"] = blob_id
                    if blob_text is not None:
                        payload["output_blob"] = blob_text
            else:
                self._last_output_hash_by_trace[span.trace_id] = digest

        error = getattr(span, "error", None)
        if error:
            err_payload = self._format_error(error)
            event["status"] = "error"
            payload = event.setdefault("data", {})
            payload["error"] = _redact_tree(err_payload, self.policy)

        return event

    def _collect_span_payload(
        self,
        span_data: Any,
    ) -> Tuple[Optional[Mapping[str, Any]], Optional[Dict[str, Any]]]:
        if span_data is None:
            return None, None

        exported: Optional[Mapping[str, Any]] = None
        
        # Treat mappings as first-class
        if isinstance(span_data, Mapping):
            exported = span_data
        else:
            # Try explicit export() first
            try:
                raw = span_data.export()  # type: ignore[attr-defined]
                if isinstance(raw, Mapping):
                    exported = raw
                else:
                    exported = getattr(span_data, "__dict__", None)
            except Exception:
                exported = getattr(span_data, "__dict__", None)

        data_payload: Optional[Dict[str, Any]] = None
        if exported:
            filtered = {k: v for k, v in exported.items() if k != "type"}
            data_payload = cast(Dict[str, Any], _redact_tree(filtered, self.policy))

        return exported, data_payload

    def _maybe_make_blob(self, digest: str, text: str) -> Tuple[Optional[str], Optional[str]]:
        encoded_size = len(text.encode("utf-8", errors="ignore"))
        if encoded_size > self.policy.max_blob_bytes:
            return None, None

        cached = self._blob_cache.get(digest)
        if cached:
            return cast(str, cached["blob_id"]), None

        blob_id = f"blob_{digest[:24]}"
        self._blob_cache[digest] = {"blob_id": blob_id, "size": encoded_size}
        self._blob_order.append(digest)
        if len(self._blob_order) > self.policy.blob_cache_size:
            evict = self._blob_order.pop(0)
            self._blob_cache.pop(evict, None)

        return blob_id, text

    def _format_error(self, error: SpanError | BaseException | Mapping[str, Any] | str) -> Dict[str, Any]:
        # Handle SpanError instances with full structure preservation
        if isinstance(error, SpanError):
            return {
                "message": error.message,
                "type": getattr(error, "type", type(error).__name__),
                "stack": getattr(error, "stack", None),
                "data": getattr(error, "data", None),
            }
        
        if isinstance(error, Mapping):
            payload: Dict[str, Any] = {"message": str(error.get("message") or error)}
            if "type" in error:
                payload["type"] = str(error["type"])
            if "stack_trace" in error:
                payload["stack_trace"] = str(error["stack_trace"])
            if "stack" in error:
                payload["stack"] = str(error["stack"])
            if "data" in error and error["data"] is not None:
                payload["data"] = error["data"]
            return payload

        if isinstance(error, BaseException):
            payload = {"message": str(getattr(error, "message", None) or error), "type": error.__class__.__name__}
            stack_trace = getattr(error, "stack_trace", None)
            if stack_trace:
                payload["stack_trace"] = str(stack_trace)
            stack = getattr(error, "stack", None)
            if stack:
                payload["stack"] = str(stack)
            data = getattr(error, "data", None)
            if data is not None:
                payload["data"] = data
            return payload

        if isinstance(error, str):
            return {"message": error}

        return {"message": str(error)}


__all__ = ["HttpExporter", "PayloadPolicy"]
