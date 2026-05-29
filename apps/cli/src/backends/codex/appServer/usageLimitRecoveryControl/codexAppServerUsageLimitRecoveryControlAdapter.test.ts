import {
  SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY,
  type SessionUsageLimitRecoveryV1,
} from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionUsageLimitRecoveryControlAdapterParams } from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryControlTypes';
import type { CodexAppServerClient } from '../client/createCodexAppServerClient';
import { createCodexAppServerUsageLimitRecoveryControlAdapter } from './codexAppServerUsageLimitRecoveryControlAdapter';

type RunWithControlClient = NonNullable<Parameters<typeof createCodexAppServerUsageLimitRecoveryControlAdapter>[0]>['runWithControlClient'];
type RunWithControlClientParams = Parameters<NonNullable<RunWithControlClient>>[0];

function createClient(request: CodexAppServerClient['request']): CodexAppServerClient {
  return {
    request,
    notify: async () => {},
    registerRequestHandler: () => () => {},
    registerNotificationHandler: () => () => {},
  };
}

function createParams(
  metadata: Record<string, unknown>,
  rawSessionOverrides: Partial<SessionUsageLimitRecoveryControlAdapterParams['rawSession']> = {},
): SessionUsageLimitRecoveryControlAdapterParams {
  return {
    token: 'token',
    sessionId: 'sess_1',
    rawSession: {
      id: 'sess_1',
      seq: 1,
      createdAt: 1,
      updatedAt: 1,
      active: false,
      activeAt: 1,
      path: '/repo',
      machineId: 'machine-local',
      metadata: '{}',
      metadataVersion: 1,
      agentState: null,
      agentStateVersion: 1,
      dataEncryptionKey: null,
      ...rawSessionOverrides,
    },
    metadata,
    currentMachineId: 'machine-local',
    sessionMachineId: 'machine-local',
    cwd: '/repo',
    ctx: {
      encryptionKey: new Uint8Array(32).fill(1),
      encryptionVariant: 'legacy' as const,
    },
    mode: 'plain' as const,
  };
}

