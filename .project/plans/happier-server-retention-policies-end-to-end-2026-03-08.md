# Happier Server Retention Policies End-to-End Plan (2026-03-08)

## Summary
Add one canonical server-retention system that:
- defaults to keeping everything forever
- lets server operators opt into finite retention per data domain
- deletes stale session trees safely without reading encrypted transcript payloads
- exposes the effective policy through the existing `/v1/features` capabilities payload
- surfaces that policy clearly in the UI for the active server and for individual sessions
- uses one unified cleanup worker, one config parser, one capability contract, and one test strategy

The most important v1 retention unit is the whole session, not partial transcript pruning. Session deletion must remove dependent rows through existing ownership rules, emit the same account-change/socket signals as normal user deletion, and remain compatible with encrypted-at-rest sessions.

## Goals
- Keep current behavior unchanged by default.
- Allow server operators to define finite retention without patching code.
- Make retention discoverable to users in-app.
- Avoid decrypting server-stored ciphertext for cleanup decisions.
- Keep the implementation unified, observable, and safe to run continuously.
- Cover the feature with unit, integration, core e2e, and UI e2e tests.

## Non-Goals For V1
- Per-message TTL inside a live session.
- Ad hoc table-specific cron jobs outside the unified retention framework.
- Server-generated localized user-facing copy.
- Auto-deleting durable user-owned artifacts/files/tokens just because they are old.

## Current-State Assessment
### What already exists and should be reused
- `Session.updatedAt` already tracks transcript/metadata writes because session mutations update the `Session` row.
- `Session.lastActiveAt` already exists in plaintext and is updated by presence logic.
- `apps/server/sources/app/session/sessionDelete.ts` already handles:
  - session-owned row cleanup
  - account-change emission
  - socket delete updates
- `apps/server/sources/app/changes/accountChangeCleanup.ts` already implements a cleanup-worker pattern and the required `changesFloor` bump.
- `apps/server/sources/app/voice/voiceSessionLeaseCleanup.ts` already implements another cleanup-worker pattern.
- `/v1/features` is already the canonical server capability transport and is assembled by `apps/server/sources/app/features/catalog/resolveServerFeaturePayload.ts`.
- UI server capability fetching/parsing already exists in:
  - `apps/ui/sources/sync/api/capabilities/serverFeaturesClient.ts`
  - `apps/ui/sources/sync/api/capabilities/serverFeaturesParse.ts`
  - `apps/ui/sources/sync/domains/features/featureDecisionRuntime.ts`

### Important conclusions
- We do not need to extract message dates from encrypted content to satisfy the requested initial session policy. `Session.updatedAt` plus `Session.lastActiveAt` already support “last modified and last active older than N days”.
- We should not prune individual `SessionMessage` rows in v1. That would create avoidable risk around:
  - `seq` ordering
  - pending queue semantics
  - sharing/public share reads
  - account changes and catch-up behavior
  - transcript integrity assumptions in clients
- The correct deletion boundary for v1 is the session tree.
- Cleanup logic should be centralized instead of extending the current one-off workers forever.

## Product Decisions
### 1. Session retention rule
The main session policy should be:
- `keep_forever`
- `delete_inactive`

`delete_inactive` means a session is eligible when all of the following are true:
- `Session.updatedAt < cutoff`
- `Session.lastActiveAt < cutoff`

Optional additional guard for safety:
- skip deletion if the session is currently observed as active by the runtime during the same sweep

We should not require `archivedAt` for deletion. Retention is server policy, not an archive-only feature.

### 2. What must be covered by unified retention in v1
These domains are the highest-value growth controls and should be wired into the same retention framework in the same implementation:
- `sessions`
- `accountChanges`
- `voiceSessionLeases` (migrate existing cleanup into the unified system)
- `userFeedItems`
- `sessionShareAccessLogs`
- `publicShareAccessLogs`
- `terminalAuthRequests`
- `accountAuthRequests`
- `authPairingSessions`
- `repeatKeys`
- `globalLocks`
- `automationRuns`
- `automationRunEvents`

### 3. What should stay keep-forever unless explicitly designed later
These models may grow, but automatic deletion is not safe enough to ship in the same pass without additional ownership/reference contracts:
- `Artifact`
- `UploadedFile`
- `ServiceAccountToken`
- `ServiceAccountQuotaSnapshot`
- `VoiceConversation`
- `PublicSessionShare`
- `SessionShare`

