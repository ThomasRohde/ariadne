import type { SpanEvent, TraceEvent, TraceOrSpan } from '../types'

export interface SpanTreeNode {
  span: SpanEvent
  children: SpanTreeNode[]
}

export interface TraceTreeNode {
  traceId: string
  traceEvent: TraceEvent | null
  spans: SpanTreeNode[]
  latestTimestamp?: number
  label: string
  agentId: string
  agentLabel: string
}

export interface AgentGroup {
  id: string
  label: string
  traces: TraceTreeNode[]
}

/**
 * Build hierarchical tree structure from flat span list.
 * Shared across the trace explorer and timeline visualizations.
 */
export function buildSpanHierarchy(spans: SpanEvent[]): SpanTreeNode[] {
  const nodes = new Map<string, SpanTreeNode>()
  const roots: SpanTreeNode[] = []

  for (const span of spans) {
    nodes.set(span.span_id, { span, children: [] })
  }

  for (const node of nodes.values()) {
    if (node.span.parent_id && nodes.has(node.span.parent_id)) {
      const parent = nodes.get(node.span.parent_id)!
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (list: SpanTreeNode[]) => {
    list.sort((a, b) => {
      const aStart = a.span.started_at ? new Date(a.span.started_at).getTime() : 0
      const bStart = b.span.started_at ? new Date(b.span.started_at).getTime() : 0
      return aStart - bStart
    })
    list.forEach(node => sortNodes(node.children))
  }
  sortNodes(roots)

  return roots
}

/**
 * Group traces under their emitting agents using metadata fallbacks.
 */
export function buildAgentTraceGroups(events: TraceOrSpan[]): AgentGroup[] {
  const traceMap = new Map<
    string,
    {
      traceEvent: TraceEvent | null
      spans: SpanEvent[]
      latestTimestamp: number
    }
  >()
  const traceOrder: string[] = []

  for (const event of events) {
    const traceId = event.trace_id
    let aggregate = traceMap.get(traceId)
    if (!aggregate) {
      aggregate = {
        traceEvent: null,
        spans: [],
        latestTimestamp: 0
      }
      traceMap.set(traceId, aggregate)
      traceOrder.push(traceId)
    }

    if (event.type === 'trace') {
      aggregate.traceEvent = event
    } else {
      aggregate.spans.push(event)
    }

    const ts = getEventTimestamp(event)
    if (ts && ts > aggregate.latestTimestamp) {
      aggregate.latestTimestamp = ts
    } else if (!aggregate.latestTimestamp && ts) {
      aggregate.latestTimestamp = ts
    }
  }

  const agentOrder: string[] = []
  const agentMap = new Map<string, AgentGroup>()

  for (const traceId of traceOrder) {
    const aggregate = traceMap.get(traceId)!
    const traceEvent = aggregate.traceEvent

    const { agentId, agentLabel } = deriveAgentIdentity(traceEvent, traceId)
    const traceLabel = deriveTraceLabel(traceEvent, traceId)

    const traceNode: TraceTreeNode = {
      traceId,
      traceEvent,
      spans: buildSpanHierarchy(aggregate.spans),
      latestTimestamp: aggregate.latestTimestamp || undefined,
      label: traceLabel,
      agentId,
      agentLabel
    }

    if (!agentMap.has(agentId)) {
      agentMap.set(agentId, { id: agentId, label: agentLabel, traces: [] })
      agentOrder.push(agentId)
    }

    agentMap.get(agentId)!.traces.push(traceNode)
  }

  return agentOrder.map(agentId => agentMap.get(agentId)!)
}

function deriveAgentIdentity(traceEvent: TraceEvent | null, traceId: string) {
  const metadata = traceEvent?.metadata ?? {}
  const rawAgentId =
    metadata.agent ||
    metadata.agent_id ||
    metadata.agent_name ||
    traceEvent?.group_id ||
    traceEvent?.name ||
    traceId

  const id = sanitizeLabel(rawAgentId, traceId)
  const label =
    metadata.agent_name ||
    metadata.agent ||
    metadata.agent_id ||
    traceEvent?.name ||
    id

  return { agentId: id, agentLabel: label }
}

function deriveTraceLabel(traceEvent: TraceEvent | null, traceId: string) {
  return sanitizeLabel(traceEvent?.name ?? traceId, traceId)
}

function sanitizeLabel(value: string | undefined, fallback: string) {
  if (!value) return fallback
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : fallback
}

function getEventTimestamp(event: TraceOrSpan) {
  const timestamps = [
    'ended_at' in event ? event.ended_at : undefined,
    'started_at' in event ? event.started_at : undefined
  ].filter(Boolean) as string[]

  if (timestamps.length === 0) {
    return null
  }

  return new Date(timestamps[0]).getTime()
}
