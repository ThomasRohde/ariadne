import { Bot, Shuffle, Wrench, Send } from 'lucide-react'
import type { SpanEvent } from '../types'

interface EventIconProps {
  className?: string
}

export const AgentIcon = ({ className }: EventIconProps) => (
  <div className={`flex h-5 w-5 items-center justify-center rounded-md bg-cyan-500/15 text-cyan-600 dark:bg-cyan-500/25 dark:text-cyan-400 ${className || ''}`}>
    <Bot className="h-3.5 w-3.5" />
  </div>
)

export const HandoffIcon = ({ className }: EventIconProps) => (
  <div className={`flex h-5 w-5 items-center justify-center rounded-md bg-orange-500/15 text-orange-600 dark:bg-orange-500/25 dark:text-orange-400 ${className || ''}`}>
    <Shuffle className="h-3.5 w-3.5" />
  </div>
)

export const ToolIcon = ({ className }: EventIconProps) => (
  <div className={`flex h-5 w-5 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:bg-emerald-500/25 dark:text-emerald-400 ${className || ''}`}>
    <Wrench className="h-3.5 w-3.5" />
  </div>
)

export const ApiIcon = ({ className }: EventIconProps) => (
  <div className={`flex h-5 w-5 items-center justify-center rounded-md bg-slate-500/15 text-slate-600 dark:bg-slate-500/25 dark:text-slate-400 ${className || ''}`}>
    <Send className="h-3.5 w-3.5" />
  </div>
)

export const getSpanIcon = (span: SpanEvent): React.ReactNode => {
  const kind = span.kind?.toLowerCase() || ''
  const name = span.name?.toLowerCase() || ''
  
  // Handoff detection
  if (kind.includes('handoff') || name.includes('handoff')) {
    return <HandoffIcon />
  }
  
  // Tool/function detection
  if (kind.includes('tool') || kind.includes('function') || name.includes('fetch') || name.includes('check') || name.includes('send')) {
    return <ToolIcon />
  }
  
  // API call detection
  if (kind.includes('llm') || kind.includes('api') || kind.includes('request') || name.includes('post') || name.includes('get')) {
    return <ApiIcon />
  }
  
  // Default to agent
  return <AgentIcon />
}
