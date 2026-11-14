#!/usr/bin/env bash
# SessionStart hook: a skill description alone does not make Claude record out-of-scope findings
# while it works on another task; this short context instruction does. After compact, clear and
# resume it also lists the open items of the session's view, so parked work comes back into context.
# Read-only: items of removed worktrees are left out here and closed by the mod's next read. Needs
# only bash and git; any failure leaves the rule alone.
set -u

RULE='The todo plugin is installed. When you notice a concrete defect or follow-up outside the scope of the current task, record it with the Skill tool (skill "todo:capture", args: the item text) instead of only mentioning it in your reply, then continue the current task. At most two such items per task. Park a question or topic for later as a todo item tagged #question; when it is answered or moot, close it with args "done <item text>".'
MAX_SHOWN=8
# The trailing metadata of a stored item; group 1 is the text, group 4 the worktree field.
META='^(.*) \(([0-9]{4}-[0-9]{2}-[0-9]{2})(, branch: [^,)]*)?(, worktree: [^,)]*)?(, by: claude)?(, tags: [^)]*)?\)$'

json_escape() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\t'/\\t}
  printf '%s' "$s" | tr -d '\000-\010\013-\037'
}

# reminder <cwd>: prints " Open todo items (N): 1. … 2. …" for the view, or nothing.
reminder() {
  local cwd=$1 top common root here file live line text owner
  [ -d "$cwd" ] || return 0
  if top=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) &&
    common=$(git -C "$cwd" rev-parse --path-format=absolute --git-common-dir 2>/dev/null); then
    case "$common" in
    */.git) root=${common%/.git} ;;
    *) root=$top ;;
    esac
    here=
    [ "$top" != "$root" ] && here=${top##*/}
  else
    case "/$cwd/" in
    */.claude/* | */.git/*) return 0 ;;
    esac
    root=$cwd here=
  fi
  file=$root/.todo/todo.md
  [ -f "$file" ] && [ ! -L "$file" ] && [ ! -L "$root/.todo" ] || return 0

  # Worktrees git still lists (prunable ones are gone); unknown when git fails, so nothing is hidden.
  local known=0 live_names=$'\n'
  if live=$(git -C "$root" worktree list --porcelain 2>/dev/null); then
    known=1
    local path='' prunable=0
    # Entries are separated by blank lines; the extra newline flushes the last one.
    while IFS= read -r line; do
      case "$line" in
      'worktree '*) path=${line#worktree } prunable=0 ;;
      prunable*) prunable=1 ;;
      '')
        [ -n "$path" ] && [ "$prunable" = 0 ] && live_names+="${path##*/}"$'\n'
        path=''
        ;;
      esac
    done <<<"$live"$'\n'
  fi

  local -a texts=() owners=()
  while IFS= read -r line; do
    case "$line" in
    '- [ ] '*) ;;
    *) continue ;;
    esac
    line=${line#- \[ \] }
    if [[ "$line" =~ $META ]]; then
      text=${BASH_REMATCH[1]} owner=${BASH_REMATCH[4]#, worktree: }
    else
      text=$line owner=
    fi
    if [ -n "$owner" ] && [ "$known" = 1 ]; then
      case "$live_names" in
      *$'\n'"$owner"$'\n'*) ;;
      *) continue ;;
      esac
    fi
    texts+=("$text") owners+=("$owner")
  done <"$file"

  # The view's order: in a worktree its own items, then repo-wide ones; in the main checkout
  # repo-wide first, then each worktree in order of first appearance.
  local -a scopes=() ordered=()
  local i scope seen
  if [ -n "$here" ]; then
    scopes=("$here" "")
  else
    scopes=("")
    for owner in "${owners[@]+"${owners[@]}"}"; do
      seen=0
      for scope in "${scopes[@]}"; do [ "$scope" = "$owner" ] && seen=1; done
      [ "$seen" = 0 ] && scopes+=("$owner")
    done
  fi
  for scope in "${scopes[@]}"; do
    for i in "${!texts[@]}"; do
      [ "${owners[$i]}" = "$scope" ] && ordered+=("${texts[$i]}")
    done
  done
  [ "${#ordered[@]}" -gt 0 ] || return 0

  local out=" Open todo items (${#ordered[@]}):"
  for i in "${!ordered[@]}"; do
    [ "$i" -ge "$MAX_SHOWN" ] && break
    out+=" $((i + 1)). ${ordered[$i]}"
  done
  printf '%s' "$out"
}

input=$(cat)
context=$RULE
if [[ "$input" =~ \"source\"[[:space:]]*:[[:space:]]*\"(resume|clear|compact)\" ]] &&
  [[ "$input" =~ \"cwd\"[[:space:]]*:[[:space:]]*\"([^\"\\]+)\" ]]; then
  context+=$(reminder "${BASH_REMATCH[1]}")
fi
printf '{"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "%s"}}\n' "$(json_escape "$context")"
