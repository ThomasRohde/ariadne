import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TraceEvent, SpanEvent } from '../types'
import { buildSpanHierarchy, type SpanTreeNode } from '../utils/traceTree'

interface TraceTimelineProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  traceId: string
  traceEvent: TraceEvent | null
  spans: SpanEvent[]
  highlightSpanId?: string
}

const computeDuration = (started?: string, ended?: string): number | null => {
  if (!started || !ended) return null
  const start = new Date(started).getTime()
  const end = new Date(ended).getTime()
  if (Number.isNaN(start) || Number.isNaN(end)) return null
  return Math.max(0, end - start)
}

const formatDuration = (ms: number | null): string => {
  if (ms === null) return 'in progress'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

const formatTimestamp = (value: number | null): string => {
  if (value === null) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return '—'
  }
}

const calculateTimelineBar = (
  span: SpanEvent,
  minTime: number,
  maxTime: number
): {
  left: string
  width: string
  isIncomplete: boolean
} => {
  if (!span.started_at) {
    return { left: '0%', width: '0%', isIncomplete: true }
  }

  const range = Math.max(maxTime - minTime, 1)
  const startTime = new Date(span.started_at).getTime()
  const safeStart = Number.isNaN(startTime) ? minTime : startTime
  const rawEnd = span.ended_at ? new Date(span.ended_at).getTime() : safeStart
  const safeEnd = Number.isNaN(rawEnd) ? safeStart : rawEnd

  const clampedStart = Math.max(minTime, safeStart)
  const provisionalEnd = Math.max(clampedStart, safeEnd)
  const minVisibleWidth = range * 0.015
  const adjustedEnd = span.ended_at ? provisionalEnd : Math.max(provisionalEnd, clampedStart + minVisibleWidth)

  const leftPercent = ((clampedStart - minTime) / range) * 100
  const widthPercent = ((adjustedEnd - clampedStart) / range) * 100

  const left = Math.max(0, Math.min(100, leftPercent))
  const width = Math.max(1, Math.min(100 - left, widthPercent))

  return {
    left: `${left}%`,
    width: `${width}%`,
    isIncomplete: !span.ended_at
  }
}

interface SpanNodeProps {
  node: SpanTreeNode
  depth: number
  minTime: number
  maxTime: number
  highlightSpanId?: string
}

