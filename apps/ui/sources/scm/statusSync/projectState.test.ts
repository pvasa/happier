import { describe, expect, it, vi } from 'vitest';

import type { ScmWorkingSnapshot } from '@/sync/domains/state/storageTypes';

import { EMPTY_SCM_CAPABILITIES } from '../core/snapshotMappers';
import { buildSnapshotSignature, getRepoScopeSessionIds } from './projectState';

const getStateMock = vi.hoisted(() => vi.fn());

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
    storage: {
    getState: getStateMock,
  },
});
});

function snapshot(defaultBranch?: string | null): ScmWorkingSnapshot {
    return {
        projectKey: 'machine:/repo',
        fetchedAt: 1,
        repo: {
            isRepo: true,
            rootPath: '/repo',
            backendId: 'git',
            mode: '.git',
            ...(defaultBranch === undefined ? {} : { defaultBranch }),
        },
        capabilities: EMPTY_SCM_CAPABILITIES,
        branch: {
            head: 'feature/update',
            upstream: null,
            ahead: 0,
            behind: 0,
            detached: false,
        },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
    };
}

describe('buildSnapshotSignature', () => {
  it('changes when the repository default branch is detected later', () => {
    expect(buildSnapshotSignature(snapshot())).not.toBe(
      buildSnapshotSignature(snapshot('release/2026')),
    );
  });
});

describe('getRepoScopeSessionIds', () => {
  it('groups repo sessions by host scope when machineId is missing', () => {
    getStateMock.mockReturnValue({
      sessions: {
        s1: { id: 's1', metadata: { host: 'devbox', path: '/repo' } },
        s2: { id: 's2', metadata: { host: 'devbox', path: '/repo/apps/ui' } },
        s3: { id: 's3', metadata: { host: 'other', path: '/repo/apps/ui' } },
        s4: { id: 's4', metadata: { machineId: 'machine-a', path: '/repo/apps/ui' } },
      },
    });

    const scoped = getRepoScopeSessionIds('s1', '/repo').sort();
    expect(scoped).toEqual(['s1', 's2']);
  });

  it('groups direct-session repo scopes by the linked direct machine id', () => {
    getStateMock.mockReturnValue({
      sessions: {
        s1: {
          id: 's1',
          metadata: {
            path: '/repo',
            directSessionV1: {
              v: 1,
              providerId: 'codex',
              machineId: 'm-direct',
              remoteSessionId: 'remote-1',
              source: { kind: 'codexHome', home: 'user' },
            },
          },
        },
        s2: {
          id: 's2',
          metadata: {
            path: '/repo/apps/ui',
            directSessionV1: {
              v: 1,
              providerId: 'codex',
              machineId: 'm-direct',
              remoteSessionId: 'remote-2',
              source: { kind: 'codexHome', home: 'user' },
            },
          },
        },
        s3: {
          id: 's3',
          metadata: {
            path: '/repo/apps/server',
            directSessionV1: {
              v: 1,
              providerId: 'codex',
              machineId: 'm-other',
              remoteSessionId: 'remote-3',
              source: { kind: 'codexHome', home: 'user' },
            },
          },
        },
      },
    });

    const scoped = getRepoScopeSessionIds('s1', '/repo').sort();
    expect(scoped).toEqual(['s1', 's2']);
  });

  it('returns only the reference session when scope is unknown', () => {
    getStateMock.mockReturnValue({
      sessions: {
        s1: { id: 's1', metadata: { path: '/repo' } },
        s2: { id: 's2', metadata: { host: '', path: '/repo/apps/ui' } },
      },
    });

    expect(getRepoScopeSessionIds('s1', '/repo')).toEqual(['s1']);
  });

  it('includes sessions using project workspace fallback when metadata path is missing', () => {
    getStateMock.mockReturnValue({
      sessions: {
        s1: { id: 's1', metadata: { machineId: 'machine-a', path: null } },
        s2: { id: 's2', metadata: { machineId: 'machine-a', path: '/repo/apps/ui' } },
        s3: { id: 's3', metadata: { machineId: 'machine-b', path: '/repo/apps/server' } },
      },
      getProjectForSession: (sessionId: string) => {
        if (sessionId === 's1') {
          return { key: { machineId: 'machine-a', path: '/repo' } };
        }
        if (sessionId === 's2') {
          return { key: { machineId: 'machine-a', path: '/repo/apps/ui' } };
        }
        return null;
      },
    });

    const scoped = getRepoScopeSessionIds('s1', '/repo').sort();
    expect(scoped).toEqual(['s1', 's2']);
  });
});
