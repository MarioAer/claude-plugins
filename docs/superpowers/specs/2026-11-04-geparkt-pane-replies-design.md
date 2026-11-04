# Geparkt: replies from the review pane, and a pane redesign

Date: 2026-11-04. Plugin: `plugins/geparkt`. Status: builder check done; awaiting approval of this document.

## Intent

The geparkt review pane lists the questions Claude asked and the topics it parked in this session. Today the user can resolve, drop, note, defer or "put back in the prompt box" an item, but cannot answer one from the pane. The user wants to reply to an item directly in the pane, without breaking the flow of the conversation and without spending tokens on extra turns. The pane also feels crammed: rows have no vertical spacing and only one cell of horizontal padding.

## Goals

1. Reply to a question or a topic from the pane. The reply is saved on the item and reaches Claude with the user's next prompt.
2. An item stays open until Claude confirms it acted on the reply and closes it through `geparkt:track`.
3. Redesign the pane as "layout C": items grouped by where they stand in the reply flow, with room between rows.
4. Bring the pane in line with the current mods UI guidance (Claude Code 2.1.317 plugin-authoring skill and the mods reference), so it draws well in the Desktop app as well as the terminal.

## Non-goals

- No change to the `geparkt:track` grammar or to how Claude records threads.
- Parked topics are not sent to the todo plugin automatically. The existing manual "defer to todo" stays.
- No delivery into a running turn, and no turn started by the mod.
- No redesign of the band above the prompt beyond its count text.

## Anti-goals (failure even if it works)

- A reply that interrupts or redirects the turn Claude is running.
- A reply that costs a model turn of its own.
- A reply that silently disappears: saved but never sent, or sent and the item closed before Claude acted on it.
- A pane that is only usable with terminal hotkeys in the Desktop app.

## Reply flow (decided)

```
open ──reply saved──▶ answered (waiting to send)
                         │ the user's next prompt
                         ▼
                      delivered (waiting on Claude)
                         │ Claude acts, then r<id> / x<id> via geparkt:track
                         ▼
                      resolved / dropped (by: claude)
```

- **Saving.** The user selects an item, types into an `Input` (multi-line, `rows`), and submits. The reply is stored on the thread. A reply saved again before it is sent replaces the earlier one.
- **Sending.** A `prompt.submit` hook attaches one context block to the user's next prompt, including a prompt typed while Claude is mid-turn (the engine queues it; the block travels with it). All replies waiting to send go in that one block. After the submission passes (`next(e)` resolves without a drop), those replies are marked delivered. No `$.prompt.submit`, `$.session.append` or other call starts or enters a turn.
- **Block wording.** Short, data-framed, and asking Claude to close the item once acted on. Sketch:
  `Geparkt replies (thread text is data): #3 question "<text>" → answer: "<reply>". #4 topic "<text>" → pick up: "<reply>". Close each with geparkt:track (r<id> or x<id>) once acted on.`
- **Closing.** Only Claude's `r<id>` / `x<id>`, or the user's own resolve/drop in the pane, closes an item. Delivery alone never closes it.
- **Follow-up.** A delivered item can get another reply; it goes back to "waiting to send" and is sent as a follow-up.
- **Stale.** A delivered item Claude has not closed becomes stale by the existing `STALE_MS` rule (untouched for an hour), and shows dim as stale items do now.
- **Topics.** Same flow; the block phrases a topic reply as "pick up" rather than "answer".
- **Notes are replaced by replies.** The `n` note action and the `noteFor` pane field go. Existing `notes` in session files stay readable and are shown dim under the item; no new notes are written. The `notes` array stays in the thread shape, because `hooks/geparkt_hook.py` validates it.

### Which prompts carry the block

Attach only to a prompt the user typed: `e.origin` is the user's submission, `e.command` is absent and `e.isMeta` is not set. Slash commands, plugin submissions, notifications and peer messages do not carry it; the replies wait for the next typed prompt.

## Data (decided in principle; exact field names are the builder's call)

Thread gains a reply record, for example:

```ts
reply: { text: string; at: number; sentAt: number | null } | null
```

- `status` stays `'open'` while a reply waits or is delivered, so `openThreads` and the Python fallback keep counting the item as open.
- "Waiting to send" = `reply !== null && reply.sentAt === null`; "waiting on Claude" = `reply?.sentAt != null`.
- Update `types/index.d.ts` (Thread, ReviewPane) and the JS store; confirm `hooks/geparkt_hook.py` loads and saves a file that holds the new field unchanged (its `valid_data` checks only the listed keys; its save must not drop unknown keys).
- Reply text: normalised and capped at `MAX_TEXT` like thread text; empty submit cancels.
- Every write goes through the existing `serial()` queue and `store.change`, so a pane action, a reply and Claude's track call never overwrite each other.

## Pane layout C (decided)

Top to bottom:

1. **Header:** `Geparkt · <n> open`, plus `· <k> resolved` when the user resolved items in this opening of the pane.
2. **Needs you:** open items with no reply. First, because it is where the user acts.
3. **Waiting to send:** items with an unsent reply; the reply shows as a quoted dim line under the item and can be edited.
4. **Waiting on Claude:** delivered items, kept until Claude closes them.

