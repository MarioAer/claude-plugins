// The mod's state contract: what hooks/mod.js keeps under $.state for the band and the review pane.
// Claude Code validates every $.state reference against this declaration.
export type ReviewPane = {
  index: number
  noteFor: string | null
  done: number
  skipped: number
  notes: number
}

export type View = {
  root: string | null
  items: string[]
  order: string[]
  bandUntil: number
  pane: ReviewPane | null
}

declare module 'claude-code' {
  interface PluginState {
    backlog: {
      view: View
    }
  }
}
