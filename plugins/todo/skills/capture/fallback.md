# Todo: add, list and done without the mod

Read this file only when SKILL.md sends you here: no `TODO_` marker was present, so the mod did not run and you perform the steps yourself.

Run each shell command exactly as written here, one per Bash call, with no other commands, pipes or redirections; anything else needs a permission prompt and interrupts the user. Use the Read tool, not `ls` or `cat`, to inspect files. Read the file before every write.

## Locate the files

1. Run `git rev-parse --show-toplevel`. On failure, the current working directory is the root, the project is not a git repository and there is no worktree; do not mention the failure, and skip step 2.
2. Run `git rev-parse --path-format=absolute --git-common-dir`. If the output ends in `/.git`, the root is that path without `/.git` (the main checkout, shared by every worktree); otherwise the root is the path from step 1. If the path from step 1 differs from the root, this session is in the worktree named by the last component of that path; otherwise there is no worktree.
3. The todo file is `<root>/.todo/todo.md`; the ignore file is `<root>/.todo/.gitignore`.
4. The view is the open items this session sees: in a worktree, the items whose metadata has `worktree: <this worktree>`, then the items without a `worktree:` field; with no worktree, every open item.

## Add

1. Ensure the files exist:
   - If `<root>/.todo/.gitignore` does not exist, create it with the Write tool containing the single line `*`. This keeps the whole folder, including that file, out of git without changing any tracked file. Never edit the project's own `.gitignore` or anything under `.git/`.
   - If `<root>/.todo/todo.md` does not exist, create it with the Write tool with exactly this content:

     ```
     # Todo

     Deferred tasks captured with /todo. This folder is ignored by git; do not commit it.

     ```

2. Replace any line breaks in the item text with single spaces. Keep every other character exactly as given; do not pass the text through the shell. Then take tags off the end: every trailing token `#<name>` where `<name>`, lowercased, is 1 to 24 characters of letters, digits, `-` or `_` is a tag; stop at the first trailing token that is not. Keep at most 8 tags, in order, without duplicates. If no text remains, print `Todo failed: the item has no text` and stop.
3. Decide the item's worktree: if the tags include `repo`, remove that tag and use none; otherwise, if self-initiated and the tags do not include `question`, use none; otherwise use this session's worktree (none in the main checkout).
4. Read the todo file. If an open item (a line starting with `- [ ] `) already has the same text, ignoring case and the trailing parenthesised metadata, do not add it. If that item has a `, worktree: <name>` field and `<name>` is not the worktree from step 3, remove that field from its line with the Edit tool. Print `Already on todo list: <text>` and continue with step 9.
5. Get the date with `date +%F`. In a git repository, get the branch with `git branch --show-current`; if the output is empty (detached HEAD), omit the branch. Outside a git repository, omit the branch.
6. Build the line in this exact shape:
   - With branch: `- [ ] <text> (<date>, branch: <branch>)`
   - Without branch: `- [ ] <text> (<date>)`
   - With a worktree from step 3: insert `, worktree: <name>` after the branch (or after the date), for example `- [ ] <text> (<date>, branch: <branch>, worktree: <name>)`.
   - Self-initiated only: insert `, by: claude` after that, for example `- [ ] <text> (<date>, branch: <branch>, by: claude)`. Never add it to a user-initiated item.
   - With tags: append `, tags: <a>, <b>` as the last field before the closing parenthesis, for example `- [ ] <text> (<date>, branch: <branch>, tags: auth, urgent)`.
7. Append the line at the end of the file with the Edit tool. If the file does not end with a newline, the new line must still start on its own line. Never rewrite an existing file with the Write tool, and do not change any existing line.
8. Confirm with exactly one line: `Added to todo list: <text>`.
9. If a task was in progress before the command, resume it without further comment. If no task was in progress, stop after the confirmation; do not start new work. Ask no other questions.

## List

Never create files in list mode: a missing todo file means the todo list is empty.

Read the todo file. Print every open item of the view (lines starting with `- [ ] `, in view order) as a numbered list starting at 1, without the `- [ ] ` prefix. With a tag (`list #<tag>`), print only the open items whose `tags:` field contains that tag in lowercase. If there are none, print `Todo list is empty.`

## Done

Never create files in done mode.

1. Read the todo file. Among the open items of the view, find the one whose text, ignoring case and the trailing parenthesised metadata, equals the given text. If the file is missing or none matches, print `Todo failed: no open item matches: <text>` and stop; never add the text as an item.
2. With the Edit tool, change that line's `- [ ]` to `- [x]`. Self-initiated only: also insert `  - <date>: done by claude` directly below it, after any sub-bullets it already has, with the date from `date +%F`. Never delete a line.
3. Confirm with exactly one line: `Done: <text>`, then resume any task that was in progress without further comment.