Reason:
- they may represent durable user data or current product state rather than operational history
- some of them require explicit reference tracking or product policy before retention-based deletion is acceptable

The framework should still support future rule additions for these domains.

## Canonical Capability Contract
Retention should be surfaced through `capabilities.server`, not through a new endpoint and not through `features.*.enabled`.

### Protocol shape to add
Add a new protocol schema under `packages/protocol/src/features/payload/capabilities/serverRetentionCapabilities.ts`.

Recommended shape:

```ts
type RetentionMode = 'keep_forever' | 'delete_older_than' | 'delete_inactive';

type KeepForeverPolicy = {
  mode: 'keep_forever';
};

type DeleteOlderThanPolicy = {
  mode: 'delete_older_than';
  days: number;
};

type DeleteInactiveSessionsPolicy = {
  mode: 'delete_inactive';
  inactivityDays: number;
  requires: ['updatedAt', 'lastActiveAt'];
};

type ServerRetentionCapabilities = {
  policyVersion: 1;
  enabled: boolean;
  sessions: KeepForeverPolicy | DeleteInactiveSessionsPolicy;
  accountChanges: KeepForeverPolicy | DeleteOlderThanPolicy;
  voiceSessionLeases: KeepForeverPolicy | DeleteOlderThanPolicy;
  userFeedItems: KeepForeverPolicy | DeleteOlderThanPolicy;
  sessionShareAccessLogs: KeepForeverPolicy | DeleteOlderThanPolicy;
  publicShareAccessLogs: KeepForeverPolicy | DeleteOlderThanPolicy;
  terminalAuthRequests: KeepForeverPolicy | DeleteOlderThanPolicy;
  accountAuthRequests: KeepForeverPolicy | DeleteOlderThanPolicy;
  authPairingSessions: KeepForeverPolicy | DeleteOlderThanPolicy;
  repeatKeys: KeepForeverPolicy | DeleteOlderThanPolicy;
  globalLocks: KeepForeverPolicy | DeleteOlderThanPolicy;
  automationRuns: KeepForeverPolicy | DeleteOlderThanPolicy;
  automationRunEvents: KeepForeverPolicy | DeleteOlderThanPolicy;
};
```

Then extend:
- `packages/protocol/src/features/payload/capabilities/serverCapabilities.ts`
- `packages/protocol/src/features/payload/capabilities/capabilitiesSchema.ts`

Important:
- Do not send formatted human text in the payload.
- The client should localize and phrase the policy.
- `enabled` means at least one domain is configured with finite retention.

## Server Configuration Model
Use one dedicated retention config parser instead of scattered env reads.

### Global env keys
- `HAPPIER_SERVER_RETENTION__ENABLED`
- `HAPPIER_SERVER_RETENTION__INTERVAL_MS`
- `HAPPIER_SERVER_RETENTION__BATCH_SIZE`
- `HAPPIER_SERVER_RETENTION__DRY_RUN`
- `HAPPIER_SERVER_RETENTION__MAX_DELETES_PER_RULE_PER_RUN`

Defaults:
- `ENABLED=false`
- `INTERVAL_MS=21600000` (6h)
- `BATCH_SIZE=100`
- `DRY_RUN=false`
- `MAX_DELETES_PER_RULE_PER_RUN=1000`

### Domain env keys
- `HAPPIER_SERVER_RETENTION__SESSIONS__MODE=keep_forever|delete_inactive`
- `HAPPIER_SERVER_RETENTION__SESSIONS__INACTIVITY_DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__ACCOUNT_CHANGES__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__ACCOUNT_CHANGES__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__VOICE_SESSION_LEASES__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__VOICE_SESSION_LEASES__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__USER_FEED_ITEMS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__USER_FEED_ITEMS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__SESSION_SHARE_ACCESS_LOGS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__SESSION_SHARE_ACCESS_LOGS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__PUBLIC_SHARE_ACCESS_LOGS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__PUBLIC_SHARE_ACCESS_LOGS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__TERMINAL_AUTH_REQUESTS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__TERMINAL_AUTH_REQUESTS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__ACCOUNT_AUTH_REQUESTS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__ACCOUNT_AUTH_REQUESTS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__AUTH_PAIRING_SESSIONS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__AUTH_PAIRING_SESSIONS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__REPEAT_KEYS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__REPEAT_KEYS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__GLOBAL_LOCKS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__GLOBAL_LOCKS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__AUTOMATION_RUNS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__AUTOMATION_RUNS__DAYS=<int>`
- `HAPPIER_SERVER_RETENTION__AUTOMATION_RUN_EVENTS__MODE=keep_forever|delete_older_than`
- `HAPPIER_SERVER_RETENTION__AUTOMATION_RUN_EVENTS__DAYS=<int>`

