import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent } from 'react'
import { Activity, AlertTriangle, Database, FileText, Home, Pause, Play, RotateCcw, Settings, Trash2, WifiOff } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import FilterControls, { type FilterState } from './components/FilterControls'
import AgentTraceTree from './components/AgentTraceTree'
import TraceInspector from './components/TraceInspector'
import { ThemeToggle } from './components/ThemeToggle'
import { usePrivacyStore } from './hooks/usePrivacyStore'
import { useStreamControl } from './hooks/useStreamControl'
import {
  buildAgentTraceGroups,
  type AgentGroup,
  type TraceTreeNode,
  type SpanTreeNode
} from './utils/traceTree'
import { config } from './config'
import type { SelectedItem, SpanEvent, TraceOrSpan } from './types'

type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

const MIN_EXPLORER_WIDTH = 400
const MIN_INSPECTOR_WIDTH = 380
const MAX_INSPECTOR_WIDTH = 800
const DEFAULT_INSPECTOR_WIDTH = 550
const HANDLE_WIDTH = 1

const STATUS_META: Record<
  ConnectionStatus,
  { label: string; className: string; icon: JSX.Element }
> = {
  connecting: {
    label: 'Connecting',
    className:
      'border-amber-500/40 bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200',
    icon: <Activity className="h-3.5 w-3.5" />
  },
  connected: {
    label: 'Connected',
    className:
      'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-200',
    icon: <Activity className="h-3.5 w-3.5" />
  },
  disconnected: {
    label: 'Disconnected',
    className:
      'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:bg-rose-500/20 dark:text-rose-200',
    icon: <WifiOff className="h-3.5 w-3.5" />
  }
}

interface SpanLookupValue {
  span: SpanEvent
  traceId: string
}

