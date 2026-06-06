/**
 * Anti-storm consumption of account-level exhaustion suppression for Codex usage-limit recovery.
 *
 * When one session marks a connected-service account as quota-exhausted-until-reset
 * (`AccountExhaustionSuppression.markExhausted`, recorded in the recover loop), every sibling
 * session bound to the SAME account would otherwise independently re-probe rate limits and
 * request a redundant group switch/restart against an account that cannot recover until its
 * provider reset time. That is the per-account storm the suppression store exists to prevent —
 * but the store was previously write-only (never consulted).
 *
 * This helper is the read side: BEFORE a sibling recover tick probes rate limits / requests
 * group recovery, it asks the suppression store whether the currently-selected account is
 * known-exhausted for its reset bucket. If so, it short-circuits to a wait until that bucket
 * elapses (never an immediate retry). A genuinely newer reset bucket is treated as a distinct
 * window by the store and is NOT suppressed, so this cannot wedge a recovered account.
 *
 * Codex-specific (lives under backends/codex/**); the suppression store itself stays
 * provider-agnostic.
 */

import type { AccountExhaustionSuppression } from '@/daemon/connectedServices/usageLimitRecovery/accountExhaustionSuppression';

export type CodexUsageLimitSuppressionDecision =
  | Readonly<{ kind: 'proceed' }>
  | Readonly<{ kind: 'wait_until_reset'; nextCheckAtMs: number }>;

function normalizeAccountId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function resolveCodexUsageLimitSuppressionWait(input: Readonly<{
  suppression: Pick<AccountExhaustionSuppression, 'getActiveSuppression'>;
  serviceId: string;
  /** The currently-selected connected-service account/profile for this session, when known. */
  accountId: string | null | undefined;
  /** The reset bucket the recover tick is currently considering, when known. */
  resetAtMs: number | null;
  nowMs: number;
}>): CodexUsageLimitSuppressionDecision {
  const accountId = normalizeAccountId(input.accountId);
  // Native sign-in (no profile id) cannot be keyed for cross-session suppression; proceed.
  if (!accountId) return { kind: 'proceed' };

  const active = input.suppression.getActiveSuppression({
    serviceId: input.serviceId,
    accountId,
    resetAtMs: input.resetAtMs,
  });
  if (!active) return { kind: 'proceed' };

  // Wait until the recorded reset bucket (or the window expiry when no provider reset was known).
  // Never an immediate retry: the account is known-exhausted, so re-probing now is pure churn.
  const nextCheckAtMs = active.resetAtMs ?? active.expiresAtMs;
  return { kind: 'wait_until_reset', nextCheckAtMs };
}
