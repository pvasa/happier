---
name: happier-diagnose
description: Diagnose a problem with a Happier session, the daemon, a provider (Claude/Codex/OpenCode), auth, or connectivity. Pulls the correct logs, finds a true root cause from evidence only, presents findings, and optionally uploads a private diagnostics bundle to Happier developers and/or files a sanitized public GitHub issue (the two are complementary). Use when the user reports a bug, says Happier is broken/stuck/misbehaving, asks to debug/diagnose/triage/troubleshoot Happier, or shares a Happier session ID and asks what went wrong.
metadata: {"openclaw":{"requires":{"bins":["happier"]},"homepage":"https://github.com/happier-dev/happier"}}
---

# Happier Diagnose

Investigate a Happier issue from real evidence (logs, doctor output, source), determine the root cause at high confidence, and present findings. Then — only with explicit user consent — upload a private diagnostics bundle to Happier developers **and/or** open a sanitized public GitHub issue. The two paths are complementary: the private bundle gives maintainers raw artifacts; the public issue gives them (and the community) a searchable, durable record. Doing both is normal. Mostly hands-off; minimize questions to the user.

## Evidence rules (read first)

- **High confidence only.** Never guess. Every claim in the final root cause must be traceable to a specific log line, a `happier doctor` field, or a specific source file (with line numbers). If you cannot reach high confidence, say "Inconclusive — here's what I observed and what's missing" rather than inventing a story.
- **Symptom ≠ root cause.** A failed RPC call is a symptom; the daemon being stale, the access key being missing, or a provider returning 429 is a root cause.
- **No fabricated paths or flags.** If a path, file, or command is not in this skill, in the user's logs, or in code you have actually read, do not include it.
- **Concrete code references are welcomed.** The Happier maintainers prefer issues that name specific files (`apps/ui/sources/.../AgentInput.tsx:1759`), include code snippets, and propose a hypothesis. This is repo-relative — different from the user's filesystem paths, which must be sanitized in public issues. See `CONTRIBUTING.md`: "A well-written issue ... is often more useful than a PR."

## Process

### 1. Capture the problem (one question max)

If the user has not already described the issue, ask exactly one question: "What's happening, and is there a Happier session ID involved?" Then start investigating immediately. Do not interrogate.

### 2. Get the session context

Ask the user to send **either** of the following (prefer the first):

- **Preferred:** Open the affected session in the Happier app → Session info screen → press **Copy Metadata**, then paste the JSON. This contains every field needed (`sessionLogPath`, `flavor`, `claudeSessionId`/`codexSessionId`, `host`, `path`, `version`, `os`, `hostPid`, `happyHomeDir`, `machineId`, `startedBy`).
- **Fallback:** The Happier session ID alone, then run `happier session status <id> --json` to fetch metadata server-side. (See the `happier-session-control` skill for the JSON contract.)

If the issue is daemon-wide and not session-specific, skip the session metadata and go straight to step 3.

### 3. Run doctor before reading any log

```bash
happier doctor --json
happier auth status --json
```

`doctor` answers most questions without log digging: daemon up, control port reachable, server reachable, auth state, runaway processes, version mismatch, settings sanity. Read its output before opening logs.

### 4. Pull the right logs

**Always trust `metadata.sessionLogPath` and `metadata.happyHomeDir` over any guess.** Different binaries use different home dirs, and `$HAPPIER_HOME_DIR` overrides them. Common values seen in the wild:

- Release CLI → `~/.happier/logs/`
- Dev CLI → `~/.happier-dev/logs/`
- Self-hosted variants → `~/.happier-preview/logs/`, others
- Custom → wherever `$HAPPIER_HOME_DIR` points

If `metadata.sessionLogPath` is missing, fall through the candidate dirs above (in order) and use a glob; never assume a single fixed location.

#### Happier session log

Primary: read `metadata.sessionLogPath` (absolute path). Fallback if absent — search for the file matching `metadata.hostPid`:

```bash
# substitute <happyHomeDir> from metadata, or fall through ~/.happier-dev → ~/.happier → ~/.happier-preview
find "<happyHomeDir>/logs" -maxdepth 1 -name "*-pid-<metadata.hostPid>.log" -not -name "*-daemon.log"
```

Filename format is `YYYY-MM-DD-HH-MM-SS-pid-<pid>.log` (verified on disk).

#### Daemon log

Most recent `*-daemon.log` in `<happyHomeDir>/logs/`. Correlate timestamps with the failure window. There is usually only one active daemon at a time, but stale daemons leave their logs behind, so sort by `mtime`.

#### Claude transcript (when `metadata.flavor === 'claude'` and `metadata.claudeSessionId` is set)

