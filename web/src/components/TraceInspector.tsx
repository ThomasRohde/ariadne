import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { ChevronDown, Copy, ThumbsDown, ThumbsUp } from 'lucide-react'
import type { SelectedItem, SpanEvent } from '../types'
import type { TraceTreeNode, SpanTreeNode } from '../utils/traceTree'
import { spanPrivacyId, tracePrivacyId } from '../utils/privacy'

interface SpanLookupValue {
  span: SpanEvent
  traceId: string
}

interface TraceInspectorProps {
  selectedItem: SelectedItem | null
  traceLookup: Map<string, TraceTreeNode>
  spanLookup: Map<string, SpanLookupValue>
  isPrivacyEnabled: boolean
  shouldHideData: (eventId: string) => boolean
  toggleEventReveal: (eventId: string) => void
}

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const LONG_STRING_THRESHOLD = 160
const RESPONSE_PREVIEW_LIMIT = 4000

interface ExtractedResponse {
  text: string
  source: string
}

// Heuristic paths for extracting high-signal model responses without deep cloning.
const responseCandidatePaths: Array<{ path: string[]; label?: string }> = [
  { path: ['final_output'] },
  { path: ['output_text'] },
  { path: ['response', 'final_output'] },
  { path: ['response', 'output_text'] },
  { path: ['response', 'text'] },
  { path: ['response', 'output'] },
  { path: ['output', 'final_output'] },
  { path: ['output', 'text'] },
  { path: ['output', 'output_text'] },
  { path: ['output', 'choices'] },
  { path: ['output'] },
  { path: ['result'] },
  { path: ['message'] },
  { path: ['messages'] },
  { path: ['content'] },
  { path: ['tool_output'] }
]

const getNestedValue = (data: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = data
  for (const segment of path) {
    if (Array.isArray(current)) {
      const index = Number(segment)
      if (Number.isNaN(index) || index < 0 || index >= current.length) {
        return undefined
      }
      current = current[index]
      continue
    }

    if (!isPlainObject(current)) {
      return undefined
    }

    current = current[segment]
    if (current === undefined) {
      return undefined
    }
  }
  return current
}

const extractTextCandidate = (value: unknown, depth = 0): string | null => {
  if (value === null || value === undefined) return null
  if (depth > 6) return null

  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed.length > 0 ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    const parts = value
      .map(item => extractTextCandidate(item, depth + 1))
      .filter((text): text is string => Boolean(text))
    if (parts.length === 0) return null
    return parts.join('\n\n').trim()
  }

  if (isPlainObject(value)) {
    const record = value as Record<string, unknown>

    if (typeof record.text === 'string') {
      const text = record.text.trim()
      if (text) return text
    }

    if (typeof record.output_text === 'string') {
      const text = record.output_text.trim()
      if (text) return text
    }

    if (typeof record.final_output === 'string') {
      const text = record.final_output.trim()
      if (text) return text
    }

    if (typeof record.message === 'string') {
      const text = record.message.trim()
      if (text) return text
    }

    if (typeof record.value === 'string') {
      const text = record.value.trim()
      if (text) return text
    }

    if (record.content !== undefined) {
      const text = extractTextCandidate(record.content, depth + 1)
      if (text) return text
    }

    if (record.messages !== undefined) {
      const text = extractTextCandidate(record.messages, depth + 1)
      if (text) return text
    }

    for (const key of ['output', 'response', 'result', 'answer', 'data']) {
      if (record[key] !== undefined) {
        const text = extractTextCandidate(record[key], depth + 1)
        if (text) return text
      }
    }
  }

  return null
}

const extractSpanResponse = (span: SpanEvent): ExtractedResponse | null => {
  if (!span.data || !isPlainObject(span.data)) {
    return null
  }

  const data = span.data

  for (const candidate of responseCandidatePaths) {
    const value = getNestedValue(data, candidate.path)
    const text = extractTextCandidate(value)
    if (text) {
      return {
        text,
        source: `data.${candidate.label ?? candidate.path.join('.')}`
      }
    }
  }

  const fallbackEntries = Object.entries(data).filter(([key]) =>
    /output|response|result|message|final/i.test(key)
  )

  for (const [key, value] of fallbackEntries) {
    const text = extractTextCandidate(value)
    if (text && text.split(/\s+/).length > 3) {
      return {
        text,
        source: `data.${key}`
      }
    }
  }

  return null
}

