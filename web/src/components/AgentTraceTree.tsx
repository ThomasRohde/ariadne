import { useState, type Dispatch, type SetStateAction } from 'react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { ChevronDown, ChevronRight, Eye, EyeOff } from 'lucide-react'
import type { SelectedItem, SpanEvent } from '../types'
import type { AgentGroup, SpanTreeNode, TraceTreeNode } from '../utils/traceTree'
import { spanPrivacyId, tracePrivacyId } from '../utils/privacy'
import { AgentIcon, getSpanIcon } from './EventIcons'

interface AgentTraceTreeProps {
  groups: AgentGroup[]
  selectedItem: SelectedItem | null
  onSelect: (item: SelectedItem) => void
  isPrivacyEnabled: boolean
  shouldHideData: (eventId: string) => boolean
}

interface TimelineBounds {
  minTime: number
  maxTime: number
}

interface TimelineBar {
  left: string
  width: string
  isIncomplete: boolean
  duration: number | null
}

const MIN_WIDTH_RATIO = 0.0125
const MIN_WIDTH_PERCENT = 1

const parseTimestamp = (value?: string): number | null => {
  if (!value) return null
  const ts = new Date(value).getTime()
  return Number.isNaN(ts) ? null : ts
}

const formatDuration = (ms: number | null): string => {
  if (ms === null) return 'in progress'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

const collectSpanList = (nodes: SpanTreeNode[]): SpanEvent[] => {
  const result: SpanEvent[] = []
  const walk = (current: SpanTreeNode[]) => {
    for (const node of current) {
      result.push(node.span)
      if (node.children.length > 0) {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return result
}

const computeTimelineBounds = (trace: TraceTreeNode): TimelineBounds | null => {
  const timestamps: number[] = []

  if (trace.traceEvent?.started_at) {
    const ts = parseTimestamp(trace.traceEvent.started_at)
    if (ts !== null) timestamps.push(ts)
  }
  if (trace.traceEvent?.ended_at) {
    const ts = parseTimestamp(trace.traceEvent.ended_at)
    if (ts !== null) timestamps.push(ts)
  }

  for (const span of collectSpanList(trace.spans)) {
    const start = parseTimestamp(span.started_at)
    const end = parseTimestamp(span.ended_at)
    if (start !== null) timestamps.push(start)
    if (end !== null) timestamps.push(end)
  }

  if (timestamps.length === 0) {
    return null
  }

  const min = Math.min(...timestamps)
  const maxCandidate = Math.max(...timestamps)
  const max = min === maxCandidate ? min + 1 : maxCandidate

  return {
    minTime: min,
    maxTime: max
  }
}

const computeTimelineBar = (
  start: number | null,
  end: number | null,
  bounds: TimelineBounds,
  isIncomplete: boolean
): TimelineBar | null => {
  if (start === null) {
    return null
  }

  const range = Math.max(bounds.maxTime - bounds.minTime, 1)
  const clampedStart = Math.max(bounds.minTime, start)
  const fallbackEnd = end ?? bounds.maxTime
  const safeEnd = Math.max(clampedStart, fallbackEnd)
  const minWidthMs = range * MIN_WIDTH_RATIO
  const adjustedEnd = isIncomplete ? Math.max(safeEnd, clampedStart + minWidthMs) : safeEnd

  const leftPercent = ((clampedStart - bounds.minTime) / range) * 100
  const widthPercent = ((adjustedEnd - clampedStart) / range) * 100

  const left = Math.max(0, Math.min(100, leftPercent))
  const width = Math.max(MIN_WIDTH_PERCENT, Math.min(100 - left, widthPercent))

  const duration = end !== null ? Math.max(0, end - start) : null

  return {
    left: `${left}%`,
    width: `${width}%`,
    isIncomplete,
    duration
  }
}

const countSpans = (nodes: SpanTreeNode[]): number =>
  nodes.reduce((total, current) => total + 1 + countSpans(current.children), 0)

export default function AgentTraceTree({
  groups,
  selectedItem,
  onSelect,
  isPrivacyEnabled,
  shouldHideData
}: AgentTraceTreeProps) {
  const [collapsedAgents, setCollapsedAgents] = useState<Set<string>>(new Set())
  const [collapsedTraces, setCollapsedTraces] = useState<Set<string>>(new Set())
  const [collapsedSpans, setCollapsedSpans] = useState<Set<string>>(new Set())

  const toggleId = (set: Dispatch<SetStateAction<Set<string>>>, id: string) => {
    set(prev => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  if (groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <AgentIcon className="h-8 w-8" />
        <div>
          <p className="font-medium">No traces available</p>
          <p className="mt-1 text-xs">Stream events to populate the dashboard</p>
        </div>
      </div>
    )
  }

  const renderSpanNode = (
    node: SpanTreeNode,
    traceId: string,
    depth: number,
    bounds: TimelineBounds | null
  ): JSX.Element => {
    const { span, children } = node
    const hasChildren = children.length > 0
    const isCollapsed = collapsedSpans.has(span.span_id)
    const isSelected = selectedItem?.kind === 'span' && selectedItem.spanId === span.span_id
    const isTraceActive = selectedItem?.traceId === traceId
    const isHidden = isPrivacyEnabled ? shouldHideData(spanPrivacyId(span.span_id)) : false
    const bar = bounds
      ? computeTimelineBar(parseTimestamp(span.started_at), parseTimestamp(span.ended_at), bounds, !span.ended_at)
      : null

    return (
      <div key={span.span_id} className="space-y-1">
        <div
          className={cn(
            'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50',
            isSelected && 'bg-primary/10 hover:bg-primary/10',
            !isSelected && isTraceActive && 'bg-accent/30'
          )}
          style={{ paddingLeft: `${depth}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
              onClick={() => toggleId(setCollapsedSpans, span.span_id)}
              aria-label={isCollapsed ? 'Expand span' : 'Collapse span'}
            >
              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          ) : (
            <span className="h-5 w-5 shrink-0" />
          )}

          <div className="shrink-0">{getSpanIcon(span)}</div>

          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() =>
              onSelect({
                kind: 'span',
                traceId,
                spanId: span.span_id
              })
            }
          >
            <span className="truncate font-medium text-foreground" title={span.name || span.span_id}>
              {span.name || span.span_id}
            </span>
          </button>

          <div className="flex shrink-0 items-center gap-2">
            {bar && bar.duration !== null && (
              <span className="text-xs text-muted-foreground">{formatDuration(bar.duration)}</span>
            )}
            {bar && bar.isIncomplete && (
              <span className="text-xs text-amber-600">in progress</span>
            )}
          </div>

          <div className="relative h-4 w-48 shrink-0 overflow-hidden rounded-sm bg-muted">
            {bar && (
              <div
                className={cn(
                  'absolute h-full rounded-sm',
                  bar.isIncomplete && 'bg-amber-500/60',
                  !bar.isIncomplete && span.status === 'error' && 'bg-rose-500/70',
                  !bar.isIncomplete && span.status !== 'error' && 'bg-cyan-500/70'
                )}
                style={{ left: bar.left, width: bar.width }}
                title={
                  span.started_at
                    ? span.ended_at
                      ? `${new Date(span.started_at).toLocaleString()} → ${new Date(span.ended_at).toLocaleString()}`
                      : `${new Date(span.started_at).toLocaleString()} (in progress)`
                    : 'Timing unavailable'
                }
              />
            )}
          </div>
        </div>

        {!isCollapsed && hasChildren && (
          <div className="space-y-1">
            {children.map(child => renderSpanNode(child, traceId, depth + 1, bounds))}
          </div>
        )}
      </div>
    )
  }

  const renderTraceNode = (trace: TraceTreeNode): JSX.Element => {
    const isCollapsed = collapsedTraces.has(trace.traceId)
    const spanCount = countSpans(trace.spans)
    const isSelectedTrace = selectedItem?.kind === 'trace' && selectedItem.traceId === trace.traceId
    const isActiveTrace = selectedItem?.traceId === trace.traceId
    const bounds = computeTimelineBounds(trace)
    const traceStart = parseTimestamp(trace.traceEvent?.started_at)
    const traceEnd = parseTimestamp(trace.traceEvent?.ended_at)
    const traceBar = bounds
      ? computeTimelineBar(traceStart, traceEnd, bounds, Boolean(traceStart) && !traceEnd)
      : null

    return (
      <div key={trace.traceId} className="space-y-1">
        <div
          className={cn(
            'group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-accent/50',
            isSelectedTrace && 'bg-primary/10 hover:bg-primary/10',
            !isSelectedTrace && isActiveTrace && 'bg-accent/30'
          )}
        >
          <button
            type="button"
            className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
            onClick={() => toggleId(setCollapsedTraces, trace.traceId)}
            aria-label={isCollapsed ? 'Expand trace' : 'Collapse trace'}
          >
            {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>

          <div className="shrink-0">
            <AgentIcon />
          </div>

          <button
            type="button"
            className="flex min-w-0 flex-1 items-center gap-2 text-left"
            onClick={() => onSelect({ kind: 'trace', traceId: trace.traceId })}
          >
            <span className="truncate font-medium">{trace.label}</span>
            {trace.traceEvent?.started_at && (
              <span className="text-xs text-muted-foreground">
                {new Date(trace.traceEvent.started_at).toLocaleTimeString()}
              </span>
            )}
          </button>

          <div className="flex shrink-0 items-center gap-2">
            {traceBar && traceBar.duration !== null && (
              <span className="text-xs text-muted-foreground">{formatDuration(traceBar.duration)}</span>
            )}
          </div>

          <div className="relative h-4 w-48 shrink-0 overflow-hidden rounded-sm bg-muted">
            {bounds && traceBar && (
              <div
                className={cn(
                  'absolute h-full rounded-sm bg-cyan-500/70',
                  traceBar.isIncomplete && 'bg-amber-500/60'
                )}
                style={{ left: traceBar.left, width: traceBar.width }}
                title={
                  traceStart
                    ? traceEnd
                      ? `${new Date(traceStart).toLocaleString()} → ${new Date(traceEnd).toLocaleString()}`
                      : `${new Date(traceStart).toLocaleString()} (in progress)`
                    : 'Timing unavailable'
                }
              />
            )}
          </div>
        </div>

        {!isCollapsed && trace.spans.length > 0 && (
          <div className="space-y-1">
            {trace.spans.map(node => renderSpanNode(node, trace.traceId, 1, bounds ?? null))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {groups.map(group => {
        const isCollapsed = collapsedAgents.has(group.id)
        return (
          <div key={group.id} className="space-y-2">
            <div className="flex items-center gap-2 px-2">
              <button
                type="button"
                className="flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground transition hover:text-foreground"
                onClick={() => toggleId(setCollapsedAgents, group.id)}
                aria-label={isCollapsed ? 'Expand agent' : 'Collapse agent'}
              >
                {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              <div className="flex flex-1 items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">{group.label}</p>
                </div>
                <span className="text-xs text-muted-foreground">{group.traces.length} traces</span>
              </div>
            </div>
            {!isCollapsed && (
              <div className="space-y-1">
                {group.traces.map(trace => renderTraceNode(trace))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