export default function App() {
  const [events, setEvents] = useState<TraceOrSpan[]>([])
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<FilterState>({
    textSearch: '',
    eventTypes: new Set(['trace', 'span']),
    spanKinds: new Set(),
    traceId: ''
  })
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null)
  const [inspectorWidth, setInspectorWidth] = useState(DEFAULT_INSPECTOR_WIDTH)
  const [isLargeScreen, setIsLargeScreen] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia('(min-width: 1024px)').matches
  )

  const layoutRef = useRef<HTMLDivElement | null>(null)
  const moveHandlerRef = useRef<((event: MouseEvent) => void) | null>(null)
  const upHandlerRef = useRef<(() => void) | null>(null)

  const {
    isPrivacyEnabled,
    togglePrivacyMode,
    toggleEventReveal,
    shouldHideData
  } = usePrivacyStore()

  const {
    isPaused,
    bufferedCount,
    togglePause,
    bufferEvent,
    flushBufferedEvents
  } = useStreamControl()

  const computeClampedInspectorWidth = useCallback(
    (targetWidth: number, containerWidth?: number) => {
      const availableWidth = containerWidth ?? layoutRef.current?.getBoundingClientRect().width

      if (!availableWidth) {
        return Math.max(
          MIN_INSPECTOR_WIDTH,
          Math.min(targetWidth, MAX_INSPECTOR_WIDTH)
        )
      }

      const max = Math.min(
        MAX_INSPECTOR_WIDTH,
        Math.max(0, availableWidth - MIN_EXPLORER_WIDTH - HANDLE_WIDTH)
      )
      const min = Math.min(MIN_INSPECTOR_WIDTH, max)

      const clamped = Math.max(min, Math.min(targetWidth, max))
      return Number.isFinite(clamped) ? clamped : min
    },
    []
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsLargeScreen(event.matches)
    }

    const mediaQuery = window.matchMedia('(min-width: 1024px)')
    setIsLargeScreen(mediaQuery.matches)
    mediaQuery.addEventListener('change', handleMediaChange)

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange)
    }
  }, [])

  useEffect(() => {
    if (!isLargeScreen) return

    const handleResize = () => {
      setInspectorWidth(prev => computeClampedInspectorWidth(prev))
    }

    window.addEventListener('resize', handleResize)
    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [computeClampedInspectorWidth, isLargeScreen])

  useEffect(() => {
    if (!isLargeScreen) return
    setInspectorWidth(prev => computeClampedInspectorWidth(prev))
  }, [computeClampedInspectorWidth, isLargeScreen])

  useEffect(() => {
    return () => {
      if (moveHandlerRef.current) {
        window.removeEventListener('mousemove', moveHandlerRef.current)
        moveHandlerRef.current = null
      }
      if (upHandlerRef.current) {
        window.removeEventListener('mouseup', upHandlerRef.current)
        upHandlerRef.current = null
      }
      if (typeof document !== 'undefined') {
        document.body.style.userSelect = ''
      }
    }
  }, [])

  const inspectorStyle = useMemo<CSSProperties | undefined>(() => {
    if (!isLargeScreen) {
      return undefined
    }
    return {
      flexBasis: inspectorWidth,
      width: inspectorWidth
    }
  }, [inspectorWidth, isLargeScreen])

  const handleResizeStart = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!isLargeScreen || !layoutRef.current) return
      event.preventDefault()

      const rect = layoutRef.current.getBoundingClientRect()
      const containerWidth = rect.width

      if (moveHandlerRef.current) {
        window.removeEventListener('mousemove', moveHandlerRef.current)
        moveHandlerRef.current = null
      }
      if (upHandlerRef.current) {
        window.removeEventListener('mouseup', upHandlerRef.current)
        upHandlerRef.current = null
      }

      const onMouseMove = (moveEvent: MouseEvent) => {
        const pointerX = moveEvent.clientX - rect.left
        const rawInspectorWidth = containerWidth - pointerX - HANDLE_WIDTH / 2
        const nextWidth = computeClampedInspectorWidth(rawInspectorWidth, containerWidth)
        setInspectorWidth(nextWidth)
      }

      const stopDragging = () => {
        document.body.style.userSelect = ''
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', stopDragging)
        moveHandlerRef.current = null
        upHandlerRef.current = null
      }

      document.body.style.userSelect = 'none'
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', stopDragging)
      moveHandlerRef.current = onMouseMove
      upHandlerRef.current = stopDragging
    },
    [computeClampedInspectorWidth, isLargeScreen]
  )

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isLargeScreen) return

      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const delta = event.key === 'ArrowLeft' ? 24 : -24
        setInspectorWidth(prev => computeClampedInspectorWidth(prev + delta))
      }
    },
    [computeClampedInspectorWidth, isLargeScreen]
  )

  useEffect(() => {
    const eventSource = new EventSource(`${config.API_URL}/events`)

    eventSource.onopen = () => {
      setConnectionStatus('connected')
      setError(null)
      console.log('[Ariadne] Connected to event stream')
    }

    eventSource.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as TraceOrSpan | { type: 'connected' }
        if ('type' in event && event.type === 'connected') {
          console.log('[Ariadne] Stream connected:', event)
        } else if ('type' in event && (event.type === 'trace' || event.type === 'span')) {
          if (isPaused) {
            bufferEvent(event)
          } else {
            setEvents(prev => [event, ...prev])
          }
        }
      } catch (err) {
        console.error('[Ariadne] Failed to parse event:', err)
      }
    }

    eventSource.onerror = () => {
      setConnectionStatus('disconnected')
      setError('Connection lost. Retrying…')
      console.error('[Ariadne] SSE connection error')
    }

    return () => {
      eventSource.close()
    }
  }, [bufferEvent, isPaused])

  const clearEvents = useCallback(() => {
    setEvents([])
    setSelectedItem(null)
  }, [])

  const handleTogglePause = useCallback(() => {
    if (isPaused) {
      const buffered = flushBufferedEvents()
      if (buffered.length > 0) {
        setEvents(prev => [...buffered, ...prev])
      }
    }
    togglePause()
  }, [flushBufferedEvents, isPaused, togglePause])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.code === 'Space' &&
        !['INPUT', 'TEXTAREA'].includes((event.target as HTMLElement).tagName)
      ) {
        event.preventDefault()
        handleTogglePause()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleTogglePause])

  const availableSpanKinds = useMemo(() => {
    const kinds = new Set<string>()
    for (const event of events) {
      if (event.type === 'span' && event.kind) {
        kinds.add(event.kind)
      }
    }
    return Array.from(kinds).sort()
  }, [events])

  const filteredEvents = useMemo(() => {
    return events.filter(event => {
      if (!filters.eventTypes.has(event.type)) {
        return false
      }

      if (filters.traceId && event.trace_id !== filters.traceId) {
        return false
      }

      if (filters.spanKinds.size > 0 && event.type === 'span') {
        if (!event.kind || !filters.spanKinds.has(event.kind)) {
          return false
        }
      }

      if (filters.textSearch) {
        const searchLower = filters.textSearch.toLowerCase()
        const nameMatch = event.name?.toLowerCase().includes(searchLower)
        const dataMatch =
          event.type === 'span' &&
          event.data &&
          JSON.stringify(event.data).toLowerCase().includes(searchLower)
        if (!nameMatch && !dataMatch) {
          return false
        }
      }

      return true
    })
  }, [events, filters])

  const aggregation = useMemo<{
    agentGroups: AgentGroup[]
    traceLookup: Map<string, TraceTreeNode>
    spanLookup: Map<string, SpanLookupValue>
  }>(() => {
    const groups = buildAgentTraceGroups(filteredEvents)
    const traceLookup = new Map<string, TraceTreeNode>()
    const spanLookup = new Map<string, SpanLookupValue>()

    const collectSpans = (nodes: SpanTreeNode[], traceId: string) => {
      for (const node of nodes) {
        spanLookup.set(node.span.span_id, { span: node.span, traceId })
        if (node.children.length > 0) {
          collectSpans(node.children, traceId)
        }
      }
    }

    for (const group of groups) {
      for (const trace of group.traces) {
        traceLookup.set(trace.traceId, trace)
        collectSpans(trace.spans, trace.traceId)
      }
    }

    return { agentGroups: groups, traceLookup, spanLookup }
  }, [filteredEvents])

  useEffect(() => {
    if (!selectedItem) return

    if (selectedItem.kind === 'trace') {
      if (!aggregation.traceLookup.has(selectedItem.traceId)) {
        setSelectedItem(null)
      }
    } else {
      if (!aggregation.spanLookup.has(selectedItem.spanId)) {
        setSelectedItem(null)
      }
    }
  }, [selectedItem, aggregation])

  const status = STATUS_META[connectionStatus]

  return (
    <div className="flex h-screen bg-background">
      {/* Left Sidebar Navigation */}
      <div className="sidebar-bg flex w-14 flex-col items-center gap-4 border-r border-border py-4">
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground transition hover:bg-primary/90"
          title="Ariadne"
        >
          <Activity className="h-5 w-5" />
        </button>
        <div className="flex flex-1 flex-col gap-2">
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Dashboard"
          >
            <Home className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent text-foreground transition"
            title="Logs"
          >
            <FileText className="h-5 w-5" />
          </button>
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Storage"
          >
            <Database className="h-5 w-5" />
          </button>
        </div>
        <div className="flex flex-col gap-2">
          <ThemeToggle />
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Settings"
          >
            <Settings className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top Header with Breadcrumb */}
        <header className="flex h-14 items-center justify-between border-b border-border bg-background px-6">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Ariadne Trace Viewer</h1>
            <Badge variant="outline" className={status.className}>
              <span className="mr-1 inline-flex items-center gap-1.5">
                {status.icon}
                {status.label}
              </span>
            </Badge>
          </div>
          <div className="flex items-center gap-2">
            {isPaused && bufferedCount > 0 && (
              <Badge
                variant="secondary"
                className="bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-200"
              >
                {bufferedCount} buffered
              </Badge>
            )}
            <Button
              variant={isPaused ? 'default' : 'outline'}
              size="sm"
              onClick={handleTogglePause}
            >
              {isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
              {isPaused ? 'Resume' : 'Pause'}
            </Button>
            <Button variant="outline" size="sm" onClick={clearEvents}>
              <RotateCcw className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {error && (
          <div className="mx-6 mt-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            {error}
          </div>
        )}

        {/* Main Split Layout */}
        <div className="flex flex-1 overflow-hidden" ref={layoutRef}>
          {/* Left Panel - Trace Tree */}
          <div className="flex min-w-0 flex-1 flex-col border-r border-border bg-background">
            <div className="flex items-center justify-between border-b border-border px-6 py-3">
              <div className="flex items-center gap-3">
                <h2 className="text-sm font-semibold">Triage Agent</h2>
                <span className="text-xs text-muted-foreground">
                  {aggregation.agentGroups.length > 0 ? `${aggregation.traceLookup.size} traces` : 'No traces'}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={clearEvents}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <ScrollArea className="flex-1 px-6 py-4">
              <AgentTraceTree
                groups={aggregation.agentGroups}
                selectedItem={selectedItem}
                onSelect={setSelectedItem}
                isPrivacyEnabled={isPrivacyEnabled}
                shouldHideData={shouldHideData}
              />
            </ScrollArea>
          </div>

          {/* Resize Handle */}
          <div
            className="hidden lg:flex lg:w-[1px] lg:cursor-col-resize lg:bg-border lg:hover:w-[3px] lg:hover:bg-primary/30"
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize inspector panel"
            tabIndex={0}
            onMouseDown={handleResizeStart}
            onKeyDown={handleResizeKeyDown}
          />

          {/* Right Panel - Inspector */}
          <div
            className="flex min-w-0 shrink-0 flex-col bg-background"
            style={inspectorStyle}
          >
            <TraceInspector
              selectedItem={selectedItem}
              traceLookup={aggregation.traceLookup}
              spanLookup={aggregation.spanLookup}
              isPrivacyEnabled={isPrivacyEnabled}
              shouldHideData={shouldHideData}
              toggleEventReveal={toggleEventReveal}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
