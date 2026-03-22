# Subagents QA Loop 02 Manifest

Date: 2026-03-22
Owner: Leeroy / Codex
Status: Active

## Scope

This loop validates end-to-end behavior for:
- Execution-run-backed delegation inside an existing session (parent-managed subagents)
- Run lifecycle operations: start, list, get, send, wait, stop, action
- UI projection of child runs into subagent surfaces (sidebar rows, transcript entrypoints, details)
- Parity across UI, MCP, and CLI where applicable
- Post-restart hydration and capability timing

## Source Material

- Prior loop (historical evidence): `.project/reviews/2026-03-17/subagents-qa-loop-01/`
- Plan: `.project/plans/todo/happier-post-refactor-subagents-qa-restart-and-execution-run-audit-2026-03-18.md`

## Preconditions (must record per scenario)

- Feature toggles / capabilities enabled as required
- Session `backendTarget` reflects the intended backend (not a stale legacy field)
- Capability hydration completed before evaluating UI affordances
- MCP/built-in tool exposure is present before drawing conclusions about parent-managed flows

## Evidence Policy

For failures/flakes, collect concrete evidence before changing code:
- stack/daemon/server logs
- browser console and network traces
- session transcript history where relevant
- run state payloads and identifiers (session id, run id, machine id)

