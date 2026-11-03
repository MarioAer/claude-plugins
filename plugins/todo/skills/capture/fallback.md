# Todo: add and list without the hook

Read this file only when SKILL.md sends you here: no `TODO_` marker was present, so the hook did not run and you perform the steps yourself.

Run each shell command exactly as written here, one per Bash call, with no other commands, pipes or redirections; anything else needs a permission prompt and interrupts the user. Use the Read tool, not `ls` or `cat`, to inspect files. Read the file before every write.

## Locate the files

1. Run `git rev-parse --show-toplevel`. On success, that path is the root and the project is a git repository. On failure, the current working directory is the root and the project is not a git repository; do not mention the failure.
2. The todo file is `<root>/.todo/todo.md`; the ignore file is `<root>/.todo/.gitignore`.

## Add

1. Ensure the files exist:
   - If `<root>/.todo/.gitignore` does not exist, create it with the Write tool containing the single line `*`. This keeps the whole folder, including that file, out of git without changing any tracked file. Never edit the project's own `.gitignore` or anything under `.git/`.
   - If `<root>/.todo/todo.md` does not exist, create it with the Write tool with exactly this content:

     ```
     # Todo

     Deferred tasks captured with /todo. This folder is ignored by git; do not commit it.

     ```

2. Replace any line breaks in the item text with single spaces. Keep every other character exactly as given; do not pass the text through the shell. Then take tags off the end: every trailing token `#<name>` where `<name>`, lowercased, is 1 to 24 characters of letters, digits, `-` or `_` is a tag; stop at the first trailing token that is not. Keep at most 8 tags, in order, without duplicates. If no text remains, print `Todo failed: the item has no text` and stop.
3. Read the todo file. If an open item (a line starting with `- [ ] `) already has the same text, ignoring case and the trailing parenthesised metadata, do not add it: print `Already on todo list: <text>` and continue with step 8.
4. Get the date with `date +%F`. In a git repository, get the branch with `git branch --show-current`; if the output is empty (detached HEAD), omit the branch. Outside a git repository, omit the branch.
5. Build the line in this exact shape:
   - With branch: `- [ ] <text> (<date>, branch: <branch>)`
   - Without branch: `- [ ] <text> (<date>)`
   - Self-initiated only: insert `, by: claude` before the closing parenthesis, for example `- [ ] <text> (<date>, branch: <branch>, by: claude)`. Never add it to a user-initiated item.
   - With tags: append `, tags: <a>, <b>` as the last field before the closing parenthesis, for example `- [ ] <text> (<date>, branch: <branch>, tags: auth, urgent)`.
6. Append the line at the end of the file with the Edit tool. If the file does not end with a newline, the new line must still start on its own line. Never rewrite an existing file with the Write tool, and do not change any existing line.
7. Confirm with exactly one line: `Added to todo list: <text>`.
8. If a task was in progress before the command, resume it without further comment. If no task was in progress, stop after the confirmation; do not start new work. Ask no other questions.

## List

Never create files in list mode: a missing todo file means the todo list is empty.

Read the todo file. Print every open item (lines starting with `- [ ] `) as a numbered list starting at 1, without the `- [ ] ` prefix. With a tag (`list #<tag>`), print only the open items whose `tags:` field contains that tag in lowercase. If there are none, print `Todo list is empty.`
