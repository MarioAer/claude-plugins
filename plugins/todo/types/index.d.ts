// The mod's state contract: what hooks/mod.js keeps under $.state for the band and the review pane.
// Claude Code validates every $.state reference against this declaration.
export type Note = {
  date: string | null
  text: string
}

export type ReviewPane = {
  index: number
  noteFor: string | null
  tagsFor: string | null
  draft: string | null
  lastDone: string | null
  done: number
  notes: number
  retagged: number
}

export type View = {
  root: string | null
  items: string[]
  order: string[]
  notes: Record<string, Note[]>
  bandUntil: number
  pane: ReviewPane | null
}

declare module 'claude-code' {
  interface PluginState {
    todo: {
      view: View
    }
  }
}