const SpanNode = ({ node, depth, minTime, maxTime, highlightSpanId }: SpanNodeProps) => {
  const [expanded, setExpanded] = useState(true)
  const { span, children } = node
  const duration = computeDuration(span.started_at, span.ended_at)
  const bar = calculateTimelineBar(span, minTime, maxTime)
  const isHighlighted = highlightSpanId === span.span_id
  const indent = `${depth * 1.25}rem`

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'rounded-lg border bg-card/70 transition-colors',
          isHighlighted &&
            'border-primary bg-primary/15 text-foreground shadow-inner dark:bg-primary/30 dark:text-foreground'
        )}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 text-sm"
          style={{ paddingLeft: indent }}
        >
          {children.length > 0 ? (
            <button
              type="button"
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border/60 bg-muted/60 text-muted-foreground transition hover:bg-muted"
              onClick={() => setExpanded(prev => !prev)}
              aria-label={expanded ? 'Collapse span' : 'Expand span'}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-6 w-6 shrink-0" />
          )}

          <div className="flex flex-1 items-center gap-2">
            <span className="truncate font-medium text-foreground" title={span.name || span.span_id}>
              {span.name || span.span_id}
            </span>
            {span.kind && (
              <Badge variant="secondary" className="rounded-md text-xs capitalize">
                {span.kind}
              </Badge>
            )}
            {span.status && (
              <Badge
                variant="secondary"
                className={cn(
                  'rounded-md text-xs uppercase',
                  span.status === 'ok'
                    ? 'bg-emerald-500/20 text-emerald-300'
                    : 'bg-rose-500/25 text-rose-200'
                )}
              >
                {span.status}
              </Badge>
            )}
          </div>

          <span className={cn('text-xs font-medium', duration === null && 'text-amber-400')}>
            {formatDuration(duration)}
          </span>
        </div>

        <div
          className="relative mx-3 mb-3 mt-2 h-6 overflow-hidden rounded-md border border-dashed border-border/70 bg-muted/40"
          style={{ marginLeft: indent }}
        >
          <div
            className={cn(
              'absolute flex h-full items-center gap-2 rounded-md px-2 text-xs font-medium text-background shadow-sm',
              bar.isIncomplete && 'border border-amber-400 bg-amber-500/70 text-amber-950',
              !bar.isIncomplete && span.status === 'error' && 'border border-rose-500/60 bg-rose-500/80 text-rose-50',
              !bar.isIncomplete && span.status !== 'error' && 'border border-primary/40 bg-primary/80 text-primary-950',
              isHighlighted && 'ring-2 ring-offset-2 ring-primary'
            )}
            style={{ left: bar.left, width: bar.width }}
            title={
              span.started_at
                ? span.ended_at
                  ? `${new Date(span.started_at).toLocaleString()} → ${new Date(span.ended_at).toLocaleString()}`
                  : `${new Date(span.started_at).toLocaleString()} (in progress)`
                : 'Timing unavailable'
            }
          >
            <span className="truncate">
              {span.kind || 'span'}
              {duration !== null ? ` • ${formatDuration(duration)}` : ' • in progress'}
            </span>
          </div>
        </div>
      </div>

      {expanded && children.length > 0 && (
        <div className="space-y-2">
          {children.map(child => (
            <SpanNode
              key={child.span.span_id}
              node={child}
              depth={depth + 1}
              minTime={minTime}
              maxTime={maxTime}
              highlightSpanId={highlightSpanId}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function TraceTimeline({
  open,
  onOpenChange,
  traceId,
  traceEvent,
  spans,
  highlightSpanId
}: TraceTimelineProps) {
  const hierarchy = useMemo(() => buildSpanHierarchy(spans), [spans])

  const bounds = useMemo(() => {
    const times: number[] = []

    if (traceEvent?.started_at) {
      times.push(new Date(traceEvent.started_at).getTime())
    }
    if (traceEvent?.ended_at) {
      times.push(new Date(traceEvent.ended_at).getTime())
    }

    for (const span of spans) {
      if (span.started_at) {
        times.push(new Date(span.started_at).getTime())
      }
      if (span.ended_at) {
        times.push(new Date(span.ended_at).getTime())
      }
    }

    if (times.length === 0) {
      return null
    }

    const min = Math.min(...times)
    const max = Math.max(...times)
    const safeMax = min === max ? min + 1 : max

    return {
      minTime: min,
      maxTime: safeMax,
      duration: safeMax - min
    }
  }, [traceEvent, spans])

  const traceDuration = bounds?.duration ?? null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-5xl overflow-hidden p-0">
        <DialogHeader className="space-y-1 border-b border-border/60 bg-card/80 px-6 py-4">
          <DialogTitle className="text-xl">Trace timeline</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Trace <code>{traceId}</code>{' '}
            {traceEvent?.name ? `· ${traceEvent.name}` : ''}
            {traceDuration !== null && ` · Duration ${formatDuration(traceDuration)}`}
            {` · ${spans.length} span${spans.length === 1 ? '' : 's'}`}
          </DialogDescription>
        </DialogHeader>

        {spans.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-12 text-sm text-muted-foreground">
            No spans recorded for this trace yet.
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-6">
            {bounds && (
              <div className="text-xs text-muted-foreground">
                <div className="flex items-center justify-between font-mono">
                  <span>{formatTimestamp(bounds.minTime)}</span>
                  <span>{formatTimestamp(bounds.maxTime)}</span>
                </div>
              </div>
            )}

            <ScrollArea className="max-h-[60vh] pr-4">
              <div className="space-y-3">
                {hierarchy.map(node => (
                  <SpanNode
                    key={node.span.span_id}
                    node={node}
                    depth={0}
                    minTime={bounds?.minTime ?? 0}
                    maxTime={bounds?.maxTime ?? 1}
                    highlightSpanId={highlightSpanId}
                  />
                ))}
              </div>
            </ScrollArea>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