const PRETTY_JSON_INDENT = 2

const formatPrettyJson = (value: unknown): string => {
  if (value === null || value === undefined) {
    return ''
  }

  const replacer = (_key: string, current: unknown) => {
    if (typeof current === 'bigint') {
      return current.toString()
    }
    if (current instanceof Map) {
      return Object.fromEntries(current)
    }
    if (current instanceof Set) {
      return Array.from(current)
    }
    if (current instanceof Date) {
      return current.toISOString()
    }
    if (current instanceof Error) {
      return {
        name: current.name,
        message: current.message,
        stack: current.stack
      }
    }
    if (typeof current === 'symbol') {
      return current.toString()
    }
    return current
  }

  try {
    return JSON.stringify(value, replacer, PRETTY_JSON_INDENT) ?? ''
  } catch (error) {
    console.error('Failed to format JSON payload for display', error)
    const message =
      error instanceof Error ? `Unable to render payload: ${error.message}` : 'Unable to render payload'
    return `/* ${message} */`
  }
}

const formatTimestamp = (value?: string) => {
  if (!value) return '—'
  try {
    return new Date(value).toLocaleString()
  } catch {
    return value
  }
}

const computeDuration = (started?: string, ended?: string): number | null => {
  if (!started || !ended) return null
  const startTime = new Date(started).getTime()
  const endTime = new Date(ended).getTime()
  if (Number.isNaN(startTime) || Number.isNaN(endTime)) return null
  return endTime - startTime
}

