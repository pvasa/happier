import { describe, expect, it } from 'vitest';

import { AccountExhaustionSuppression } from '@/daemon/connectedServices/usageLimitRecovery/accountExhaustionSuppression';

import { resolveCodexUsageLimitSuppressionWait } from './resolveCodexUsageLimitSuppressionWait';

describe('resolveCodexUsageLimitSuppressionWait', () => {
  it('suppresses a sibling session on a known-exhausted account (waits until reset, no re-probe)', () => {
    let nowMs = 1_000;
    const suppression = new AccountExhaustionSuppression({ nowMs: () => nowMs });
    // The first session recorded the account as exhausted until 5_000.
    suppression.markExhausted({ serviceId: 'openai-codex', accountId: 'work', resetAtMs: 5_000 });

    const decision = resolveCodexUsageLimitSuppressionWait({
      suppression,
      serviceId: 'openai-codex',
      accountId: 'work',
      resetAtMs: 5_000,
      nowMs,
    });

    expect(decision).toEqual({ kind: 'wait_until_reset', nextCheckAtMs: 5_000 });
  });

  it('proceeds when the account is not suppressed', () => {
    const suppression = new AccountExhaustionSuppression({ nowMs: () => 1_000 });
    const decision = resolveCodexUsageLimitSuppressionWait({
      suppression,
      serviceId: 'openai-codex',
      accountId: 'work',
      resetAtMs: 5_000,
      nowMs: 1_000,
    });
    expect(decision).toEqual({ kind: 'proceed' });
  });

  it('proceeds once the suppression window has elapsed', () => {
    let nowMs = 1_000;
    const suppression = new AccountExhaustionSuppression({ nowMs: () => nowMs });
    suppression.markExhausted({ serviceId: 'openai-codex', accountId: 'work', resetAtMs: 5_000 });
    nowMs = 5_001;
    const decision = resolveCodexUsageLimitSuppressionWait({
      suppression,
      serviceId: 'openai-codex',
      accountId: 'work',
      resetAtMs: 5_000,
      nowMs,
    });
    expect(decision).toEqual({ kind: 'proceed' });
  });

  it('proceeds for a genuinely newer reset bucket (distinct exhaustion window)', () => {
    const suppression = new AccountExhaustionSuppression({ nowMs: () => 1_000 });
    suppression.markExhausted({ serviceId: 'openai-codex', accountId: 'work', resetAtMs: 5_000 });
    const decision = resolveCodexUsageLimitSuppressionWait({
      suppression,
      serviceId: 'openai-codex',
      accountId: 'work',
      resetAtMs: 10_000,
      nowMs: 1_000,
    });
    expect(decision).toEqual({ kind: 'proceed' });
  });

  it('proceeds for native sign-in with no account id (cannot key cross-session)', () => {
    const suppression = new AccountExhaustionSuppression({ nowMs: () => 1_000 });
    suppression.markExhausted({ serviceId: 'openai-codex', accountId: 'work', resetAtMs: 5_000 });
    const decision = resolveCodexUsageLimitSuppressionWait({
      suppression,
      serviceId: 'openai-codex',
      accountId: null,
      resetAtMs: 5_000,
      nowMs: 1_000,
    });
    expect(decision).toEqual({ kind: 'proceed' });
  });

  it('falls back to the window expiry when no provider reset time was recorded', () => {
    let nowMs = 1_000;
    const suppression = new AccountExhaustionSuppression({ nowMs: () => nowMs, defaultWindowMs: 2_000 });
    suppression.markExhausted({ serviceId: 'openai-codex', accountId: 'work', resetAtMs: null });

    const decision = resolveCodexUsageLimitSuppressionWait({
      suppression,
      serviceId: 'openai-codex',
      accountId: 'work',
      resetAtMs: null,
      nowMs,
    });
    expect(decision).toEqual({ kind: 'wait_until_reset', nextCheckAtMs: 3_000 });
  });
});