describe('codexAppServerUsageLimitRecoveryControlAdapter', () => {
  it('probes Codex rate limits with a temporary app-server control client and marks ready when lifted', async () => {
    const controlClientCalls: RunWithControlClientParams[] = [];
    const runWithControlClient: RunWithControlClient = async (params) => {
      controlClientCalls.push(params);
      return {
        ok: true,
        value: await params.run(createClient(async (method) => {
        expect(method).toBe('account/rateLimits/read');
        return { primary: { used_percent: 42 } };
        })),
      };
    };
    const adapter = createCodexAppServerUsageLimitRecoveryControlAdapter({ runWithControlClient });
    const metadata = {
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: { backendMode: 'appServer', vendorSessionId: 'thread-1' },
      },
      sessionUsageLimitRecoveryV1: {
        v: 1,
        status: 'waiting',
        issueFingerprint: 'usage-limit:sess_1:reset',
        armedAtMs: 1,
        resetAtMs: 2,
        nextCheckAtMs: 2,
        attemptCount: 0,
        maxAttempts: 3,
        lastProbeError: null,
        selectedAuth: { kind: 'native', serviceId: 'openai-codex' },
      },
    };

    await expect(adapter.checkNow?.(createParams(metadata))).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'cancelled',
          attemptCount: 1,
        },
      },
    });
    expect(controlClientCalls[0]).toEqual(expect.objectContaining({
      cwd: '/repo',
      metadata,
    }));
  });

  it('arms a check from the latest failed usage-limit issue when no persisted intent exists', async () => {
    const runWithControlClient: RunWithControlClient = async (params) => ({
      ok: true,
      value: await params.run(createClient(async () => ({ primary: { used_percent: 42 } }))),
    });
    const adapter = createCodexAppServerUsageLimitRecoveryControlAdapter({ runWithControlClient });
    const metadata = {
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: { backendMode: 'appServer', vendorSessionId: 'thread-1' },
      },
    };

    await expect(adapter.checkNow?.(createParams(metadata, {
      latestTurnStatus: 'failed',
      lastRuntimeIssue: {
        v: 1,
        scope: 'primary_session',
        status: 'failed',
        code: 'usage_limit',
        source: 'usage_limit',
        provider: 'codex',
        providerTurnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        usageLimit: {
          v: 1,
          resetAtMs: 1_700_000_060_000,
          retryAfterMs: null,
          quotaScope: 'account',
          recoverability: 'wait',
        },
      },
    }))).resolves.toMatchObject({
      ok: true,
      status: 'ready',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'cancelled',
          issueFingerprint: 'usage-limit:codex:turn-1:1700000000000:1700000060000',
          selectedAuth: { kind: 'native', serviceId: 'openai-codex' },
        },
      },
    });
  });

  it('keeps waiting and records the reset time when Codex still reports exhaustion', async () => {
    const runWithControlClient: RunWithControlClient = async (params) => ({
      ok: true,
      value: await params.run(createClient(async () => ({
        rateLimits: {
          planType: 'pro',
          primary: { usedPercent: 100, resetsAt: 1_779_098_400 },
        },
        rateLimitsByLimitId: null,
      }))),
    });
    const adapter = createCodexAppServerUsageLimitRecoveryControlAdapter({ runWithControlClient });
    const metadata = {
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: { backendMode: 'appServer', vendorSessionId: 'thread-1' },
      },
      sessionUsageLimitRecoveryV1: {
        v: 1,
        status: 'waiting',
        issueFingerprint: 'usage-limit:sess_1:reset',
        armedAtMs: 1,
        resetAtMs: null,
        nextCheckAtMs: null,
        attemptCount: 0,
        maxAttempts: 3,
        lastProbeError: null,
        selectedAuth: { kind: 'native', serviceId: 'openai-codex' },
      },
    };

    await expect(adapter.checkNow?.(createParams(metadata))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'waiting',
          attemptCount: 1,
          nextCheckAtMs: Date.parse('2026-05-18T10:00:00.000Z'),
        },
      },
    });
  });

  it('exhausts stale Codex app-server recovery intents instead of probing after max attempts', async () => {
    const controlClientCalls: RunWithControlClientParams[] = [];
    const runWithControlClient: RunWithControlClient = async (params) => {
      controlClientCalls.push(params);
      return {
        ok: true,
        value: await params.run(createClient(async () => ({
          rateLimits: {
            planType: 'pro',
            primary: { usedPercent: 100, resetsAt: 1_779_098_400 },
          },
          rateLimitsByLimitId: null,
        }))),
      };
    };
    const intent: SessionUsageLimitRecoveryV1 = {
      v: 1,
      status: 'waiting',
      issueFingerprint: 'usage-limit:sess_1:reset',
      armedAtMs: 1,
      resetAtMs: null,
      nextCheckAtMs: null,
      attemptCount: 1,
      maxAttempts: 1,
      lastProbeError: null,
      selectedAuth: { kind: 'native', serviceId: 'openai-codex' },
    };
    const adapter = createCodexAppServerUsageLimitRecoveryControlAdapter({ runWithControlClient });

    await expect(adapter.checkNow?.(createParams({
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: { backendMode: 'appServer', vendorSessionId: 'thread-1' },
      },
      [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: intent,
    }))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'exhausted',
          attemptCount: 2,
          lastProbeError: 'usage_limit_recovery_max_attempts_exhausted',
        },
      },
    });
    expect(controlClientCalls).toEqual([]);
  });

  it('keeps retry-after-derived check timing when Codex remains exhausted without a reset timestamp', async () => {
    const runWithControlClient: RunWithControlClient = async (params) => ({
      ok: true,
      value: await params.run(createClient(async () => ({
        primary: { usedPercent: 100 },
      }))),
    });
    const adapter = createCodexAppServerUsageLimitRecoveryControlAdapter({ runWithControlClient });
    const metadata = {
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: { backendMode: 'appServer', vendorSessionId: 'thread-1' },
      },
    };

    await expect(adapter.checkNow?.(createParams(metadata, {
      latestTurnStatus: 'failed',
      lastRuntimeIssue: {
        v: 1,
        scope: 'primary_session',
        status: 'failed',
        code: 'usage_limit',
        source: 'usage_limit',
        provider: 'codex',
        providerTurnId: 'turn-1',
        occurredAt: 1_700_000_000_000,
        usageLimit: {
          v: 1,
          resetAtMs: null,
          retryAfterMs: 120_000,
          quotaScope: 'account',
          recoverability: 'wait',
        },
      },
    }))).resolves.toMatchObject({
      ok: true,
      status: 'waiting',
      metadata: {
        sessionUsageLimitRecoveryV1: {
          status: 'waiting',
          resetAtMs: null,
          nextCheckAtMs: 1_700_000_120_000,
        },
      },
    });
  });

  it('returns stable unsupported for non-app-server Codex check-now without probing rate limits', async () => {
    const runWithControlClient: RunWithControlClient = async (params) => ({
      ok: true,
      value: await params.run(createClient(async () => {
        throw new Error('must not probe non-app-server mode');
      })),
    });
    const adapter = createCodexAppServerUsageLimitRecoveryControlAdapter({ runWithControlClient });
    const metadata = {
      machineId: 'machine-local',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'codex',
        provider: { backendMode: 'mcp', vendorSessionId: 'thread-1' },
      },
      sessionUsageLimitRecoveryV1: {
        v: 1,
        status: 'waiting',
        issueFingerprint: 'usage-limit:sess_1:reset',
        armedAtMs: 1,
        resetAtMs: 2,
        nextCheckAtMs: 2,
        attemptCount: 0,
        maxAttempts: 3,
        lastProbeError: null,
        selectedAuth: { kind: 'native', serviceId: 'openai-codex' },
      },
    };

    await expect(adapter.checkNow?.(createParams(metadata))).resolves.toEqual({
      ok: false,
      errorCode: 'codex_quota_probe_unsupported_for_backend_mode',
      error: 'codex_quota_probe_unsupported_for_backend_mode',
    });
  });
});