const formatDuration = (ms: number | null) => {
  if (ms === null) return '—'
  if (ms < 1) return '<1ms'
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`
  return `${(ms / 60000).toFixed(2)}m`
}

const countSpanNodes = (nodes: SpanTreeNode[]): number => {
  let count = 0
  for (const node of nodes) {
    count += 1
    if (node.children.length > 0) {
      count += countSpanNodes(node.children)
    }
  }
  return count
}

const CopyButton = ({ value }: { value: string }) => {
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch (err) {
      console.error('Failed to copy to clipboard', err)
    }
  }

  return (
    <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground" onClick={handleCopy}>
      <Copy className="h-4 w-4" />
      <span className="sr-only">Copy value</span>
    </Button>
  )
}

const PropertyRow = ({
  label,
  value,
  mono
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) => (
  <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm">
    <span className="font-medium text-muted-foreground">{label}</span>
    <span className={cn('text-right text-foreground', mono && 'font-mono text-xs')}>{value}</span>
  </div>
)

const SummaryRow = ({
  label,
  value,
  copyValue
}: {
  label: string
  value: ReactNode
  copyValue?: string
}) => (
  <div className="group grid grid-cols-[120px_1fr_auto] items-center gap-3 rounded-lg border bg-card/70 px-3 py-2 text-sm">
    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground/80">
      {label}
    </span>
    <span className="truncate font-medium text-foreground">{value}</span>
    {copyValue ? <CopyButton value={copyValue} /> : <span className="h-8 w-8" />}
  </div>
)

const PrivacyNotice = ({
  message,
  actionLabel,
  onAction
}: {
  message: string
  actionLabel: string
  onAction: () => void
}) => (
  <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-sm text-muted-foreground">
    <p>{message}</p>
    <Button variant="secondary" size="sm" onClick={onAction}>
      {actionLabel}
    </Button>
  </div>
)

const MissingSelection = ({ message }: { message: string }) => (
  <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-muted px-6 text-center text-sm text-muted-foreground">
    {message}
  </div>
)

const formatCollapsedSummary = (value: unknown): string => {
  if (Array.isArray(value)) {
    if (value.length === 0) return 'Empty array'
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) return 'Empty object'
    const keyPreview = keys.slice(0, 3).join(', ')
    return `${keys.length} key${keys.length === 1 ? '' : 's'}${keyPreview ? ` • ${keyPreview}` : ''}`
  }

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return ''
    return trimmed.length > 48 ? `${trimmed.slice(0, 48)}…` : trimmed
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return ''
}

const CollapsibleField = ({
  label,
  summary,
  isExpanded,
  onToggle,
  children
}: {
  label: string
  summary?: string
  isExpanded: boolean
  onToggle: () => void
  children: ReactNode
}) => (
  <div className="space-y-1">
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={isExpanded}
      className="flex w-full items-center justify-between rounded-md border border-muted bg-muted/20 px-3 py-2 text-left transition hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <span className="flex items-center gap-2">
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200',
            isExpanded && 'rotate-180'
          )}
        />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      </span>
      <span className="max-w-[220px] truncate text-right text-xs text-muted-foreground/80">
        {summary ?? ''}
      </span>
    </button>
    {isExpanded ? <div className="space-y-2 border-l border-dashed border-muted pl-3">{children}</div> : null}
  </div>
)

interface StructuredValueProps {
  label: string
  value: unknown
  path: string[]
}

const StructuredValue = ({ label, value, path }: StructuredValueProps) => {
  const pathKey = path.join('.') || label
  const [isExpanded, setIsExpanded] = useState(false)
  const isComposite = Array.isArray(value) || isPlainObject(value)

  useEffect(() => {
    if (isComposite) {
      setIsExpanded(false)
    }
  }, [pathKey, isComposite])

  if (
    value === null ||
    value === undefined ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    const stringified = value === null || value === undefined ? '' : String(value)
    const shouldUseMultiline =
      typeof value === 'string' &&
      (value.includes('\n') || value.length > LONG_STRING_THRESHOLD)

    if (shouldUseMultiline) {
      const rows = Math.min(12, Math.max(3, stringified.split('\n').length))
      return (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <textarea
            readOnly
            value={stringified}
            rows={rows}
            className="w-full rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground focus-visible:outline-none"
          />
        </div>
      )
    }

    return (
      <div className="space-y-1">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </span>
        <input
          readOnly
          value={stringified}
          className="w-full rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground focus-visible:outline-none"
        />
      </div>
    )
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <input
            readOnly
            value="[]"
            className="w-full rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground focus-visible:outline-none"
          />
        </div>
      )
    }

    return (
      <CollapsibleField
        label={label}
        summary={formatCollapsedSummary(value)}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(prev => !prev)}
      >
        {value.map((item, index) => (
          <StructuredValue
            key={`${pathKey}.${index}`}
            label={`[${index}]`}
            value={item}
            path={[...path, `${index}`]}
          />
        ))}
      </CollapsibleField>
    )
  }

  if (isPlainObject(value)) {
    const entries = Object.entries(value)
    if (entries.length === 0) {
      return (
        <div className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {label}
          </span>
          <input
            readOnly
            value="{}"
            className="w-full rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground focus-visible:outline-none"
          />
        </div>
      )
    }

    return (
      <CollapsibleField
        label={label}
        summary={formatCollapsedSummary(value)}
        isExpanded={isExpanded}
        onToggle={() => setIsExpanded(prev => !prev)}
      >
        {entries.map(([childKey, childValue]) => (
          <StructuredValue
            key={`${pathKey}.${childKey}`}
            label={childKey}
            value={childValue}
            path={[...path, childKey]}
          />
        ))}
      </CollapsibleField>
    )
  }

  let stringValue = ''
  try {
    stringValue = JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    stringValue = String(value)
  }

  return (
    <div className="space-y-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <textarea
        readOnly
        value={stringValue}
        rows={Math.min(12, stringValue.split('\n').length + 1)}
        className="w-full rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs text-muted-foreground focus-visible:outline-none"
      />
    </div>
  )
}

export default function TraceInspector({
  selectedItem,
  traceLookup,
  spanLookup,
  isPrivacyEnabled,
  shouldHideData,
  toggleEventReveal
}: TraceInspectorProps) {
  const [activeTab, setActiveTab] = useState<'response' | 'properties' | 'raw'>('response')
  
  const isTraceSelection = selectedItem?.kind === 'trace'
  const isSpanSelection = selectedItem?.kind === 'span'

  const traceNode = isTraceSelection && selectedItem
    ? traceLookup.get(selectedItem.traceId) ?? null
    : null

  const spanEntry = isSpanSelection && selectedItem
    ? spanLookup.get(selectedItem.spanId) ?? null
    : null

  const span = spanEntry?.span ?? null
  const spanTraceNode = spanEntry ? traceLookup.get(spanEntry.traceId) ?? null : null
  const spanPrivacyKey = span ? spanPrivacyId(span.span_id) : null

  const [showFullResponse, setShowFullResponse] = useState(false)

  useEffect(() => {
    setShowFullResponse(false)
    setActiveTab('response')
  }, [span?.span_id, traceNode?.traceId])

  const dataHidden = spanPrivacyKey ? isPrivacyEnabled && shouldHideData(spanPrivacyKey) : false

  const responseDetails = useMemo(() => {
    if (!span) {
      return null
    }
    return extractSpanResponse(span)
  }, [span])

  const spanDuration = span ? computeDuration(span.started_at, span.ended_at) : null

  const isResponseTruncated = Boolean(
    responseDetails && responseDetails.text.length > RESPONSE_PREVIEW_LIMIT && !showFullResponse
  )
  const responsePreview = responseDetails
    ? showFullResponse || responseDetails.text.length <= RESPONSE_PREVIEW_LIMIT
      ? responseDetails.text
      : `${responseDetails.text.slice(0, RESPONSE_PREVIEW_LIMIT)}…`
    : null
  const rawEventJson = useMemo(() => (span ? formatPrettyJson(span) : ''), [span])
  const payloadJson = useMemo(() => (span?.data ? formatPrettyJson(span.data) : ''), [span])
  const hasRawEventJson = rawEventJson.trim().length > 0
  const hasPayloadJson = payloadJson.trim().length > 0
  const hasSpanData = Boolean(span?.data && Object.keys(span.data).length > 0)

  if (!selectedItem) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
        Select a trace or span to view details
      </div>
    )
  }

  if (isTraceSelection) {
    if (!traceNode) {
      return <MissingSelection message="Selected trace is no longer available." />
    }

    const traceEvent = traceNode.traceEvent
    const metadataEntries = traceEvent?.metadata ? Object.entries(traceEvent.metadata) : []
    const tracePrivacyKey = tracePrivacyId(traceNode.traceId)
    const metadataHidden = isPrivacyEnabled && shouldHideData(tracePrivacyKey)
    const spanCount = countSpanNodes(traceNode.spans)
    const duration = traceEvent ? computeDuration(traceEvent.started_at, traceEvent.ended_at) : null

    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h3 className="font-semibold text-foreground">{traceEvent?.type || 'Trace'}</h3>
            <p className="text-xs text-muted-foreground">{traceNode.label}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs uppercase">
              Trace
            </Badge>
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="space-y-6 p-6">
            <div className="space-y-3">
              <h4 className="text-sm font-semibold">Properties</h4>
              <div className="space-y-2">
                <PropertyRow label="Created" value={formatTimestamp(traceEvent?.started_at)} />
                <PropertyRow label="ID" value={traceNode.traceId} mono />
                {duration !== null && <PropertyRow label="Duration" value={formatDuration(duration)} />}
                <PropertyRow label="Spans" value={`${spanCount}`} />
              </div>
            </div>

            {metadataEntries.length > 0 && !metadataHidden && (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Metadata</h4>
                <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-4">
                  {metadataEntries.map(([key, value]) => (
                    <StructuredValue key={key} label={key} value={value} path={[key]} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="flex items-center justify-center gap-2 border-t border-border px-6 py-3">
          <Button variant="ghost" size="sm">
            <ThumbsUp className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm">
            <ThumbsDown className="h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }

  if (!spanEntry || !span) {
    return <MissingSelection message="Selected span is no longer available." />
  }

  const trace = spanTraceNode

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div>
          <h3 className="font-semibold text-foreground">{span.kind?.toUpperCase() || 'SPAN'} {span.name ? `/${span.name}` : ''}</h3>
          <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Copy className="h-3 w-3" />
              {span.span_id.slice(0, 12)}
            </span>
            {spanDuration !== null && (
              <span>{formatDuration(spanDuration)}</span>
            )}
            {span.status && (
              <Badge
                variant="secondary"
                className={cn(
                  'text-xs uppercase',
                  span.status === 'ok' ? 'bg-emerald-500/15 text-emerald-600' : 'bg-rose-500/15 text-rose-600'
                )}
              >
                {span.status}
              </Badge>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-px border-b border-border bg-muted px-6">
        <button
          type="button"
          onClick={() => setActiveTab('response')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition',
            activeTab === 'response'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Response
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('properties')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition',
            activeTab === 'properties'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Properties
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('raw')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition',
            activeTab === 'raw'
              ? 'border-b-2 border-primary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          Raw
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6">
          {activeTab === 'response' && (
            <div className="space-y-4">
              {dataHidden ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  <p className="mb-3">Response data is hidden in privacy mode</p>
                  {spanPrivacyKey && (
                    <Button variant="outline" size="sm" onClick={() => toggleEventReveal(spanPrivacyKey)}>
                      Reveal Data
                    </Button>
                  )}
                </div>
              ) : responseDetails ? (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Output</h4>
                    <div className="flex items-center gap-2">
                      {responseDetails.text.length > RESPONSE_PREVIEW_LIMIT && (
                        <Button variant="outline" size="sm" onClick={() => setShowFullResponse(!showFullResponse)}>
                          {showFullResponse ? 'Collapse' : 'Expand'}
                        </Button>
                      )}
                      <Button variant="outline" size="sm" onClick={() => navigator.clipboard.writeText(responseDetails.text)}>
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className={cn(
                    'rounded-lg border border-border bg-muted/30 p-4 font-mono text-sm',
                    showFullResponse ? 'max-h-none' : 'max-h-96 overflow-auto'
                  )}>
                    <pre className="whitespace-pre-wrap break-words">{responsePreview}</pre>
                  </div>
                  {isResponseTruncated && (
                    <p className="text-xs text-muted-foreground">
                      Showing first {RESPONSE_PREVIEW_LIMIT.toLocaleString()} characters
                    </p>
                  )}
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No response data available
                </div>
              )}
            </div>
          )}

          {activeTab === 'properties' && (
            <div className="space-y-4">
              <div className="space-y-3">
                <h4 className="text-sm font-semibold">Configuration</h4>
                <div className="space-y-2">
                  <PropertyRow label="Span ID" value={span.span_id} mono />
                  <PropertyRow label="Trace ID" value={span.trace_id} mono />
                  {span.parent_id && <PropertyRow label="Parent ID" value={span.parent_id} mono />}
                  {span.kind && <PropertyRow label="Kind" value={span.kind} />}
                  {span.started_at && <PropertyRow label="Started" value={formatTimestamp(span.started_at)} />}
                  {span.ended_at && <PropertyRow label="Ended" value={formatTimestamp(span.ended_at)} />}
                  {spanDuration !== null && <PropertyRow label="Duration" value={formatDuration(spanDuration)} />}
                </div>
              </div>

              {hasSpanData && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Data</h4>
                    <div className="flex items-center gap-2">
                      {dataHidden && spanPrivacyKey && (
                        <Button variant="outline" size="sm" onClick={() => toggleEventReveal(spanPrivacyKey)}>
                          Reveal
                        </Button>
                      )}
                      {!dataHidden && hasPayloadJson && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (!hasPayloadJson) return
                            void navigator.clipboard.writeText(payloadJson)
                          }}
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  {dataHidden ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      <p className="mb-3">Data hidden in privacy mode</p>
                      {spanPrivacyKey && (
                        <Button variant="outline" size="sm" onClick={() => toggleEventReveal(spanPrivacyKey)}>
                          Reveal Data
                        </Button>
                      )}
                    </div>
                  ) : hasPayloadJson ? (
                    <div className="max-h-[400px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs">
                      <pre className="whitespace-pre-wrap break-words">{payloadJson}</pre>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                      No payload data available
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {activeTab === 'raw' && (
            <div className="space-y-4">
              {dataHidden ? (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  <p className="mb-3">Raw event data is hidden in privacy mode</p>
                  {spanPrivacyKey && (
                    <Button variant="outline" size="sm" onClick={() => toggleEventReveal(spanPrivacyKey)}>
                      Reveal Data
                    </Button>
                  )}
                </div>
              ) : hasRawEventJson ? (
                <>
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold">Raw Event</h4>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!hasRawEventJson}
                      onClick={() => {
                        if (!hasRawEventJson) return
                        void navigator.clipboard.writeText(rawEventJson)
                      }}
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="max-h-[600px] overflow-auto rounded-lg border border-border bg-muted/30 p-4 font-mono text-xs">
                    <pre className="whitespace-pre-wrap break-words">{rawEventJson}</pre>
                  </div>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                  No raw event data available
                </div>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      <div className="flex items-center justify-center gap-2 border-t border-border px-6 py-3">
        <Button variant="ghost" size="sm">
          <ThumbsUp className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm">
          <ThumbsDown className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}
