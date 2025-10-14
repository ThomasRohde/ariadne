import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Switch } from '@/components/ui/switch'
import { ChevronsUpDown, Shield, X } from 'lucide-react'

export interface FilterState {
  textSearch: string
  eventTypes: Set<'trace' | 'span'>
  spanKinds: Set<string>
  traceId: string
}

interface FilterControlsProps {
  filters: FilterState
  onFiltersChange: (filters: FilterState) => void
  availableSpanKinds: string[]
  isPrivacyEnabled: boolean
  onPrivacyToggle: () => void
}

const EVENT_TYPES: Array<'trace' | 'span'> = ['trace', 'span']

export default function FilterControls({
  filters,
  onFiltersChange,
  availableSpanKinds,
  isPrivacyEnabled,
  onPrivacyToggle
}: FilterControlsProps) {
  const [spanMenuOpen, setSpanMenuOpen] = useState(false)

  const handleTextSearchChange = (value: string) => {
    onFiltersChange({ ...filters, textSearch: value })
  }

  const handleEventTypeToggle = (type: 'trace' | 'span') => {
    const next = new Set(filters.eventTypes)
    if (next.has(type)) {
      next.delete(type)
    } else {
      next.add(type)
    }
    onFiltersChange({ ...filters, eventTypes: next })
  }

  const handleSpanKindToggle = (kind: string) => {
    const next = new Set(filters.spanKinds)
    if (next.has(kind)) {
      next.delete(kind)
    } else {
      next.add(kind)
    }
    onFiltersChange({ ...filters, spanKinds: next })
  }

  const handleTraceIdChange = (value: string) => {
    onFiltersChange({ ...filters, traceId: value })
  }

  const clearFilter = (filterType: 'textSearch' | 'eventTypes' | 'spanKinds' | 'traceId') => {
    switch (filterType) {
      case 'textSearch':
        onFiltersChange({ ...filters, textSearch: '' })
        break
      case 'eventTypes':
        onFiltersChange({ ...filters, eventTypes: new Set(['trace', 'span']) })
        break
      case 'spanKinds':
        onFiltersChange({ ...filters, spanKinds: new Set() })
        break
      case 'traceId':
        onFiltersChange({ ...filters, traceId: '' })
        break
    }
  }

  const clearAllFilters = () => {
    onFiltersChange({
      textSearch: '',
      eventTypes: new Set(['trace', 'span']),
      spanKinds: new Set(),
      traceId: ''
    })
  }

  const hasActiveFilters =
    filters.textSearch !== '' ||
    filters.eventTypes.size < 2 ||
    filters.spanKinds.size > 0 ||
    filters.traceId !== ''

  return (
    <Card className="border-none bg-transparent shadow-none">
      <CardHeader className="space-y-3 p-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold">Filters</CardTitle>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              Clear All
            </Button>
          )}
        </div>
        <CardDescription>Refine the event stream to focus on the signals you need.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-6 p-0">
        <div className="flex items-start justify-between rounded-xl border bg-card/60 p-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4 text-primary" />
              Privacy Mode
            </div>
            <p className="text-xs text-muted-foreground">
              {isPrivacyEnabled
                ? 'Payloads stay hidden until you reveal them for a specific event.'
                : 'Payloads are visible. Enable privacy to hide sensitive fields.'}
            </p>
          </div>
          <Switch checked={isPrivacyEnabled} onCheckedChange={() => onPrivacyToggle()} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="text-search" className="text-xs uppercase tracking-wide text-muted-foreground">
            Search (name/data)
          </Label>
          <div className="relative">
            <Input
              id="text-search"
              value={filters.textSearch}
              placeholder="Filter by name or payload contents…"
              onChange={(event) => handleTextSearchChange(event.target.value)}
              className="pr-9"
            />
            {filters.textSearch && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
                onClick={() => clearFilter('textSearch')}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear search</span>
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <Label className="text-xs uppercase tracking-wide text-muted-foreground">
            Event Type
          </Label>
          <div className="flex gap-3">
            {EVENT_TYPES.map((type) => (
              <div key={type} className="flex items-center gap-2">
                <Checkbox
                  id={`event-${type}`}
                  checked={filters.eventTypes.has(type)}
                  onCheckedChange={() => handleEventTypeToggle(type)}
                />
                <Label htmlFor={`event-${type}`} className="text-sm font-medium">
                  {type === 'trace' ? 'Trace' : 'Span'}
                </Label>
              </div>
            ))}
          </div>
        </div>

        {availableSpanKinds.length > 0 && (
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">
              Span Kind
            </Label>
            <DropdownMenu open={spanMenuOpen} onOpenChange={setSpanMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="w-full justify-between">
                  <span>
                    {filters.spanKinds.size === 0
                      ? 'All kinds'
                      : `${filters.spanKinds.size} selected`}
                  </span>
                  <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-64">
                <DropdownMenuLabel className="flex items-center justify-between">
                  Span kinds
                  {filters.spanKinds.size > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        clearFilter('spanKinds')
                        setSpanMenuOpen(false)
                      }}
                    >
                      Reset
                    </Button>
                  )}
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {availableSpanKinds.map((kind) => (
                  <DropdownMenuCheckboxItem
                    key={kind}
                    checked={filters.spanKinds.has(kind)}
                    onCheckedChange={() => handleSpanKindToggle(kind)}
                    className="capitalize"
                  >
                    {kind}
                  </DropdownMenuCheckboxItem>
                ))}
                {availableSpanKinds.length === 0 && (
                  <DropdownMenuLabel className="text-center text-xs text-muted-foreground">
                    No span kinds detected.
                  </DropdownMenuLabel>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="trace-id" className="text-xs uppercase tracking-wide text-muted-foreground">
            Trace ID
          </Label>
          <div className="relative">
            <Input
              id="trace-id"
              value={filters.traceId}
              placeholder="Filter by exact trace identifier…"
              onChange={(event) => handleTraceIdChange(event.target.value)}
              className="pr-9"
            />
            {filters.traceId && (
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="absolute right-1 top-1 h-8 w-8 text-muted-foreground"
                onClick={() => clearFilter('traceId')}
              >
                <X className="h-4 w-4" />
                <span className="sr-only">Clear trace filter</span>
              </Button>
            )}
          </div>
        </div>

        {hasActiveFilters && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">Active Filters</p>
              <div className="flex flex-wrap gap-2">
                {filters.textSearch && (
                  <Badge variant="secondary" className="flex items-center gap-2">
                    Search: “{filters.textSearch}”
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => clearFilter('textSearch')}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove search filter</span>
                    </Button>
                  </Badge>
                )}
                {filters.eventTypes.size < 2 && (
                  <Badge variant="secondary" className="flex items-center gap-2">
                    Type: {Array.from(filters.eventTypes).join(', ')}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => clearFilter('eventTypes')}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove event type filter</span>
                    </Button>
                  </Badge>
                )}
                {filters.spanKinds.size > 0 && (
                  <Badge variant="secondary" className="flex items-center gap-2">
                    Kinds: {Array.from(filters.spanKinds).join(', ')}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => clearFilter('spanKinds')}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove span kind filter</span>
                    </Button>
                  </Badge>
                )}
                {filters.traceId && (
                  <Badge variant="secondary" className="flex items-center gap-2">
                    Trace: {filters.traceId}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6"
                      onClick={() => clearFilter('traceId')}
                    >
                      <X className="h-3 w-3" />
                      <span className="sr-only">Remove trace filter</span>
                    </Button>
                  </Badge>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
