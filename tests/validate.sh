#!/usr/bin/env bash
# Structural tests for the marketplace and every plugin under plugins/.
# Exit 0 on success, 1 on failure, 2 if a dependency is missing.
# Set VALIDATE_SKIP_CLI=1 to skip the 'claude plugin validate' check (C9).
set -u

cd "$(dirname "$0")/.." || exit 2

for dep in jq python3; do
  command -v "$dep" >/dev/null 2>&1 || { echo "$dep not found"; exit 2; }
done

passed=0
failed=0
MARKETPLACE=".claude-plugin/marketplace.json"
COMPONENTS="skills commands agents hooks output-styles .mcp.json .lsp.json"

pass() { echo "PASS $1"; passed=$((passed + 1)); }
fail() { echo "FAIL $1: $2"; failed=$((failed + 1)); }
skip() { echo "SKIP $1: $2"; }

finish() {
  echo "$passed passed, $failed failed"
  [ "$failed" -eq 0 ] && exit 0
  exit 1
}

# Prints "name<TAB>description" from SKILL.md frontmatter, or an error message with exit 1.
read_frontmatter() {
  python3 - "$1" <<'PY'
import re, sys
lines = open(sys.argv[1], encoding="utf-8").read().replace("\r\n", "\n").split("\n")
if not lines or lines[0] != "---":
    print("line 1 is not '---'"); sys.exit(1)
try:
    end = lines.index("---", 1)
except ValueError:
    print("frontmatter not closed"); sys.exit(1)
block, fields, i = lines[1:end], {}, 0
while i < len(block):
    m = re.match(r"^([A-Za-z0-9_-]+):\s*(.*)$", block[i])
    i += 1
    if not m:
        continue
    key, value = m.group(1), m.group(2).strip()
    if value in (">", "|", ">-", "|-", ">+", "|+"):
        body = []
        while i < len(block) and (block[i].startswith((" ", "\t")) or not block[i].strip()):
            body.append(block[i].strip())
            i += 1
        value = " ".join(part for part in body if part)
    elif len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
        value = value[1:-1]
    fields[key] = value
print(f"{fields.get('name', '')}\t{fields.get('description', '')}")
PY
}

# C1: marketplace exists and parses
if [ ! -f "$MARKETPLACE" ]; then
  fail C1 "$MARKETPLACE not found"
  finish
fi
if ! jq empty "$MARKETPLACE" 2>/dev/null; then
  fail C1 "$MARKETPLACE is not valid JSON"
  finish
fi
pass C1

# C2: required marketplace fields and well-formed, unique entries
if ! jq -e '(.name | type == "string") and (.owner.name | type == "string")
            and (.plugins | type == "array" and length > 0)' "$MARKETPLACE" >/dev/null; then
  fail C2 "marketplace requires string name, string owner.name, non-empty plugins array"
  finish
elif ! jq -e '.plugins | all(type == "object" and (.name | type == "string")
              and (.source | type == "string" or type == "object"))' "$MARKETPLACE" >/dev/null; then
  fail C2 "every plugin entry must be an object with string name and string or object source"
  finish
elif ! jq -e '.plugins | (map(.name) | length) == (map(.name) | unique | length)' "$MARKETPLACE" >/dev/null; then
  fail C2 "duplicate plugin names in marketplace"
elif ! jq -e '[.plugins[] | .source | select(type == "string")] | length == (unique | length)' "$MARKETPLACE" >/dev/null; then
  fail C2 "duplicate plugin sources in marketplace"
else
  pass C2
fi

