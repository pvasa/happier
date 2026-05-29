import { describe, expect, it, vi } from 'vitest';

import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '../accountGroups/quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';
import { recordConnectedServiceRuntimeQuotaSnapshotForSession } from './recordConnectedServiceRuntimeQuotaSnapshotForSession';

describe('recordConnectedServiceRuntimeQuotaSnapshotForSession', () => {
  it('records group session snapshots into connected quota persistence and candidate runtime state', async () => {
    const quotaCoordinator = {
      recordInBandQuotaSnapshot: vi.fn(async () => ({ status: 'persisted' as const })),
    };
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const snapshot = {
      v: 1 as const,
      serviceId: 'openai-codex' as const,
      profileId: 'primary',
      fetchedAt: 1_000,
      staleAfterMs: 300_000,
      planLabel: 'pro',
      accountLabel: null,
      meters: [
        {
          meterId: 'primary',
          label: 'Primary',
          used: null,
          limit: null,
          unit: 'unknown' as const,
          utilizationPct: 99,
          resetsAt: null,
          status: 'ok' as const,
          details: {},
        },
      ],
    };

    await expect(recordConnectedServiceRuntimeQuotaSnapshotForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      quotaCoordinator,
      runtimeQuotaSnapshots,
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot,
    })).resolves.toEqual({ status: 'recorded', groupRuntimeStateRecorded: true, quotaStateRecorded: true });

    expect(quotaCoordinator.recordInBandQuotaSnapshot).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'primary',
      snapshot,
    });
    expect(runtimeQuotaSnapshots.buildMemberStates({
      serviceId: 'openai-codex',
      groupId: 'main',
      capturedAtMs: 1_000,
    }).get('primary')?.quotaSnapshot).toMatchObject({
      effectiveMeterId: 'primary',
      effectiveRemainingPercent: 1,
    });
  });

  it('records group runtime state before durable quota persistence completes', async () => {
    let releasePersistence: () => void = () => {};
    const quotaCoordinator = {
      recordInBandQuotaSnapshot: vi.fn(async () => {
        await new Promise<void>((resolve) => {
          releasePersistence = resolve;
        });
        return { status: 'persisted' as const };
      }),
    };
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const snapshot = {
      v: 1 as const,
      serviceId: 'openai-codex' as const,
      profileId: 'primary',
      fetchedAt: 1_000,
      staleAfterMs: 300_000,
      planLabel: null,
      accountLabel: null,
      meters: [
        {
          meterId: 'primary',
          label: 'Primary',
          used: null,
          limit: null,
          unit: 'unknown' as const,
          utilizationPct: 50,
          remainingPct: 50,
          resetsAt: null,
          status: 'ok' as const,
          details: {},
        },
      ],
    };

    const promise = recordConnectedServiceRuntimeQuotaSnapshotForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      quotaCoordinator,
      runtimeQuotaSnapshots,
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot,
    });

    await Promise.resolve();
    expect(runtimeQuotaSnapshots.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'primary',
    })).toBe(snapshot);

    releasePersistence();
    await expect(promise).resolves.toEqual({ status: 'recorded', groupRuntimeStateRecorded: true, quotaStateRecorded: true });
  });

  it('keeps runtime state when durable quota persistence fails', async () => {
    const quotaCoordinator = {
      recordInBandQuotaSnapshot: vi.fn(async () => {
        throw new Error('server write failed');
      }),
    };
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const snapshot = {
      v: 1 as const,
      serviceId: 'openai-codex' as const,
      profileId: 'primary',
      fetchedAt: 1_000,
      staleAfterMs: 300_000,
      planLabel: null,
      accountLabel: null,
      meters: [],
    };

    await expect(recordConnectedServiceRuntimeQuotaSnapshotForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      quotaCoordinator,
      runtimeQuotaSnapshots,
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot,
    })).resolves.toEqual({ status: 'recorded', groupRuntimeStateRecorded: true, quotaStateRecorded: false });

    expect(runtimeQuotaSnapshots.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'primary',
    })).toBe(snapshot);
  });

  it('reports quota state as not recorded when durable quota persistence is deferred', async () => {
    const quotaCoordinator = {
      recordInBandQuotaSnapshot: vi.fn(async () => ({ status: 'deferred_unknown_mode' as const })),
    };
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const snapshot = {
      v: 1 as const,
      serviceId: 'openai-codex' as const,
      profileId: 'primary',
      fetchedAt: 1_000,
      staleAfterMs: 300_000,
      planLabel: null,
      accountLabel: null,
      meters: [],
    };

    await expect(recordConnectedServiceRuntimeQuotaSnapshotForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      quotaCoordinator,
      runtimeQuotaSnapshots,
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot,
    })).resolves.toEqual({ status: 'recorded', groupRuntimeStateRecorded: true, quotaStateRecorded: false });

    expect(runtimeQuotaSnapshots.getSnapshot({
      serviceId: 'openai-codex',
      groupId: 'main',
      profileId: 'primary',
    })).toBe(snapshot);
  });

  it('reports quota state as recorded when durable quota persistence is queued', async () => {
    const quotaCoordinator = {
      recordInBandQuotaSnapshot: vi.fn(async () => ({ status: 'enqueued' as const, enqueue: 'accepted' as const })),
    };
    const runtimeQuotaSnapshots = new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore();
    const snapshot = {
      v: 1 as const,
      serviceId: 'openai-codex' as const,
      profileId: 'primary',
      fetchedAt: 1_000,
      staleAfterMs: 300_000,
      planLabel: null,
      accountLabel: null,
      meters: [],
    };

    await expect(recordConnectedServiceRuntimeQuotaSnapshotForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'connected',
                selection: 'group',
                profileId: 'primary',
                groupId: 'main',
              },
            },
          },
        },
      }],
      quotaCoordinator,
      runtimeQuotaSnapshots,
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot,
    })).resolves.toEqual({ status: 'recorded', groupRuntimeStateRecorded: true, quotaStateRecorded: true });
  });

  it('ignores native selections because they have no connected profile quota owner', async () => {
    const quotaCoordinator = {
      recordInBandQuotaSnapshot: vi.fn(async () => ({ status: 'persisted' as const })),
    };

    await expect(recordConnectedServiceRuntimeQuotaSnapshotForSession({
      getChildren: () => [{
        startedBy: 'daemon',
        happySessionId: 'sess_1',
        pid: 123,
        spawnOptions: {
          directory: '/tmp/project',
          connectedServices: {
            v: 1,
            bindingsByServiceId: {
              'openai-codex': {
                source: 'native',
              },
            },
          },
        },
      }],
      quotaCoordinator,
      runtimeQuotaSnapshots: new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore(),
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot: {
        v: 1,
        serviceId: 'openai-codex',
        profileId: 'primary',
        fetchedAt: 1_000,
        staleAfterMs: 300_000,
        planLabel: null,
        accountLabel: null,
        meters: [],
      },
    })).resolves.toEqual({ status: 'not_connected_selection' });

    expect(quotaCoordinator.recordInBandQuotaSnapshot).not.toHaveBeenCalled();
  });
});