The directory name is the cwd with `/` replaced by `-` (no hash for short paths; only very long paths get a SHA-256 suffix). The session JSONL is named `<claudeSessionId>.jsonl`. **The reliable way is a recursive glob, not computing the path:**

```bash
# search across all Claude project dirs at once
find ~/.claude/projects -maxdepth 2 -name "<claudeSessionId>.jsonl" -type f
```

If nothing matches, ask the user whether their Claude data dir is non-default (`$CLAUDE_CONFIG_DIR` or similar) and re-run with that root.

Note: alongside `<claudeSessionId>.jsonl` you may see a sibling **directory** of the same name — these are sub-session artifacts. The `.jsonl` file itself is the transcript.

Note on `--resume`: when a Happier session resumes a Claude session, Claude writes a NEW `<new-uuid>.jsonl` containing the full prior history with all `sessionId` fields rewritten to the new UUID. The original `<old-uuid>.jsonl` remains as a historical artifact. If you only have the older ID, the latest transcript may live in a different filename — sort the project dir's `.jsonl` files by `mtime` to find the active one.

#### Codex transcript (when `metadata.flavor === 'codex'` and `metadata.codexSessionId` is set)

Codex stores rollouts under date-partitioned subdirs (and an `archived_sessions/` dir for older ones). Do **not** assume `~/.codex/sessions/rollout-*.jsonl` flat. Use a recursive glob:

```bash
# CODEX_HOME defaults to ~/.codex; fall back to ~/.codex if unset
find "${CODEX_HOME:-$HOME/.codex}" -type f \( -name "rollout-*-<codexSessionId>.jsonl" -o -name "rollout-*-<codexSessionId>.json" \) 2>/dev/null
```

Both `.jsonl` (current) and `.json` (legacy) extensions exist. Filename pattern: `rollout-YYYY-MM-DDTHH-MM-SS-<codexSessionId>.jsonl`. Real-world locations include `~/.codex/sessions/<year>/<month>/<day>/`, `~/.codex/sessions/` directly (legacy flat), and `~/.codex/archived_sessions/` (rotated).

If the agent is also running on a connected-services daemon, Codex sessions can live under `<happyHomeDir>/servers/<serverId>/daemon/connected-services/homes/<connectedServiceId>/<profileId>/codex/codex-home/sessions/...` — same filename pattern, different root. Search this root only if the standard glob returns nothing.

#### OpenCode transcript

Not yet implemented in `apps/cli/src/backends/opencode/`. State this in the findings rather than fabricating a path.

#### Reading & searching

Read with `Read` (not `cat`/`tail` via Bash) so secrets stay out of the shell pipeline. Search with ripgrep. Anchor on the failure timestamp and `metadata.hostPid` to filter noise.

### 5. Cross-reference source code only when logs are insufficient

If a log message points to specific behavior you cannot interpret without seeing the code, clone the repo at the user's installed version into a tempdir:

```bash
git clone --depth 1 --branch v<metadata.version> https://github.com/happier-dev/happier /tmp/happier-diagnose-<sessionId> \
  || git clone --depth 1 https://github.com/happier-dev/happier /tmp/happier-diagnose-<sessionId>
```

Anchor reading on these directories: `apps/cli/src/`, `apps/server/sources/`, `packages/protocol/src/`, and the docs in `docs/` (`cli-architecture.md`, `protocol.md`, `encryption.md`, and the per-provider `*-feature-matrix.md`). Skip the clone if logs already explain the failure.

### 6. Form the root cause

Synthesize evidence into a single root cause. Reject a candidate cause unless you have at least one of:

- A log line that names it (with timestamp).
- A `doctor` field whose value contradicts a healthy state.
- Source code that demonstrates the failure mode given the observed inputs.

Common, evidence-anchored root causes to recognize (each with the log/field that confirms it):

- **Auth missing/expired** — `happier auth status --json` returns unauthenticated, or `access.key` absent in `<happyHomeDir>/`.
- **Daemon down or stale** — `doctor` reports daemon not reachable; `daemon.state.json` PID does not match a running process; runaway happier processes listed.
- **Server unreachable** — `happier server test` fails; daemon log shows Socket.IO connect timeouts.
- **Provider rate limit / credentials** — provider transcript shows 429 or 401; CLI session log surfaces the provider error.
- **Encryption / key mismatch** — session log mentions decrypt failure; client `dataEncryptionKey` does not match server's.
- **RPC method not available** — error code `RPC_METHOD_NOT_AVAILABLE`; capabilities probe shows the method missing for the provider/server policy.
- **Version mismatch** — `metadata.version` (CLI) older than daemon's recorded version in `daemon.state.json`.
- **Tmux/terminal attach** — `metadata.terminal.tmuxFallbackReason` populated.

