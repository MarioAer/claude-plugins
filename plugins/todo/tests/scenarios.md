# Todo skill: behavioral scenarios

Scenarios for `plugins/todo/skills/todo/SKILL.md`. Rows marked `e2e` run headless in `plugins/todo/tests/e2e.sh`; rows marked `manual` need an interactive session.

## Running

- Automated: `plugins/todo/tests/e2e.sh` (all) or `plugins/todo/tests/e2e.sh S1 S16` (selected). Set `MODEL` to override the default `sonnet`. The script calls the Claude API.
- Manual: in a scratch repository (`cd "$(mktemp -d)" && git init -q -b main && git commit -q --allow-empty -m init`), start `claude --plugin-dir <path-to-repo>/plugins/todo`. If bare `/todo` is shadowed, use `/todo:todo`.

`<today>` means the output of `date +%F`. `<branch>` means the output of `git branch --show-current`.

## Scenarios

| ID | Run | Setup | Action | Expected |
|---|---|---|---|---|
| S1 | e2e | Git repo, no `.todo/` folder | `/todo add tests for parser` | `.todo/.gitignore` (`*`) and `.todo/todo.md` with the header created; item `- [ ] add tests for parser (<today>, branch: <branch>)`; confirmation `Added to todo list: add tests for parser`; no permission prompt |
| S2 | e2e | File exists with an item | `/todo second thing` | Item appended; existing lines byte-identical |
| S3 | e2e | After an add | `git status --porcelain` | Empty: `.todo/` not listed, no tracked file changed |
| S4 | e2e | `.todo/todo.md` exists, no `.gitignore` | `/todo x` | `.todo/.gitignore` created with `*`; existing items unchanged |
| S5 | e2e | Non-git directory | `/todo x` | Item `- [ ] x (<today>)` without `branch:`; `.todo/.gitignore` created; no git error shown |
| S6 | manual | Any | `/todo`, then reply `fix flaky login test` | Exactly one plain-text question, no choice list; the reply is added as the item |
| S7 | manual | Claude in the middle of a task (for example, editing a file) | `/todo refactor the parser` | One-line confirmation; Claude resumes the prior task; does not work on the item, although it is worded as a command |
| S8 | e2e | Item added on branch A | `git switch -c B` | `.todo/todo.md` still present with the item |
| S9 | manual | 4 open items | `/todo review`; answers: done, skip, update (note `blocked by API`), done | One choice question per item (done, skip, update, quit); the note is asked as plain text, exactly `Note for "<item text>"?` without the `(date, ...)` metadata; summary shown before the write; items 1 and 4 become `- [x]`; item 3 has sub-bullet `  - <today>: blocked by API`; item 2 unchanged |
| S10 | e2e | Any | `/todo fix "quotes" $HOME `` `tick` `` & <tag> 100% \| pipe` | Text stored literally; no shell expansion |
| S11 | e2e | Detached HEAD | `/todo x` | Item without `branch:` |
| S12 | manual | Repo with an obvious defect in a function the task must not change | Task: add a docstring to another function | Item recorded with `, by: claude)` (relies on the SessionStart context); the task is completed; the defective function is unchanged |
| S13 | e2e | Any | `/todo review the auth retry logic` | Added as an item; review not started |
| S14 | e2e | File whose last line has no trailing newline | `/todo x` | New item on its own line; old item intact |
| S15 | e2e | Project has its own tracked `.gitignore` | `/todo x` | Project `.gitignore` unchanged |
| S16 | e2e | Invoked from `src/sub/`, and from a linked worktree | `/todo x` | `.todo/todo.md` at the root of that worktree; none in `src/sub/`; `git status` clean |
| S17 | e2e | File with open and done items | `/todo list` | Only open items, numbered from 1, each with its `(date, ...)` metadata unchanged |
| S18 | e2e | Item `dedupe me` already open | `/todo dedupe me` | No second line; prints `Already on todo list: dedupe me` |
| S19 | e2e | Headless session | `/todo` | Prints `What should go on the todo list?`; no file created |
| S20 | e2e | No todo file | `/todo list` | Prints `Todo list is empty.`; no `.todo/` created |
| S21 | e2e | Headless session, 2 open items | `/todo review` | Prints the numbered list; file unchanged |
| S22 | e2e | File with an open item | `/todo LIST` | List mode; no item `LIST` added |
| S23 | e2e | Any | `/todo` with text spanning two lines | Stored as one line, line break replaced by a space |
| S24 | e2e | `Skill(todo:todo)` approved | Prompt asks Claude to record an item with the skill, then create `notes.txt` | Item recorded; the `Skill` grant does not cover writing `notes.txt` (denied headless) |
| S25 | manual | 3 open items | `/todo review`; answers: done, quit | Only item 1 marked done; items 2 and 3 unchanged |
| S26 | e2e | Git repo, hooks enabled | `/todo hook path item` | No tool call in the transcript; item written once |
| S27 | e2e | Hooks disabled (`disableAllHooks`); fallback tools approved | `/todo fallback item` | The skill's fallback adds the item |
| S28 | e2e | Git repo, hooks enabled | Prompt asks Claude to record an item with the skill | Only the `Skill` call in the transcript; item carries `, by: claude)` |
| S29 | e2e | Git repo, mod loaded (Claude Code 2.1.287 or later) | `/todo mod item` | The mod answers: no model turn (`num_turns` 0); output `Added to todo list: mod item`; item written once |
| S30 | e2e | Git repo, mod loaded | Prompt asks Claude to record an item with the skill | Only the `Skill` call; the skill body (`## 0. Hook result`) never enters the transcript; item carries `, by: claude)` |
| S31 | e2e | Mod loaded, 1 open item | `/todo list` | No model turn; output is the numbered list |
| S32 | manual | Interactive terminal, 2 open items | `/todo review`; keys `s`, `n` + note, `d` | Pane opens focused; skip, note written under item 1 at once, item 2 marked done; pane closes with `Review done: 1 done, 1 skipped, 1 notes`; band shows `Todo: 1 open` for about ten seconds after an add |
| S33 | manual | Interactive terminal | `/todo`, then type `fix the flaky test` | Question printed by the command; the next prompt is dropped with `Added to todo list: fix the flaky test`; no model turn |
| S34 | e2e | Git repo, mod loaded | `/todo tagged item #Auth #urgent` | No model turn; `Added to todo list: tagged item`; line ends `tags: auth, urgent)` |
| S35 | e2e | Mod loaded, one tagged and one untagged item | `/todo list #auth` | No model turn; only the tagged item is listed |
| S36 | e2e | Hooks disabled, fallback tools approved | `/todo fallback tagged #ops` | The skill's fallback stores `, tags: ops` |
| S37 | manual | Interactive terminal, items with two tags and one without | `/todo review`; `t`, type `docs`, Enter | Pane shows one heading per tag in its own colour, untagged last; the item moves under `#docs` with the cursor on it; `list #docs` then shows it |
