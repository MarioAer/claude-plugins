# backlog: tags per item

Date: 2026-10-13
Plugin: `plugins/backlog`, version 0.3.0 (branch `feat/backlog-mod`, PR #10) to 0.4.0
Status: approved design, not yet implemented
Builds on: `2026-10-12-backlog-mod-design.md` (the mod, the store, the review pane)

## Problem

Backlog items have no classification. A list of twenty items reads as one flat run; nothing
groups the auth work apart from the build work, and nothing lets a person ask for one kind
of item.

## Goals

- Tags per item, set when adding (`/backlog fix login #auth #urgent`), edited in the review pane
  (`t`), and used to filter a list (`/backlog list #auth`).
- The same tag rules in every session: the Python hook and the skill fallback parse and filter
  exactly as the mod does, so a tagged add means the same thing with or without the mod.
- The review pane groups items by tag, each tag in its own colour, stable across sessions.
- Files written by 0.3.0 stay valid; files written by 0.4.0 stay readable by 0.3.0 and 0.2.1.

Out of scope: tag editing outside the pane; renaming or deleting a tag across items; more than
one tag in a list filter; tags on closed items; colour choice by the user.

## Alternatives considered

| Alternative | Reason rejected |
|---|---|
| Inline hashtags kept in the item text | Tags become text: two items differing only by a tag stop being duplicates, and a tag edit rewrites the text. |
| Tags on a sub-bullet under the item | Mixes with notes; both implementations would need a sub-bullet parser. |
| Mod-only tags | `/backlog x #auth` would store `x #auth` as text without the mod and `list #auth` would add an item; the shared fixtures could no longer pin parity. |
| Colour by hash of the tag name | Two tags can collide at once; order of first appearance gives distinct colours for the first eight tags and is just as stable. |

## Line format

```
- [ ] <text> (<date>[, branch: <branch>][, by: claude][, tags: <a>, <b>])
```

Metadata regex, in both implementations:

```
\s\(\d{4}-\d{2}-\d{2}(, branch: [^,)]*)?(, by: claude)?(, tags: [^)]*)?\)$
```

A line without `tags:` is read by 0.4.0 exactly as before. The reverse is partial: the 0.2.1 and
0.3.0 regex has no `tags:` group, so those versions do not recognise a tagged line's parenthesis as
metadata. They still list it and mark it done (those match the whole line), but their duplicate
check compares the whole line, so an older session can add a second `fix login` next to a tagged
one, and the 0.3.0 pane's toast shows the line with its parenthesis. This is documented in the
README as the one limit of mixing versions; no file is corrupted either way.

## Tag rules (identical in Python and JavaScript)

| Rule | Value |
|---|---|
| Syntax on add | After normalising the argument (CR and LF to spaces, trimmed), split on single spaces from the end: every trailing token of the form `#<name>` is a tag; the first token that is not stops the scan. The text is what remains, trimmed. A `#` anywhere else stays text. |
| Name | `<name>` lowercased must match `[a-z0-9][a-z0-9_-]{0,23}`; a token that does not match ends the scan and stays text. |
| Limits | At most 8 tags per item, in the order typed, duplicates dropped after lowercasing. A ninth and later tag is dropped. |
| Empty text | Text that is empty after removing the tags is refused: `BACKLOG_FAILED: the item has no text`. |
| Storage | `, tags: a, b` as the last metadata field; omitted when there are no tags. |
| Duplicates | Unchanged: text compared without the parenthesis, case-folded. A duplicate add returns `BACKLOG_DUPLICATE` and does not change the existing item's tags. |
| `list #<name>` | Argument matching `^list #(<name>)$` (case-insensitive, one tag, after normalising) is list mode filtered to open items whose tags contain `<name>` lowercased; no match prints `Backlog is empty.` Any other `list ...` text is an item, as before. |
| Display in list | Items are printed as stored, so tags appear inside the parenthesis. |
| Markers | `BACKLOG_ADDED: <text>` carries the text without tags. |

Parsing helpers, by name in both implementations: `split_tags(text) -> (text, tags)` /
`splitTags(text) -> { text, tags }`; `item_tags(item) -> list` / `itemTags(item) -> string[]`
(reads the `tags:` field of a stored item); `mode_of` / `modeOf` gains the value `list-tag` with
the tag name.

## Components

| Unit | Change |
|---|---|
| `hooks/backlog_hook.py` | `META` regex; `split_tags`, `item_tags`; mode `list #<name>`; `add` stores tags; `list_items(root, tag=None)` filters; `BACKLOG_FAILED: the item has no text`. |
| `skills/backlog/SKILL.md` | Mode table gains the row `list #<tag>`; the self-initiated section says trailing `#tags` are allowed. Stays within the 4500-byte budget. |
| `skills/backlog/fallback.md` | Add step: strip trailing `#tags`, store `, tags: ...`; List section: the `#<tag>` filter. |
| `skills/backlog/review.md` | One sentence: tags are shown as stored and are edited only in the mod's pane. |
| `hooks/store.js` | `META`; `splitTags`, `itemTags`, `tagOrder(content) -> string[]` (tags in order of first appearance over every item line, open or closed); `add` stores tags; `list(io, root, tag?)`; `setTags(io, root, item, tags) -> boolean` rewriting the parenthesis inside the lock, keeping date, branch and `by: claude`. |
| `hooks/mod.js` | `modeOf` `list-tag` in `runCommand`; `performAdd` passes tags; pane grouping, colours, `t` key and its input; help lines name `t`. |
| `types/index.d.ts` | `ReviewPane` gains `tagsFor: string \| null` (the item whose tags are being edited); `View` gains `palette: Record<string, string>` (tag to colour). |
| `tests/fixtures/store.json` | New cases listed under Testing; both suites run them. |
| `tests/mod/*.test.mjs`, `tests/add-hook.sh`, `tests/run.sh` | Tests listed under Testing. |
| `README.md`, `tests/scenarios.md`, `plugin.json` | Usage and Mod sections, scenarios S34 to S37, version 0.4.0. |

## Pane: grouping, colours, the `t` key

Grouping. The view's `items` is the open items sorted for display: one group per tag in the
order `tagOrder` gives, each item placed under its first tag only, items with no tags last.
Groups are drawn as a heading row `#<tag>` (bold, in the tag's colour) followed by its item rows;
the untagged group's heading is `untagged`, dim. Item rows read `<n>. <text with metadata>` as
today and end with ` #a #b`, each tag in its colour. The cursor walks item rows only, in display
order; headings are not selectable. Done, skip and note behave as in 0.3.0 on the current item.

Colours. `PALETTE = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red', 'cyanBright', 'magentaBright']`.
`palette[tag] = PALETTE[tagOrder.indexOf(tag) % 8]`, computed by `showBand` and `openPane` from
the fresh file content, so colours survive reloads and stay fixed while the tag's first line stays
in the file (closed items keep theirs). The band stays a count.

The `t` key. A fifth plain button `t: tags`. Pressing it sets `pane.tagsFor` to the current item
and draws an `Input` prefilled with the item's tags as `a b` (space separated, no `#`), help line
`Enter replaces the tags, empty Enter clears them, Esc returns to the prompt.` On submit the value
is split on spaces and commas, `#` prefixes dropped, the tag rules applied (lowercase, pattern,
eight at most, duplicates dropped); an invalid token is dropped and named in a toast
`Ignored tag: <token>`. `setTags` writes once; the cursor stays on the same item, which may now
sit in another group, so `index` is recomputed from the item's new position. `tagsFor` is cleared.
When the item's line vanished, the toast `Backlog item changed on disk: <text>` is shown and the
list is re-read, as for done.

Help line while the buttons show:
`Keys: d done, s skip, n note, t tags, q close. Tab moves, Enter presses, Esc returns to the prompt.`

## Error handling

| Situation | Result |
|---|---|
| Text empty after tags | `Backlog failed: the item has no text`; nothing written; same wording in the Python hook. |
| Invalid tag token on add | Ends the tag scan; the token and everything before it is text. |
| Invalid token in the `t` input | Dropped with `Ignored tag: <token>`; the rest is written. |
| `list #name` with no matching open item | `Backlog is empty.` |
| A tagged line edited by hand into an unparsable parenthesis | The whole parenthesis is still metadata by the regex; `itemTags` returns none; nothing breaks. |
| Store refusals | As in 0.3.0. |

## Testing

TDD: tests are written and run to fail before the implementation.

- Shared fixtures (`tests/fixtures/store.json`, run by Node and Python): tagged add stores
  `, tags: auth, urgent` and the marker without tags; `#Auth #auth` stores one tag `auth`;
  a tag with an invalid character stays text; nine tags store eight; tags-only text refused;
  duplicate add keeps the old tags; `list` with a tag filter matches case-insensitively and
  returns `[]` with no match; an untagged file still lists.
- Node store tests: `splitTags` cases including `#` mid-text and a trailing bare `#`;
  `itemTags` on a line with and without the field; `tagOrder` over open and closed lines;
  `setTags` keeps date, branch and `by: claude`, clears with `[]`, returns false on a vanished line.
- Node mod tests: `list #tag` as command text; `/backlog x #a` toast and file; Claude's add with
  tags; the pane draws groups in `tagOrder` with headings in palette order and untagged last;
  the cursor skips headings; `t` round trip moves the item to its new group and keeps the cursor
  on it; invalid token toast; palette stable after `done`.
- Python: `tests/add-hook.sh` cases for `list #tag` through the hook JSON, and the SKILL.md
  budget checks still pass.
- e2e (`tests/e2e.sh`): S34 typed tagged add (num_turns 0, line with tags); S35 `list #tag`
  filter; S36 hooks disabled, fallback stores tags; S37 manual: grouped pane, colours, `t`.

## Documentation

- `README.md`: Usage table rows for `#tags` and `list #tag`; item format example with tags;
  Mod section: grouped and coloured pane, `t`.
- `tests/scenarios.md`: S34 to S37.
- `plugin.json`: 0.4.0.

## Release

- Branch `feat/backlog-tags` from `feat/backlog-mod`; PR against `main` after PR #10 merges,
  or rebased onto `main` then.
- After the squash merge: tag `backlog-v0.4.0` and publish a release, per the root README.