Validation rules:
- every domain defaults to `keep_forever`
- if a domain mode is finite, its day value is required
- minimum day value should be at least `1`
- invalid config should fail server startup loudly

## Server File Structure
Create a new retention domain under `apps/server/sources/app/retention/`.

### Config
- `apps/server/sources/app/retention/config/retentionPolicyTypes.ts`
- `apps/server/sources/app/retention/config/readRetentionPolicyFromEnv.ts`
- `apps/server/sources/app/retention/config/retentionPolicyToCapabilities.ts`

### Runtime
- `apps/server/sources/app/retention/runtime/startRetentionWorker.ts`
- `apps/server/sources/app/retention/runtime/runRetentionSweep.ts`
- `apps/server/sources/app/retention/runtime/retentionRuleRegistry.ts`
- `apps/server/sources/app/retention/runtime/retentionSweepLock.ts`
- `apps/server/sources/app/retention/runtime/retentionRunLogging.ts`

### Rules
- `apps/server/sources/app/retention/rules/sessionRetentionRule.ts`
- `apps/server/sources/app/retention/rules/accountChangeRetentionRule.ts`
- `apps/server/sources/app/retention/rules/voiceSessionLeaseRetentionRule.ts`
- `apps/server/sources/app/retention/rules/userFeedItemRetentionRule.ts`
- `apps/server/sources/app/retention/rules/sessionShareAccessLogRetentionRule.ts`
- `apps/server/sources/app/retention/rules/publicShareAccessLogRetentionRule.ts`
- `apps/server/sources/app/retention/rules/terminalAuthRequestRetentionRule.ts`
- `apps/server/sources/app/retention/rules/accountAuthRequestRetentionRule.ts`
- `apps/server/sources/app/retention/rules/authPairingSessionRetentionRule.ts`
- `apps/server/sources/app/retention/rules/repeatKeyRetentionRule.ts`
- `apps/server/sources/app/retention/rules/globalLockRetentionRule.ts`
- `apps/server/sources/app/retention/rules/automationRunRetentionRule.ts`
- `apps/server/sources/app/retention/rules/automationRunEventRetentionRule.ts`

### Session deletion refactor
Do not let the retention rule delete session rows directly. Refactor the current session deletion flow into reusable focused files:
- `apps/server/sources/app/session/delete/deleteSessionTree.ts`
- `apps/server/sources/app/session/delete/loadSessionDeleteRecipients.ts`
- `apps/server/sources/app/session/delete/emitSessionDeletedUpdate.ts`
- `apps/server/sources/app/session/delete/deleteOwnedSession.ts`
- keep `apps/server/sources/app/session/sessionDelete.ts` as the API-facing wrapper

`deleteOwnedSession.ts` should accept a reason:
- `user_request`
- `retention_policy`

That reason is for logs/telemetry only, not behavior divergence.

## Startup Wiring
Replace the separate startup hooks in `apps/server/sources/startServer.ts`:
- `startAccountChangeCleanupFromEnv()`
- `startVoiceSessionLeaseCleanupFromEnv()`

with one:
- `startRetentionWorker()`

This worker should:
- read and validate the full retention config once at startup
- no-op if disabled or if every domain is `keep_forever`
- run once at startup and then on interval
- optionally use a global DB lock so multiple worker replicas do not sweep simultaneously
- emit per-rule logs and per-sweep summary logs
- wrap the sweep in `maybeCaptureSentryMonitorCheckIn(...)`

The old account-change and voice-lease cleanup functions should either be deleted or reduced to thin wrappers used only by the new rule implementations. Do not keep two independent scheduling systems.

## Deletion Semantics By Domain
### Sessions
Implementation:
- query eligible sessions in batches ordered by oldest relevant timestamps first
- for each candidate, re-read inside a transaction before deleting
- call the refactored session deletion service

