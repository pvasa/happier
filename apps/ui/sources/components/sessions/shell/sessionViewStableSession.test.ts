import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import type { Session } from '@/sync/domains/state/storageTypes';
import { storage } from '@/sync/domains/state/storageStore';

import { buildSessionViewShellSessionSignature, useSessionViewShellSession, useSessionViewShellSessionSeq } from './sessionViewStableSession';

function createSession(overrides: Partial<Session> = {}): Session {
    return {
        id: 's1',
        seq: 25,
        createdAt: 1,
        updatedAt: 100,
        active: true,
        activeAt: 100,
        thinking: true,
        thinkingAt: 100,
        presence: 'online',
        accessLevel: 'edit',
        canApprovePermissions: true,
        pendingVersion: 1,
        metadataVersion: 1,
        agentStateVersion: 1,
        latestUsage: {
            inputTokens: 1,
            outputTokens: 2,
        },
        metadata: {
            name: 'Session',
            path: '/repo',
            homeDir: '/Users/leeroy',
            host: 'mac',
            machineId: 'machine-1',
            flavor: 'codex',
            version: '0.0.0',
        },
        agentState: {},
        ...overrides,
    } as Session;
}

afterEach(() => {
    standardCleanup();
});

describe('buildSessionViewShellSessionSignature', () => {
    it('stays stable for timestamp-only session heartbeats', () => {
        const base = createSession();
        const heartbeat = createSession({
            updatedAt: 200,
            activeAt: 200,
            thinkingAt: 200,
            latestTurnStatusObservedAt: 200,
            latestUsage: {
                inputTokens: 2,
                outputTokens: 4,
                cacheCreation: 0,
                cacheRead: 0,
                contextSize: 8,
                timestamp: 200,
            },
        });

        expect(buildSessionViewShellSessionSignature(heartbeat)).toBe(buildSessionViewShellSessionSignature(base));
    });

    it('stays stable for transcript seq-only streaming updates after transcript history exists', () => {
        const base = createSession({ seq: 25 });
        const nextToken = createSession({ seq: 26 });

        expect(buildSessionViewShellSessionSignature(nextToken)).toBe(buildSessionViewShellSessionSignature(base));
    });

    it('changes when the session first gains transcript history', () => {
        const empty = createSession({ seq: 0 });
        const firstRecord = createSession({ seq: 1 });

        expect(buildSessionViewShellSessionSignature(firstRecord)).not.toBe(
            buildSessionViewShellSessionSignature(empty),
        );
    });

    it('changes when pending request details hydrate at the same agent state version', () => {
        const projectedOnly = createSession({
            agentState: null,
            agentStateVersion: 6,
            pendingPermissionRequestCount: 1,
        });
        const hydrated = createSession({
            agentStateVersion: 6,
            pendingPermissionRequestCount: 1,
            agentState: {
                requests: {
                    req_1: {
                        tool: 'Bash',
                        kind: 'permission',
                        arguments: { command: 'pwd' },
                        createdAt: 10,
                    },
                },
            },
        });

        expect(buildSessionViewShellSessionSignature(hydrated)).not.toBe(
            buildSessionViewShellSessionSignature(projectedOnly),
        );
    });

    it('stays stable for pending request notification-only updates', () => {
        const base = createSession({
            agentStateVersion: 6,
            pendingPermissionRequestCount: 1,
            agentState: {
                requests: {
                    req_1: {
                        tool: 'Bash',
                        kind: 'permission',
                        arguments: { command: 'pwd' },
                        createdAt: 10,
                    },
                },
            },
        });
        const notified = createSession({
            agentStateVersion: 6,
            pendingPermissionRequestCount: 1,
            agentState: {
                requests: {
                    req_1: {
                        tool: 'Bash',
                        kind: 'permission',
                        arguments: { command: 'pwd' },
                        createdAt: 10,
                        pushNotifiedAt: 20,
                    },
                },
            },
        });

        expect(buildSessionViewShellSessionSignature(notified)).toBe(
            buildSessionViewShellSessionSignature(base),
        );
    });

    it('stays stable for read-cursor-only updates while viewing the session', () => {
        const base = createSession({
            lastViewedSessionSeq: 25,
            metadata: {
                name: 'Session',
                path: '/repo',
                homeDir: '/Users/leeroy',
                host: 'mac',
                machineId: 'machine-1',
                flavor: 'codex',
                version: '0.0.0',
                readStateV1: {
                    v: 1,
                    sessionSeq: 25,
                    pendingActivityAt: 0,
                    updatedAt: 100,
                },
            },
        });
        const readCursorHeartbeat = createSession({
            lastViewedSessionSeq: 26,
            metadataVersion: 2,
            metadata: {
                name: 'Session',
                path: '/repo',
                homeDir: '/Users/leeroy',
                host: 'mac',
                machineId: 'machine-1',
                flavor: 'codex',
                version: '0.0.0',
                readStateV1: {
                    v: 1,
                    sessionSeq: 26,
                    pendingActivityAt: 0,
                    updatedAt: 200,
                },
            },
        });

        expect(buildSessionViewShellSessionSignature(readCursorHeartbeat)).toBe(
            buildSessionViewShellSessionSignature(base),
        );
    });

    it('changes when shell-visible session data changes', () => {
        const base = createSession();
        const renamed = createSession({
            metadata: {
                ...base.metadata,
                path: base.metadata?.path ?? '/repo',
                host: base.metadata?.host ?? 'mac',
                name: 'Renamed',
            },
        });

        expect(buildSessionViewShellSessionSignature(renamed)).not.toBe(buildSessionViewShellSessionSignature(base));
    });
});

describe('useSessionViewShellSession', () => {
    it('keeps the shell session reference stable for heartbeat and seq-only updates', async () => {
        const previousState = storage.getState();
        try {
            storage.setState((state) => ({
                ...state,
                sessions: {
                    ...state.sessions,
                    s1: createSession({
                        seq: 25,
                        updatedAt: 100,
                        activeAt: 100,
                        thinkingAt: 100,
                        latestTurnStatusObservedAt: 100,
                    }),
                },
            }));

            const shellHook = await renderHook(() => useSessionViewShellSession('s1'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const seqHook = await renderHook(() => useSessionViewShellSessionSeq('s1'), {
                flushOptions: { cycles: 1, turns: 4 },
            });
            const firstShellSession = shellHook.getCurrent();

            await act(async () => {
                storage.setState((state) => ({
                    ...state,
                    sessions: {
                        ...state.sessions,
                        s1: createSession({
                            seq: 26,
                            updatedAt: 200,
                            activeAt: 200,
                            thinkingAt: 200,
                            latestTurnStatusObservedAt: 200,
                        }),
                    },
                }));
            });

            expect(shellHook.getCurrent()).toBe(firstShellSession);
            expect(seqHook.getCurrent()).toBe(26);

            await shellHook.unmount();
            await seqHook.unmount();
        } finally {
            storage.setState(previousState);
        }
    });
});
