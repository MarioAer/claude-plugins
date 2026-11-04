// The mod's state contract: what hooks/mod.js keeps under $.state for the band and the review pane.
// Claude Code validates every $.state reference against this declaration.
export type Note = {
  at: number
  text: string
}

export type Reply = {
  text: string
  at: number
  sentAt: number | null
}

export type Thread = {
  id: number
  kind: 'q' | 't'
  text: string
  status: 'open' | 'resolved' | 'dropped' | 'deferred'
  decision: string | null
  by: 'claude' | 'user' | null
  notes: Note[]
  at: number
  touched: number
  reply?: Reply | null
}

export type ReviewPane = {
  selected: number | null
  replyFor: number | null
  drafts: Record<string, string>
  deferFor: number | null
  resolved: number
}

export type View = {
  root: string | null
  sessionId: string | null
  threads: Thread[]
  unsent: number
  pane: ReviewPane | null
}

declare module 'claude-code' {
  interface PluginState {
    geparkt: {
      view: View
    }
  }
}
