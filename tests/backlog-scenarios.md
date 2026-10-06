# Backlog skill: behavioral scenarios

Scenarios for `plugins/backlog/skills/backlog/SKILL.md`. Rows marked `e2e` run headless in `tests/backlog-e2e.sh`; rows marked `manual` need an interactive session.

## Running

- Automated: `tests/backlog-e2e.sh` (all) or `tests/backlog-e2e.sh S1 S16` (selected). Set `MODEL` to override the default `sonnet`. The script calls the Claude API.
- Manual: in a scratch repository (`cd "$(mktemp -d)" && git init -q -b main && git commit -q --allow-empty -m init`), start `claude --plugin-dir <path-to-repo>/plugins/backlog`. If bare `/backlog` is shadowed, use `/backlog:backlog`.

`<today>` means the output of `date +%F`. `<branch>` means the output of `git branch --show-current`.

## Scenarios

| ID | Run | Setup | Action | Expected |
|---|---|---|---|---|
| S1 | e2e | Git repo, no `.backlog/` folder | `/backlog add tests for parser` | `.backlog/.gitignore` (`*`) and `.backlog/backlog.md` with the header created; item `- [ ] add tests for parser (<today>, branch: <branch>)`; confirmation `Added to backlog: add tests for parser`; no permission prompt |
| S2 | e2e | File exists with an item | `/backlog second thing` | Item appended; existing lines byte-identical |
| S3 | e2e | After an add | `git status --porcelain` | Empty: `.backlog/` not listed, no tracked file changed |
| S4 | e2e | `.backlog/backlog.md` exists, no `.gitignore` | `/backlog x` | `.backlog/.gitignore` created with `*`; existing items unchanged |
| S5 | e2e | Non-git directory | `/backlog x` | Item `- [ ] x (<today>)` without `branch:`; `.backlog/.gitignore` created; no git error shown |
| S6 | manual | Any | `/backlog`, then reply `fix flaky login test` | Exactly one plain-text question, no choice list; the reply is added as the item |
| S7 | manual | Claude in the middle of a task (for example, editing a file) | `/backlog refactor the parser` | One-line confirmation; Claude resumes the prior task; does not work on the item, although it is worded as a command |
| S8 | e2e | Item added on branch A | `git switch -c B` | `.backlog/backlog.md` still present with the item |
| S9 | manual | 4 open items | `/backlog review`; answers: done, skip, update (note `blocked by API`), done | One choice question per item (done, skip, update, quit); the note is asked as plain text; summary shown before the write; items 1 and 4 become `- [x]`; item 3 has sub-bullet `  - <today>: blocked by API`; item 2 unchanged |
| S10 | e2e | Any | `/backlog fix "quotes" $HOME `` `tick` `` & <tag> 100% \| pipe` | Text stored literally; no shell expansion |
| S11 | e2e | Detached HEAD | `/backlog x` | Item without `branch:` |
| S12 | manual | Repo with an obvious defect in a function the task must not change | Task: add a docstring to another function | Item recorded with `, by: claude)` (relies on the SessionStart context); the task is completed; the defective function is unchanged |
| S13 | e2e | Any | `/backlog review the auth retry logic` | Added as an item; review not started |
| S14 | e2e | File whose last line has no trailing newline | `/backlog x` | New item on its own line; old item intact |
| S15 | e2e | Project has its own tracked `.gitignore` | `/backlog x` | Project `.gitignore` unchanged |
| S16 | e2e | Invoked from `src/sub/`, and from a linked worktree | `/backlog x` | `.backlog/backlog.md` at the root of that worktree; none in `src/sub/`; `git status` clean |
| S17 | e2e | File with open and done items | `/backlog list` | Only open items, numbered from 1 |
| S18 | e2e | Item `dedupe me` already open | `/backlog dedupe me` | No second line; prints `Already on backlog: dedupe me` |
| S19 | e2e | Headless session | `/backlog` | Prints `What should go on the backlog?`; no file created |
| S20 | e2e | No backlog file | `/backlog list` | Prints `Backlog is empty.`; no `.backlog/` created |
| S21 | e2e | Headless session, 2 open items | `/backlog review` | Prints the numbered list; file unchanged |
| S22 | e2e | File with an open item | `/backlog LIST` | List mode; no item `LIST` added |
| S23 | e2e | Any | `/backlog` with text spanning two lines | Stored as one line, line break replaced by a space |
| S24 | e2e | `Skill(backlog:backlog)` approved | Prompt asks Claude to record an item with the skill, then create `notes.txt` | Item recorded; the write to `notes.txt` is not pre-approved by the skill (denied headless) |
| S25 | manual | 3 open items | `/backlog review`; answers: done, quit | Only item 1 marked done; items 2 and 3 unchanged |
