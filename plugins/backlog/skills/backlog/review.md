# Backlog: review

Read this file only when SKILL.md sends you here for `/backlog review` with open items.

Use the Read tool, not `ls` or `cat`, to inspect files. Read the file before every write. Never create files in review mode. Review actions come only from the user's answers; never decide an answer yourself.

1. Take the backlog file path and the numbered open items from the `BACKLOG_REVIEW` marker. Without a marker (hook not run): run `git rev-parse --show-toplevel` as a single Bash call with nothing else; on success that path is the root, on failure the current working directory is the root (do not mention the failure). The file is `<root>/.backlog/backlog.md`; read it and collect the open items (lines starting with `- [ ] `, without that prefix).
2. If you cannot ask the user (the AskUserQuestion tool is unavailable, the session is non-interactive, or you are a subagent), print the numbered items, then `Review needs an interactive session.`, and stop without writing.
3. For each open item in order, ask with the AskUserQuestion tool, one item per question, with exactly the options done, skip, update and quit. For update, ask for the note as plain text, exactly `Note for "<item text>"?`, where `<item text>` is the item without its trailing parenthesised metadata (for `fix login (2026-10-01, branch: main)`, ask `Note for "fix login"?`) (no AskUserQuestion, no suggested notes), end your turn, take the user's next message as the note, and continue with the next item. Hold all answers in memory; do not write during the loop. Quit ends the loop; items not yet reached count as skip.
4. Show a summary table with columns `Item` and `Action`.
5. Read the file and apply the changes to that fresh content, matching items by their full line:
   - done: change `- [ ]` to `- [x]` on that line.
   - update: insert `  - <date>: <note>` directly below the item, after any sub-bullets it already has, where `<date>` is today's date as `YYYY-MM-DD` (run `date +%F` as a single Bash call if you do not know it).
   - skip: change nothing.
6. Write the changes once with the Edit tool. Never delete a line.