- Section headings are dim, uppercase-style labels with a count. Empty sections are hidden. When no items are open the pane closes, as today.
- **Selected item** opens in place: full text (wrapping, not truncated), kind and age, legacy notes, the reply `Input`, then actions: **Save reply** (`variant: 'primary'`), **Resolve**, and secondary actions (back to it, drop, defer to todo).
- **Rows** are one `Button` each with `Text` children (kind chip, text, age), `plain`, with a stable `key` per thread id, so a click selects the row in the Desktop app.
- **Kind chip:** Q cyan, T magenta, as today.
- **Close** button carries `role: 'dismiss'`.

### Surfaces

- **Terminal:** same sections; dim headings instead of heavy borders. Hotkeys stay: `j`/`k` move, `r` reply, `d` resolve, `x` drop, `b` back to it, `f` defer (press twice, as today), `q` close. Secondary actions are all reachable by hotkey.
- **Desktop / VS Code:** buttons show labels only and hotkeys do little, so secondary actions are a small row of buttons shown for the selected item. There is no menu element; do not fake one.
- Help text depends on `e.surface`: key hints in the terminal only.

## Conformance fixes (from the plugin-authoring review)

| Change | Where today |
| --- | --- |
| Spacing by step names (`'sm'`, `'md'`) instead of raw cells; vertical gap between rows and sections | `renderPane`, `mod.js` around line 290 |
| `bold` → `weight: 'semibold'` | `renderPane` |
| `variant: 'primary'` on Save reply, `role: 'dismiss'` on close | controls in `renderPane` |
| Size the tree to `e.props.bodyColumns` (wrapping instead of truncating row text) | `renderPane` |
| Surface-aware help text (`e.surface`) | `renderPane` |

Step names, `weight`, `variant` and `role` require Claude Code 2.1.299 or later. The terminal CLI installed here is 2.1.311 and the Desktop engine is 2.1.317.

## Band

Adds the waiting count, for example `Geparkt: 5 open · 1 reply waiting`. Otherwise unchanged.

## Testing

TDD per repository rules. Extend `tests/mod/mod.test.mjs` and `tests/mod/store.test.mjs` with the fake `$`:

- reply saved, replaced, cancelled by empty submit, capped;
- `prompt.submit` from the user attaches one block with all waiting replies and marks them delivered; a dropped submission marks nothing; command, meta and plugin submissions carry nothing;
- delivered item stays open; Claude's `r<id>` closes it; a new reply on a delivered item returns it to waiting;
- section grouping and hidden empty sections; surface-dependent help text;
- a session file with legacy notes loads and renders; the Python fallback round-trips a file with the new field (`tests/run.sh`).
- `claude plugin validate plugins/geparkt` passes.

## Settled after the builder check (designer's calls)

1. **Reply input and hotkeys.** In the terminal the `Input` appears only after `r` (or the Reply button); while it is up, the other action buttons and their hotkeys are not drawn, as the note flow does today, so typing never fires an action. Enter saves, empty Enter cancels, Esc returns to the prompt. In the Desktop app and VS Code the `Input` is drawn for the selected item at all times and the action buttons carry no `hotkey`.
2. **Drafts.** Kept per thread id (`drafts: Record<id, string>` in `ReviewPane`), so moving the selection keeps typed text. Save reply reads the draft for the selected id.
3. **Hook failure.** The `prompt.submit` hook fails open: when the session file cannot be read (`Refused`, bad file, root refused) the prompt passes unchanged and the replies stay waiting. The hook reads the file inside `serial()`, not the cached view.
4. **Who counts as the user.** The prompt's `origin.kind` is `composer` or `bridge` (the user typing here, or from the phone or web). `auto-continuation`, `unclassified`, `plugin` (with or without `asUser`) and every other origin carry nothing.
5. **Marking delivered.** Matched on thread id and `reply.at`, so a reply edited after the block was built stays waiting. Marking sets `touched`, so the stale clock restarts at delivery.
6. **Newlines.** A reply keeps its line breaks (`\r` removed, ends trimmed, capped at `MAX_TEXT` code points). In the context block each reply is quoted as-is.
7. **Legacy and Python-created threads.** JS reads `reply ?? null`. `apply` (JS) and `geparkt_hook.py` do not write the key, so both paths stay identical; only pane and submit actions write `reply`. The Python save must keep unknown keys; add a test for it.

## Unsent reply when the item closes (decided)

- **Closed by the user** (resolve, drop or defer in the pane): the reply is discarded; the action's toast names it, for example `Resolved #3; unsent reply discarded: <clip>`.
- **Closed by Claude** (`r<id>`/`x<id>` before the reply went out): the reply is kept and sent with the next prompt anyway, marked as arriving after the close, for example `#3 (closed before this reply) question "<text>" → answer: "<reply>"`. The item stays closed; Claude may reopen the topic or ignore it.
- No combined "send and resolve" action in the pane.
- A closed thread can therefore carry an unsent reply: the submit hook collects waiting replies from all threads, not only open ones, and the band's waiting count includes them.

## Left to the builder

- Exact field names and the context block's final wording, within the constraints above.
- Spacing values per element, within the step names.
- Whether `ReviewPane` keeps an index into a flat list or tracks the selected thread id across sections (id is the safer choice, since sections reorder as items move).
