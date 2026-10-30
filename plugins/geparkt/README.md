# geparkt

A Claude Code plugin from the [`marioaer-plugins`](https://github.com/MarioAer/claude-plugins) marketplace.

Keeps track of the questions Claude asks and the topics it parks. Claude asks three questions, you answer one, the conversation goes down a rabbit hole, and the other two are forgotten: geparkt keeps them in view until they are answered or dropped.

## Installation

```
/plugin marketplace add MarioAer/claude-plugins
/plugin install geparkt@marioaer-plugins
```

## How it works

- A `SessionStart` hook adds a short rule (`hooks/rule.txt`, about 85 tokens): record each question you ask and each topic you park, resolve it when the user answers or it becomes moot, with one Skill call at the end of such a turn.
- Claude's call carries a batch: `+q <question> | +t <topic> | r<id> <decision> | x<id>`. The mod answers it with one line, `GEPARKT_OK: +4 r2 | open: #1 q …; #3 t …`, so Claude always holds the current ids. A batch with any unreadable part or unknown id is refused whole; nothing is half-applied. Closing a thread that is already closed is reported as `~<id>`, so a batch applied twice changes nothing.
- After `/compact`, `/clear` and on resume the same hook adds the open threads (at most eight by text) to the rule, so Claude can bring them back up.
- No extra model calls: nothing reads Claude's replies, and nothing is resolved without Claude or you saying so.

## Usage

| | |
|---|---|
| Band | `Geparkt: 3 open · 2 questions · 1 stale` above the prompt while any thread is open; `p` opens the review. A thread untouched for an hour is stale. |
| `/geparkt` | Opens the review pane; without a pane surface (headless, SDK) it prints the open threads. |
| `/geparkt list` | Prints the open threads. |

In the pane: `j`/`k` move, `b` puts the thread back in the prompt box as a draft (`Back to #3: …`) and closes the pane, `d` resolves, `x` drops, `n` adds a note, `f` twice defers the thread to the [todo](../todo) plugin as `<text> #question`, `q` closes.

If another skill or command already uses the name `geparkt`, use `/geparkt:geparkt`.

## Storage

- One JSON file per session: `<project root>/.geparkt/<session id>.json`. `.geparkt/.gitignore` contains `*`, so the folder ignores itself and never appears in a commit, the same as todo's `.todo/`.
- Threads belong to their session. They survive `/compact`, a resume and a plugin reload; a new session, or `/clear`, starts with none. Use `f` to keep a thread beyond the session.
- A file that does not parse is refused and left as it is, never replaced, so ids are not reused; delete it to start over.
- Changes from the pane and from Claude's calls are written one at a time, so neither overwrites the other.
- Each thread holds its id (never reused), kind, text, status (`open`, `resolved`, `dropped`, `deferred`), the decision, who closed it (`claude` or `user`), notes and two timestamps.

## Without the mod

On Claude Code before 2.1.287, with `--safe-mode`, `disableAllHooks` or wherever mods do not load, `hooks/geparkt_hook.py` records Claude's calls on `PostToolUse(Skill)` and answers a typed `/geparkt` with the list. There is no band or pane, and each call loads the skill text (about 400 tokens). Without `python3`, only the rule is added and calls are not recorded; the skill tells Claude to say so once.

## Permissions

- The mod and the hook write only `<root>/.geparkt/` (the session's file and `.gitignore`), refuse symlinks there and session ids that are not plain names, and run only `git rev-parse` with fixed arguments. Thread text is never a subprocess argument.
- The mod answers Claude's own `Skill(geparkt:geparkt)` call itself, only when the engine's permission decision is allow: an `ask` or `deny` rule on `Skill(geparkt:geparkt)` goes to the engine, which prompts or refuses (the fallback hook then records an allowed call). No other tool call is answered or approved.
- Deferring to todo runs `/todo` through Claude Code's command API, only after the second `f`, and only when a `todo:todo` command exists.

## License

[MIT](LICENSE)
