// The mod's state contract: what hooks/mod.js keeps under $.state for the band and the review pane.
// Claude Code validates every $.state reference against this declaration.
export type Note = {
  at: number
  text: string
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
}

export type ReviewPane = {
  index: number
  noteFor: number | null
  draft: string | null
  deferFor: number | null
  resolved: number
}

export type View = {
  root: string | null
  sessionId: string | null
  threads: Thread[]
  pane: ReviewPane | null
}

declare module 'claude-code' {
  interface PluginState {
    geparkt: {
      view: View
    }
  }
}