Required behavior:
- delete `SessionMessage`, `SessionPendingMessage`, `UsageReport`, `AccessKey`, `SessionShare`, `PublicSessionShare`, and other dependent rows through existing ownership/cascade behavior
- emit `AccountChange(kind='session')` for owner and share recipients before delete
- emit socket delete updates after commit
- remain compatible with both `e2ee` and `plain` session storage because selection is based only on plaintext columns

Important:
- do not skip shared-recipient delete notifications
- do not bypass the existing account-change machinery

### Account changes
Implementation:
- extend the current orphan cleanup logic into a finite-age retention rule
- prune aged changes in bounded per-account windows
- always bump `Account.changesFloor` to the maximum deleted cursor per account

Required behavior:
- `/v2/changes` must continue returning `410 cursor-gone` for stale cursors below the new floor

### Voice session leases
Implementation:
- migrate the current `expiresAt` cleanup to the unified registry
- no extra capability shape beyond the generic `delete_older_than`

### Feed items and access logs
Implementation:
- pure age-based deletes by `createdAt` or `accessedAt`
- use bounded deletes with indexes

### Auth request / pairing / repeat-key / lock cleanup
Implementation:
- `AuthPairingSession`: delete expired sessions older than a grace window or direct finite-age rule
- `TerminalAuthRequest` and `AccountAuthRequest`: delete old completed or stale rows by `updatedAt`
- `RepeatKey`: delete expired rows older than the configured age; never delete unexpired rows
- `GlobalLock`: delete stale expired locks only; do not delete active valid locks

### Automation history
Implementation:
- `AutomationRun`: only delete terminal runs older than the configured threshold
- terminal states should include completed/failed/cancelled states only
- `AutomationRunEvent`: delete by age, or cascade with parent run deletion when applicable

## Database / Prisma Changes
Add only the indexes needed to keep sweep queries cheap and predictable.

Recommended new indexes:
- `Session`
  - `@@index([lastActiveAt, updatedAt])`
- `TerminalAuthRequest`
  - `@@index([updatedAt])`
- `AccountAuthRequest`
  - `@@index([updatedAt])`
- `AutomationRun`
  - `@@index([state, finishedAt])`
- `AutomationRunEvent`
  - `@@index([ts])`
- `UserFeedItem`
  - `@@index([createdAt])`

Retain existing indexes already useful for cleanup:
- `AuthPairingSession @@index([expiresAt])`
- `SessionShareAccessLog @@index([accessedAt])`
- `PublicShareAccessLog @@index([accessedAt])`
- `VoiceSessionLease @@index([accountId, expiresAt])`

If SQLite or MySQL query plans show different needs during implementation, adjust pragmatically, but keep the final index set small and purpose-specific.

## Feature Payload Assembly
Add a new resolver:
- `apps/server/sources/app/features/serverRetentionCapabilitiesFeature.ts`

Responsibilities:
- call `readRetentionPolicyFromEnv(process.env)`
- transform the parsed policy into the protocol capability shape
- return:
  - `capabilities.server.retention = ...`

Then register it alongside the existing server URL capability resolver in the server feature registry/wiring path.

## UI Surfacing Plan
The UI should make retention visible without turning it into constant warning chrome.

### UX rules
- If the connected server keeps everything forever, show either nothing or an explicit but quiet “No automatic deletion” line only in server settings.
- If retention is finite, show a concise summary in places where users make trust decisions.
- Phrase policies in plain language:
  - “This server deletes inactive sessions after 30 days.”
  - “Share access logs are removed after 30 days.”
- Use existing theme tokens and `Text` primitives only.
- Keep motion subtle and coherent with the current settings/session visual language.

### UI surfaces to implement
#### 1. Server Settings screen
Add a dedicated section under:
- `apps/ui/sources/components/settings/server/sections/ServerRetentionSection.tsx`

Wire it from:
- `apps/ui/sources/components/settings/server/screens/ServerSettingsScreen.tsx`
- `apps/ui/sources/components/settings/server/hooks/useServerSettingsScreenController.ts`

Behavior:
- for the active server, show a full policy breakdown
- for inactive saved servers, show a compact per-server summary in the saved-server row model only if finite retention is known

Do not overload `SavedServersSection` with formatting logic. Extend the controller to fetch/cache the active server policy and map it into a small view model.

#### 2. Session info screen
Add a focused disclosure component:
- `apps/ui/sources/components/sessions/info/SessionRetentionNotice.tsx`

