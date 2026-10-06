#!/usr/bin/env bash
# Structural tests for the marketplace and every plugin under plugins/.
# Run from the repository root. Exit 0 on success, 1 on failure, 2 if jq is missing.
set -u

cd "$(dirname "$0")/.." || exit 2

command -v jq >/dev/null 2>&1 || { echo "jq not found"; exit 2; }

passed=0
failed=0
MARKETPLACE=".claude-plugin/marketplace.json"

pass() { echo "PASS $1"; passed=$((passed + 1)); }
fail() { echo "FAIL $1: $2"; failed=$((failed + 1)); }

summary() {
  echo "$passed passed, $failed failed"
  [ "$failed" -eq 0 ]
  exit $?
}

# C1: marketplace exists and parses
if [ ! -f "$MARKETPLACE" ]; then
  fail C1 "$MARKETPLACE not found"
  summary
fi
if ! jq empty "$MARKETPLACE" 2>/dev/null; then
  fail C1 "$MARKETPLACE is not valid JSON"
  summary
fi
pass C1

# C2: required marketplace fields
if jq -e '(.name | type == "string") and (.owner.name | type == "string")
          and (.plugins | type == "array" and length > 0)' "$MARKETPLACE" >/dev/null; then
  pass C2
else
  fail C2 "marketplace requires string name, string owner.name, non-empty plugins array"
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

  # C6: exactly one marketplace entry, with matching source
  count=$(jq --arg n "$plugin" '[.plugins[] | select(.name == $n)] | length' "$MARKETPLACE")
  source=$(jq -r --arg n "$plugin" '.plugins[] | select(.name == $n) | .source' "$MARKETPLACE")
  if [ "$count" -ne 1 ]; then
    fail "C6 [$plugin]" "expected 1 marketplace entry named '$plugin', found $count"
  elif [ "$source" != "./plugins/$plugin" ]; then
    fail "C6 [$plugin]" "source '$source' is not './plugins/$plugin'"
  else
    pass "C6 [$plugin]"
  fi

  # C8: SKILL.md frontmatter
  for skill_file in "$dir"skills/*/SKILL.md; do
    [ -f "$skill_file" ] || continue
    skill=$(basename "$(dirname "$skill_file")")
    label="C8 [$plugin/$skill]"
    if [ "$(head -n 1 "$skill_file")" != "---" ]; then
      fail "$label" "line 1 is not '---'"
      continue
    fi
    frontmatter=$(awk 'NR == 1 { next } /^---$/ { closed = 1; exit } { print } END { exit !closed }' "$skill_file") \
      || { fail "$label" "frontmatter not closed"; continue; }
    if ! grep -qx "name: $skill" <<<"$frontmatter"; then
      fail "$label" "frontmatter lacks 'name: $skill'"
    elif ! grep -qE '^description: *[^ ]' <<<"$frontmatter"; then
      fail "$label" "frontmatter lacks a non-empty description"
    else
      pass "$label"
    fi
  done
done

# C7: every marketplace source exists
while IFS= read -r source; do
  if [ -d "$source" ]; then
    pass "C7 [$source]"
  else
    fail "C7 [$source]" "source directory not found"
  fi
done < <(jq -r '.plugins[].source' "$MARKETPLACE")

# C9: official validator on the marketplace and on each plugin, if available
if command -v claude >/dev/null 2>&1; then
  for target in . plugins/*/; do
    [ -d "$target" ] || continue
    if output=$(claude plugin validate "$target" 2>&1); then
      pass "C9 [$target]"
    else
      fail "C9 [$target]" "claude plugin validate failed: $output"
    fi
  done
else
  echo "SKIP C9: claude CLI not found"
fi

summary