If evidence is thin: say so. Do not pad.

### 7. Present findings to the user

Output this template directly in the chat, before offering any uploads:

<diagnosis-template>

**Root cause** — One sentence naming the cause (not the symptom).

**Evidence** — Bulleted, each with the source:
- `<repo-path-or-doctor-field>:<line-or-key>` — quoted snippet (≤120 chars, redact secrets).

**Impact** — What's broken because of this, and what's not.

**Recommended fix** — The smallest change that resolves the cause. If user-side (re-auth, restart daemon, set env var), give the exact command. If it's a Happier bug, name the file(s) and a concrete proposed change — the maintainers welcome this level of detail in issues.

**Confidence** — high / medium / inconclusive, with one sentence on why.

</diagnosis-template>

### 8. Offer to share — two paths, complementary, explicit consent for each

After presenting findings, ask the user (verbatim):

> "Want me to send this to Happier developers? I can do either or both — they're complementary:
> A) **Private diagnostics upload** to Happier's bug-report service (CLI log tail, daemon log tail, doctor snapshot, sanitized config — only Happier developers see it).
> B) **Public GitHub issue** at `happier-dev/happier` with reproduction steps, root cause, and (if Path A ran) the diagnostics `reportId` so maintainers can correlate.
>
> Note: neither path automatically includes your specific session log or provider transcript — I'll embed the most relevant redacted excerpts in the report."

Wait for the user to pick. Confirm before each action. Never run either without an explicit "yes". If the user picks both, run Path A first so its `reportId` can be referenced in Path B's body.

#### What Path A *does* and *does not* upload

Verified against `apps/cli/src/diagnostics/bugReportArtifacts.ts` and `packages/protocol/src/bugReports/`. The `happier bug-report --include-diagnostics` bundle contains:

- ✅ `cli.log` — tail of the **most recent non-daemon log** in `<happyHomeDir>/logs/` (max 150 KB). **This is not the specific session's log if other sessions ran more recently.**
- ✅ `daemon.log` + `daemon-summary.json` — daemon log tail and state
- ✅ `doctor-snapshot.json`, `cli-context.json` — sanitized environment
- ✅ `server-diagnostics.json` — if the server diagnostics endpoint is enabled
- ✅ `stack-context.json` / `stack-*.log` — stack-service logs if applicable
- ❌ **NOT** the specific session log at `metadata.sessionLogPath`
- ❌ **NOT** the Claude transcript (`~/.claude/projects/.../*.jsonl`)
- ❌ **NOT** the Codex rollout (`~/.codex/.../rollout-*.jsonl`)
- ❌ **NOT** any other provider artifact

**Note on the underlying protocol:** `submitBugReportToService` (in `@happier-dev/protocol`) is a generic two-phase presigned-URL upload. `BugReportArtifactPayload.sourceKind` is just `string`, so technically the server can accept any file kind. Today's blockers are: (1) the client-side `acceptedArtifactKinds` filter in `pushBugReportArtifact` drops kinds not on the server's allowlist (default `cli`, `daemon`, `server`, `stack-service`), and (2) the `happier bug-report` CLI has no `--attach <path>` flag — its artifact set is hardcoded. The daemon-side `BUGREPORT_UPLOAD_ARTIFACT` RPC is also explicitly disabled.

This means an agent running today's CLI **cannot push a session log or provider transcript through `happier bug-report`**. Don't pretend otherwise.

**Workaround (what the agent should do today):** before running `happier bug-report`, extract the smoking-gun excerpts from the session log and provider transcript that you found in step 6, redact them (paths → `$HOME`-relative, no API keys, no full session UUIDs — last 8 chars only), and embed them inline in `--summary` and `--current-behavior`. Quote 5–30 lines max per excerpt. Maintainers find a tightly-scoped excerpt with the relevant log lines far more useful than a multi-megabyte raw transcript anyway.

**Optional follow-up** — if the inability to attach session/provider logs is itself the user's blocker, ask whether they'd like to file a feature request as part of Path B: title `"happier bug-report: support attaching session log and provider transcript files"`, body referencing `apps/cli/src/diagnostics/bugReportArtifacts.ts` (no `--attach` flag), `packages/protocol/src/bugReports/artifacts.ts:19` (kind filter), and `apps/server/sources/app/features/bugReportsFeature.ts` (allowlist env var). The protocol already supports it; only the CLI surface and server allowlist are missing.

#### Path A — Private upload via `happier bug-report`