Render it from:
- `apps/ui/sources/app/(app)/session/[id]/info.tsx`

Behavior:
- when the session belongs to a server with finite session retention, show the session-specific summary
- include the exact inactivity rule from the server capability
- no disclosure if the server is unknown or keep-forever

#### 3. Reusable hook and formatter layer
Add:
- `apps/ui/sources/hooks/server/useServerRetentionPolicy.ts`
- `apps/ui/sources/sync/domains/server/retention/serverRetentionPolicy.ts`
- `apps/ui/sources/sync/domains/server/retention/formatServerRetentionPolicy.ts`

These should:
- read from server feature snapshots directly
- not misuse feature-gating helpers for a non-gate capability
- provide typed formatting helpers for section summaries and chips

### Translation keys
Add user-visible strings to all locales under `apps/ui/sources/text/translations/`.
Suggested new keys:
- `server.retention.title`
- `server.retention.keepForever`
- `server.retention.deleteInactiveSessionsDays`
- `server.retention.deleteOlderThanDays`
- `server.retention.sessions`
- `server.retention.accountChanges`
- `server.retention.voiceSessionLeases`
- `server.retention.feedItems`
- `server.retention.shareAccessLogs`
- `server.retention.authRequests`
- `server.retention.automationHistory`

## Testing Plan
This feature changes behavior. Implementation must follow strict TDD during execution.

### Test inventory before implementation
Before writing any new tests, review and extend the most relevant existing tests first:
- `apps/server/sources/app/api/routes/features/featuresRoutes.integration.spec.ts`
- `apps/ui/sources/sync/api/capabilities/serverFeaturesParse.spec.ts`
- `apps/ui/sources/components/settings/server/*`
- `packages/tests/src/testkit/process/serverLight.ts`

### Protocol unit tests
- `packages/protocol/src/features/payload/capabilities/serverRetentionCapabilities.test.ts`
- extend server capability schema tests if they already exist nearby

Assertions:
- valid keep-forever payload parses
- valid finite retention payload parses
- malformed payloads fail closed

### Server unit tests
- `apps/server/sources/app/retention/config/readRetentionPolicyFromEnv.test.ts`
- `apps/server/sources/app/retention/config/retentionPolicyToCapabilities.test.ts`
- `apps/server/sources/app/retention/runtime/retentionRuleRegistry.test.ts`

Assertions:
- defaults resolve to keep-forever
- invalid env combinations fail
- capability serialization is stable

### Server integration tests
- extend `apps/server/sources/app/api/routes/features/featuresRoutes.integration.spec.ts`
- `apps/server/sources/app/retention/rules/sessionRetentionRule.integration.spec.ts`
- `apps/server/sources/app/retention/rules/accountChangeRetentionRule.integration.spec.ts`
- `apps/server/sources/app/session/delete/deleteOwnedSession.integration.spec.ts`

Assertions:
- `/v1/features` returns retention capabilities
- inactive session deletion removes the full session tree
- recipient delete updates are emitted correctly
- `changesFloor` is bumped when aged account changes are pruned
- dry-run mode logs but does not delete

### UI unit/component tests
- extend `apps/ui/sources/sync/api/capabilities/serverFeaturesParse.spec.ts`
- `apps/ui/sources/hooks/server/useServerRetentionPolicy.test.ts`
- `apps/ui/sources/components/settings/server/sections/ServerRetentionSection.test.tsx`
- `apps/ui/sources/components/settings/server/sections/SavedServersSection.retention.test.tsx`
- `apps/ui/sources/components/sessions/info/SessionRetentionNotice.test.tsx`

Assertions:
- capability payload is parsed into typed UI data
- keep-forever stays quiet
- finite retention shows the right localized summary
- session info notice appears only when appropriate

### Core e2e tests
Add at least one new end-to-end suite under:
- `packages/tests/suites/core-e2e/server-retention.session-pruning.e2e.test.ts`

Flow:
- start server-light with finite session retention env
- create a session with transcript data
- backdate `Session.updatedAt` and `Session.lastActiveAt` through testkit/DB hook
- trigger the retention sweep
- verify:
  - session disappears from the session list/API
  - transcript rows are gone
  - deletion updates are propagated
  - a stale `changes` cursor gets `410` after floor advancement if account-change retention is exercised in the same or a sibling test

