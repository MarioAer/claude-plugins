# Security policy

## Supported versions

Only the latest released version of each plugin receives fixes. Releases are tagged `<plugin>-v<version>`; see the repository's GitHub releases.

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security** tab of this repository, then **Report a vulnerability** (https://github.com/MarioAer/claude-plugins/security/advisories/new). Do not open a public issue.

Include the plugin and version, your Claude Code version (`claude --version`), the permission mode, and steps to reproduce.

You can expect an acknowledgement within 7 days. Confirmed issues are fixed in a new plugin version and disclosed in a GitHub security advisory after the release.

## Scope

In scope are the files in this repository, in particular hooks that make permission decisions: `plugins/backlog/hooks/allow-backlog-write.sh` (allows writes) and `plugins/skim/hooks/guard-read.sh` (denies reads, and allows on any internal error). A finding is in scope if a plugin approves an action that Claude Code would otherwise prompt for, beyond what the plugin documents, or if the skim guard can be made to deny something its README says it never blocks.

Vulnerabilities in Claude Code itself belong to Anthropic: https://www.anthropic.com/responsible-disclosure-policy.