```bash
happier bug-report \
  --title "<short, specific title from root cause>" \
  --summary "<2-4 sentence summary + key redacted log excerpts in code blocks>" \
  --current-behavior "<what user observed; quote redacted log lines if pivotal>" \
  --expected-behavior "<what should have happened>" \
  --repro-step "<step 1>" --repro-step "<step 2>" \
  --frequency <always|often|sometimes|once> \
  --severity <blocker|high|medium|low> \
  --include-diagnostics \
  --accept-privacy-notice
```

If attaching to an existing GitHub issue instead of creating a new one, add `--existing-issue-number <N>`. To submit without diagnostics, swap `--include-diagnostics` for `--no-include-diagnostics`. The CLI does not currently expose `--json`; parse the human success line for `reportId` and `issueUrl` and surface both to the user.

If the user explicitly asks for the **full** session log or provider transcript to reach Happier devs (e.g., the excerpt isn't enough), tell them honestly: "The protocol layer supports it, but the `happier bug-report` CLI doesn't expose attachments yet, and the server's accepted-kinds list currently rejects `session-log` / `provider-transcript`. The cleanest options today are: (1) attach to a private gist you create yourself and link it in the issue, (2) email Happier support directly with the redacted file attached, or (3) wait for a maintainer to ask for it on the issue." Do **not** invent an upload mechanism that doesn't exist, and do **not** post raw logs to the public GitHub issue.

#### Path B — Public GitHub issue via `gh`

Only when the user opted into Path B. First verify `gh` is installed and authenticated (`gh auth status`); if not, tell the user and stop — do not proceed.

Match the format of `happier-dev/happier#91` and `#93` (the maintainers' canonical examples). Title: specific and descriptive, with a platform prefix when relevant — e.g. `Android: Expand/open icon on tool items unresponsive to touch`, not `icon broken`. Body sections, in this order: `## Description`, optional `### Observed behavior` (numbered), `## Root Cause` (with code snippets and repo-relative `path/to/file.ts:line` references), `## Suggested Fix` (concrete code or approach), `## Affected Files` (bulleted with line numbers), and `## Environment` (CLI version, OS, provider).

Repo-relative paths (`apps/ui/sources/components/...:1759`) and code snippets are encouraged. Do **not** include: log contents, the user's absolute filesystem paths, hostnames, machine IDs, full Happier session IDs, full provider session IDs, access keys, or API tokens. If Path A ran, include the `reportId` so maintainers can correlate.

```bash
gh issue create --repo happier-dev/happier \
  --title "<platform prefix if relevant>: <specific, descriptive title>" \
  --body "$(cat <<'EOF'
## Description

<one paragraph: what the user did, what they expected, what actually happened>

### Observed behavior

1. <step + outcome>
2. <step + outcome>
3. <step + outcome>

## Root Cause

<one or two paragraphs naming the cause, then code snippets from the repo with file:line references. Quote 5-15 lines of relevant code in fenced blocks.>

## Suggested Fix

<concrete code change or approach. Code block if applicable.>

## Affected Files

- `apps/.../File.tsx` (line N — <one-line note>)
- `apps/.../Other.ts` (line M — <one-line note>)

## Environment

- Happier CLI: <metadata.version>
- OS: <metadata.os>
- Provider: <metadata.flavor>
- Diagnostics: reportId=<from Path A, if available>
EOF
)"
```

If the user only has a symptom and no concrete code-level finding (i.e., step 6 returned "inconclusive"), still file the issue — the contribution guidelines explicitly value "a well-written issue ... clear repro steps, platform context, observed vs expected behavior" even without a hypothesis. In that case, omit `## Root Cause` and `## Suggested Fix` and lead with `## Description` + `### Steps to reproduce`. Show the user the issue URL after creation.

## Privacy

- **Path A** uploads sanitized artifacts: log tails are redacted by `redactBugReportSensitiveText` and absolute paths are stripped to `$HOME`-relative (`apps/cli/src/diagnostics/bugReportArtifacts.ts`). Default size cap ~10 MB. Only Happier developers see the bundle.
- **Path B** is fully public. Treat anything in the body as world-readable forever. **Allowed:** repo-relative paths, code snippets from the public repo, reproduction steps, platform info. **Not allowed:** log contents, the user's absolute filesystem paths, hostnames, machine IDs, full session IDs, access keys, OAuth tokens, or provider API keys.
- Never include `access.key`, encryption keys, OAuth tokens, or provider API keys in either path.

## When to stop and ask

- The fix would change shared state outside the user's machine (server, GitHub, another user's session).
- Evidence is inconclusive but the user is pushing for a fix anyway — say so and let them decide.
- The "fix" requires deleting files (`access.key`, `daemon.state.json`, log files): confirm first.