Add another e2e if needed for account-change retention:
- `packages/tests/suites/core-e2e/server-retention.account-changes.e2e.test.ts`

### UI e2e tests
Add Playwright coverage under:
- `packages/tests/suites/ui-e2e/server-retention.spec.ts`

Flow:
- connect to a server with finite retention
- open server settings and verify the retention section
- open a session info screen and verify the session retention disclosure

Use stable `testID`s for any new UI hooks.

## Rollout and Safety
### Operational safeguards
- dry-run mode
- bounded batch size
- bounded max deletions per rule per run
- per-rule logs with counts and cutoffs
- sentry monitor check-in around each sweep
- startup no-op when no finite policies are configured

### Deletion order and consistency
- rules that require cross-row semantics should process candidates individually in transactions
- simpler append-only tables can use `deleteMany` in bounded windows
- session retention should always re-check candidate eligibility inside the transaction before delete

### Multi-worker behavior
Use one distributed or DB-backed sweep lock so multiple worker replicas do not run the same sweep concurrently.
If a canonical locking helper already exists in server code, reuse it. Otherwise add a small retention-specific lock helper rather than scattering ad hoc lock rows across rule files.

## Implementation Sequence
1. Add protocol capability schema and tests.
2. Add server retention config parser and tests.
3. Add retention capability resolver and `/v1/features` integration tests.
4. Refactor session deletion into reusable focused modules with integration tests.
5. Implement retention runtime and rule registry.
6. Implement session retention rule first.
7. Implement account-change retention rule and migrate voice-lease cleanup into the registry.
8. Implement remaining append-only/log/history rules.
9. Add UI parsing, hooks, and formatting helpers.
10. Add server settings retention section.
11. Add session info disclosure.
12. Add core e2e tests.
13. Add UI e2e test.
14. Run full required test lanes and manual stack validation.

## Required Commands Before Handoff
Fast iteration during implementation:
- targeted Vitest/Jest lanes for the touched package

Before final handoff:
- `yarn test`
- `yarn test:integration`
- `yarn test:e2e:core:fast`
- targeted `yarn test:e2e:ui` for the new spec, or full lane if feasible
- relevant `typecheck` lanes for changed TypeScript packages

## Manual Stack Validation Runbook
Create and use a fresh stack pointed at this worktree:

```bash
hstack stack new retention-qa-0308 --repo=/Users/leeroy/Documents/Development/happier/dev --server=happier-server-light --non-interactive
hstack stack wt retention-qa-0308 -- use /Users/leeroy/Documents/Development/happier/dev
hstack stack env retention-qa-0308 set \
  HAPPIER_SERVER_RETENTION__ENABLED=true \
  HAPPIER_SERVER_RETENTION__INTERVAL_MS=30000 \
  HAPPIER_SERVER_RETENTION__BATCH_SIZE=20 \
  HAPPIER_SERVER_RETENTION__SESSIONS__MODE=delete_inactive \
  HAPPIER_SERVER_RETENTION__SESSIONS__INACTIVITY_DAYS=30 \
  HAPPIER_SERVER_RETENTION__ACCOUNT_CHANGES__MODE=delete_older_than \
  HAPPIER_SERVER_RETENTION__ACCOUNT_CHANGES__DAYS=30
hstack stack dev retention-qa-0308 -- --restart
hstack stack auth retention-qa-0308 status
hstack stack auth retention-qa-0308 login --no-open
hstack stack daemon retention-qa-0308 status
hstack stack daemon retention-qa-0308 start
```

Manual QA checklist after implementation:
- confirm `/v1/features` on the stack exposes `capabilities.server.retention`
- connect the UI to the stack and verify server settings show the active server retention section
- verify keep-forever servers stay quiet
- verify finite-retention servers show clear session deletion language
- create a session, confirm the session info screen shows the same policy context
- backdate a test session using the test harness or DB helper, wait for the sweep, and verify the UI reflects deletion cleanly
- verify no broken session list state, no stale transcript crash, and no misleading “session still exists” screen after deletion

## Final Recommendation
Implement retention as a unified server capability plus a unified cleanup worker, with session-tree deletion as the primary retention unit. Do not introduce transcript-fragment pruning, do not decrypt ciphertext for cleanup decisions, and do not create separate cleanup subsystems for each table. Reuse the existing session/account-change infrastructure, expose effective policy via `/v1/features`, and surface it quietly but clearly in server settings and session info.
