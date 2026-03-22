# Subagents QA Loop 02 Tracker

Date started: 2026-03-22
Status: Active

Policy: resume prior review context, restart scenario execution.

## Execution Setup

Record per run:
- Stack id / environment:
- CLI auth account:
- UI auth account:
- Feature toggles enabled:
- Backend(s) validated:

## Scenario Matrix

Fill in each row with ids + evidence links/paths.

### A) Parent-managed delegation (execution-run-backed)

- [ ] Start a child run from an existing session (UI launcher)
  - sessionId:
  - runId:
  - backendTarget:
  - observed status:
  - evidence:
- [ ] Send follow-up to child (`execution_run_send`) and verify actual delivery/completion
  - sessionId:
  - runId:
  - expected:
  - observed:
  - evidence:
- [ ] Wait semantics (`run wait`) matches UI projected completion state
  - sessionId:
  - runId:
  - observed:
  - evidence:
- [ ] Stop/cancel semantics (UI + CLI action) stops mutation and resolves status truthfully
  - sessionId:
  - runId:
  - observed:
  - evidence:

### B) Cross-surface parity (CLI vs MCP vs UI)

- [ ] Start run via CLI wrapper and verify UI projection
  - sessionId:
  - runId:
  - evidence:
- [ ] Start run via MCP tool exposure and verify UI projection
  - sessionId:
  - runId:
  - evidence:
- [ ] Send via CLI and observe transcript + run state
  - sessionId:
  - runId:
  - evidence:

### C) Hydration and restart

- [ ] Post-restart session surface hydration renders full UI (not shell-only) before judging run health
  - sessionId:
  - evidence:
- [ ] Post-restart: subagent/run rows visible and accurate
  - sessionId:
  - evidence:

### D) Transcript integrity

- [ ] Streamed-to-final transition does not duplicate/concatenate assistant text
  - sessionId:
  - runId:
  - evidence:

### E) Side effects

- [ ] SCM refresh/invalidation does not regress during subagent activity
  - sessionId:
  - evidence:

## Blockers

List blockers explicitly (backend unavailable, missing capability, env limitation, etc.).

