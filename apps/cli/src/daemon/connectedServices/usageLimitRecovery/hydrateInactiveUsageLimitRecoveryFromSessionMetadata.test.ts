import { describe, expect, it, vi } from 'vitest';

import { SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY } from '@happier-dev/protocol';

import { createSessionListResponseFixture, createSessionRecordFixture } from '@/testkit/backends/sessionFixtures';
import { hydrateInactiveUsageLimitRecoveryFromSessionMetadata } from './hydrateInactiveUsageLimitRecoveryFromSessionMetadata';

const credentials = {
  token: 'token',
  encryption: {
    type: 'legacy',
    secret: new Uint8Array(32),
  },
} as const;

describe('hydrateInactiveUsageLimitRecoveryFromSessionMetadata', () => {
  it('schedules inactive persisted recovery intents and rebuilds check-now runners', async () => {
    const recovery = {
      v: 1 as const,
      status: 'waiting' as const,
      issueFingerprint: 'limit',
      armedAtMs: 100,
      resetAtMs: 2_000,
      nextCheckAtMs: 2_000,
      attemptCount: 0,
      maxAttempts: 3,
      lastProbeError: null,
      selectedAuth: { kind: 'native' as const },
    };
    const schedule = vi.fn();
    const routeCheckNow = vi.fn(async () => ({ ok: true, status: 'ready' }));
    const fetchSessionsPage = vi.fn(async () => {
      const response = createSessionListResponseFixture([
        createSessionRecordFixture({
          id: 'session-1',
          active: false,
          metadata: 'ignored-by-test-decryptor',
          encryptionMode: 'plain',
        }),
      ]);
      return {
        sessions: response.sessions,
        nextCursor: response.nextCursor ?? null,
        hasNext: response.hasNext ?? false,
      };
    });

    const result = await hydrateInactiveUsageLimitRecoveryFromSessionMetadata({
      credentials,
      currentMachineId: 'machine-1',
      currentMachineHost: 'host.local',
      currentMachineHomeDir: '/Users/example',
      fetchSessionsPage,
      decryptMetadata: () => ({
        [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: recovery,
      }),
      schedule,
      routeCheckNow,
    });

    expect(result).toEqual({ scanned: 1, scheduled: 1 });
    expect(schedule).toHaveBeenCalledWith({
      sessionId: 'session-1',
      recovery: { ...recovery, resumePromptMode: 'standard' },
      runCheckNow: expect.any(Function),
    });

    const runCheckNow = schedule.mock.calls[0]?.[0]?.runCheckNow as (() => Promise<unknown>) | undefined;
    await expect(runCheckNow?.()).resolves.toEqual({ ok: true, status: 'ready' });
    expect(routeCheckNow).toHaveBeenCalledWith(expect.objectContaining({
      token: 'token',
      sessionId: 'session-1',
      currentMachineId: 'machine-1',
      currentMachineHost: 'host.local',
      currentMachineHomeDir: '/Users/example',
      rawSession: expect.objectContaining({ id: 'session-1' }),
      metadata: expect.objectContaining({
        [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: recovery,
      }),
      request: { sessionId: 'session-1' },
    }));
  });

  it('skips persisted pending intents whose latest turn is no longer failed', async () => {
    const recovery = {
      v: 1 as const,
      status: 'waiting' as const,
      issueFingerprint: 'limit',
      armedAtMs: 100,
      resetAtMs: 2_000,
      nextCheckAtMs: 2_000,
      attemptCount: 0,
      maxAttempts: 3,
      lastProbeError: null,
      selectedAuth: { kind: 'native' as const },
    };
    const schedule = vi.fn();
    const fetchSessionsPage = vi.fn(async () => {
      const response = createSessionListResponseFixture([
        createSessionRecordFixture({
          id: 'completed-session',
          active: false,
          metadata: 'completed',
          encryptionMode: 'plain',
          latestTurnStatus: 'completed',
        }),
        createSessionRecordFixture({
          id: 'failed-session',
          active: false,
          metadata: 'failed',
          encryptionMode: 'plain',
          latestTurnStatus: 'failed',
        }),
        createSessionRecordFixture({
          id: 'unknown-turn-session',
          active: false,
          metadata: 'unknown',
          encryptionMode: 'plain',
        }),
      ]);
      return {
        sessions: response.sessions,
        nextCursor: response.nextCursor ?? null,
        hasNext: response.hasNext ?? false,
      };
    });

    const result = await hydrateInactiveUsageLimitRecoveryFromSessionMetadata({
      credentials,
      currentMachineId: 'machine-1',
      currentMachineHost: 'host.local',
      currentMachineHomeDir: '/Users/example',
      fetchSessionsPage,
      decryptMetadata: () => ({
        [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: recovery,
      }),
      schedule,
      routeCheckNow: vi.fn(),
    });

    expect(result).toEqual({ scanned: 3, scheduled: 2 });
    const scheduledSessionIds = schedule.mock.calls.map((call) => call[0]?.sessionId);
    expect(scheduledSessionIds).toEqual(['failed-session', 'unknown-turn-session']);
  });

  it('skips active sessions and terminal recovery intents', async () => {
    const schedule = vi.fn();
    const fetchSessionsPage = vi.fn(async () => {
      const response = createSessionListResponseFixture([
        createSessionRecordFixture({ id: 'active-session', active: true, metadata: 'active', encryptionMode: 'plain' }),
        createSessionRecordFixture({ id: 'cancelled-session', active: false, metadata: 'cancelled', encryptionMode: 'plain' }),
      ]);
      return {
        sessions: response.sessions,
        nextCursor: response.nextCursor ?? null,
        hasNext: response.hasNext ?? false,
      };
    });

    const result = await hydrateInactiveUsageLimitRecoveryFromSessionMetadata({
      credentials,
      currentMachineId: 'machine-1',
      currentMachineHost: 'host.local',
      currentMachineHomeDir: '/Users/example',
      fetchSessionsPage,
      decryptMetadata: ({ rawSession }) => ({
        [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: {
          v: 1,
          status: rawSession.active ? 'waiting' : 'cancelled',
          issueFingerprint: 'limit',
          armedAtMs: 100,
          resetAtMs: 2_000,
          nextCheckAtMs: 2_000,
          attemptCount: 0,
          maxAttempts: 3,
          lastProbeError: null,
          selectedAuth: { kind: 'native' },
        },
      }),
      schedule,
      routeCheckNow: vi.fn(),
    });

    expect(result).toEqual({ scanned: 2, scheduled: 0 });
    expect(schedule).not.toHaveBeenCalled();
  });
});