for dir in plugins/*/; do
  [ -d "$dir" ] || continue
  plugin=$(basename "$dir")
  manifest="$dir.claude-plugin/plugin.json"

  # C3: plugin manifest exists and parses
  if [ ! -f "$manifest" ] || ! jq empty "$manifest" 2>/dev/null; then
    fail "C3 [$plugin]" "$manifest missing or not valid JSON"
    continue
  fi
  pass "C3 [$plugin]"

  # C4: name matches directory, is kebab-case, has no reserved prefix
  name=$(jq -r '.name // ""' "$manifest")
  if [ "$name" != "$plugin" ]; then
    fail "C4 [$plugin]" "plugin.json name '$name' does not match directory"
  elif ! [[ "$name" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]]; then
    fail "C4 [$plugin]" "name '$name' is not kebab-case"
  elif [[ "$name" =~ ^(claude-|anthropic-|cc-plugin-) ]]; then
    fail "C4 [$plugin]" "name '$name' uses a reserved prefix"
  else
    pass "C4 [$plugin]"
  fi

  # C5: metadata that 'claude plugin validate' warns about
  if jq -e '(.version | type == "string") and (.description | type == "string")
            and (.author.name | type == "string")' "$manifest" >/dev/null; then
    pass "C5 [$plugin]"
  else
    fail "C5 [$plugin]" "plugin.json requires version, description, author.name"
  fi

  # C6: exactly one marketplace entry, with matching local source
  entry_source=$(jq -r --arg n "$plugin" '[.plugins[] | select(.name == $n) | .source]
                 | if length == 1 then .[0] | tostring else "count:\(length)" end' "$MARKETPLACE")
  if [[ "$entry_source" == count:* ]]; then
    fail "C6 [$plugin]" "expected 1 marketplace entry named '$plugin', found ${entry_source#count:}"
  elif [ "$entry_source" != "./plugins/$plugin" ]; then
    fail "C6 [$plugin]" "source '$entry_source' is not './plugins/$plugin'"
  else
    pass "C6 [$plugin]"
  fi

  # C10: plugin has at least one component
  found=""
  for component in $COMPONENTS; do
    [ -e "$dir$component" ] && found="$component" && break
  done
  if [ -n "$found" ]; then
    pass "C10 [$plugin]"
  else
    fail "C10 [$plugin]" "no component found (expected one of: $COMPONENTS)"
  fi

  # C12: hooks.json parses and every script it references via CLAUDE_PLUGIN_ROOT exists
  hooks_file="${dir}hooks/hooks.json"
  if [ -f "$hooks_file" ]; then
    if ! jq empty "$hooks_file" 2>/dev/null; then
      fail "C12 [$plugin]" "$hooks_file is not valid JSON"
    else
      # shellcheck disable=SC2016  # the literal ${CLAUDE_PLUGIN_ROOT} is matched, not expanded
      scripts=$(jq -r '.. | .command? // empty' "$hooks_file" \
        | grep -oE '\$\{CLAUDE_PLUGIN_ROOT\}/[^" ]+' | sed 's#^${CLAUDE_PLUGIN_ROOT}/##')
      missing=""
      for script in $scripts; do
        [ -f "$dir$script" ] || missing="$missing $script"
      done
      if [ -n "$missing" ]; then
        fail "C12 [$plugin]" "hook scripts not found:$missing"
      else
        pass "C12 [$plugin]"
      fi
    fi
  fi

  # C8: SKILL.md frontmatter has a matching name and a non-empty description
  for skill_file in "$dir"skills/*/SKILL.md; do
    [ -f "$skill_file" ] || continue
    skill=$(basename "$(dirname "$skill_file")")
    label="C8 [$plugin/$skill]"
    if ! frontmatter=$(read_frontmatter "$skill_file" 2>/dev/null); then
      fail "$label" "$frontmatter"
      continue
    fi
    fm_name=${frontmatter%%$'\t'*}
    fm_description=${frontmatter#*$'\t'}
    if [ "$fm_name" != "$skill" ]; then
      fail "$label" "frontmatter name '$fm_name' does not match directory '$skill'"
    elif [ -z "$fm_description" ]; then
      fail "$label" "frontmatter lacks a non-empty description"
    else
      pass "$label"
    fi
  done
done

# C7: every local marketplace source exists; non-local sources are reported, not checked
expected=$(jq '.plugins | length' "$MARKETPLACE")
seen=0
while IFS=$'\t' read -r entry_name entry_source; do
  seen=$((seen + 1))
  if [[ "$entry_source" != ./* ]]; then
    skip "C7 [$entry_name]" "non-local source not checked"
  elif [ -d "$entry_source" ]; then
    pass "C7 [$entry_name]"
  else
    fail "C7 [$entry_name]" "source directory '$entry_source' not found"
  fi
done < <(jq -r '.plugins[] | [.name, (.source | if type == "string" then . else "object" end)] | @tsv' "$MARKETPLACE")
[ "$seen" -eq "$expected" ] || fail C7 "checked $seen of $expected marketplace entries"

# C11: README documents installation of every plugin
marketplace_name=$(jq -r '.name' "$MARKETPLACE")
if [ ! -f README.md ]; then
  fail C11 "README.md not found"
elif ! grep -Fq "/plugin marketplace add" README.md; then
  fail C11 "README.md lacks the '/plugin marketplace add' instruction"
else
  for plugin in $(jq -r '.plugins[].name' "$MARKETPLACE"); do
    if grep -Fq "/plugin install $plugin@$marketplace_name" README.md; then
      pass "C11 [$plugin]"
    else
      fail "C11 [$plugin]" "README.md lacks '/plugin install $plugin@$marketplace_name'"
    fi
  done
fi

# C9: official validator on the marketplace and on each plugin
if [ "${VALIDATE_SKIP_CLI:-0}" = 1 ]; then
  skip C9 "VALIDATE_SKIP_CLI=1"
elif ! command -v claude >/dev/null 2>&1; then
  skip C9 "claude CLI not found"
else
  for target in . plugins/*/; do
    [ -d "$target" ] || continue
    if output=$(claude plugin validate "$target" 2>&1); then
      pass "C9 [$target]"
    else
      fail "C9 [$target]" "claude plugin validate failed: $output"
    fi
  done
fi

finish
