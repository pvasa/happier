import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ResumeSessionOptions, ResumeSessionResult } from '@/sync/ops/sessions';
import type { Session } from '@/sync/domains/state/storageTypes';

type TestWakeStorageState = {
    sessions: Record<string, unknown>;
    machines: Record<string, unknown>;
    getProjectForSession: (sessionId: string) => { key: { machineId: string; path: string } } | null;
};

const storageState = vi.hoisted((): { current: TestWakeStorageState } => ({
    current: {
        sessions: {},
        machines: {},
        getProjectForSession: (_sessionId: string) => null,
    },
}));

vi.mock('@/sync/domains/state/storage', async () => {
    const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
    return createStorageModuleStub({
        // Testkit fixture: pendingQueueWake only reads getState/project target fields here.
        storage: {
            getState: () => storageState.current,
        } as any,
    });
});

type LoadedSubject = typeof import('./submitSessionUserMessage');

async function loadSubject(): Promise<LoadedSubject | null> {
    try {
        return await import('./submitSessionUserMessage');
    } catch {
        return null;
    }
}

async function expectSubject(): Promise<LoadedSubject | null> {
    const subject = await loadSubject();
    if (!subject) {
        expect(subject, 'submitSessionUserMessage module should exist').not.toBeNull();
        return null;
    }
    return subject;
}

function createSession(
    overrides: Partial<Omit<Session, 'metadata'>> & {
        metadata?: Partial<NonNullable<Session['metadata']>>;
    } = {},
): Session {
    const { metadata: _metadataOverrides, ...sessionOverrides } = overrides;
    const metadata = {
        ...(_metadataOverrides ?? {}),
        machineId: _metadataOverrides?.machineId ?? 'm1',
        path: _metadataOverrides?.path ?? '/tmp/project',
        host: _metadataOverrides?.host ?? 'host.local',
        flavor: _metadataOverrides?.flavor ?? 'claude',
        claudeSessionId: _metadataOverrides?.claudeSessionId ?? 'claude-1',
        version: _metadataOverrides?.version ?? '999.0.0',
    };

    return {
        id: 's1',
        serverId: 'server-cache',
        seq: 41,
        createdAt: 1,
        updatedAt: 2,
        active: false,
        activeAt: 1,
        pendingVersion: 2,
        pendingCount: 0,
        metadata,
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0,
        presence: 1,
        optimisticThinkingAt: null,
        ...sessionOverrides,
    };
}

type SubmitCall =
    | { type: 'enqueue'; sessionId: string; text: string; displayText?: string; metaOverrides?: Record<string, unknown> }
    | { type: 'send'; sessionId: string; text: string; displayText?: string; metaOverrides?: Record<string, unknown> }
    | { type: 'resume'; options: ResumeSessionOptions }
    | { type: 'abort'; sessionId: string }
    | { type: 'switchRemote'; sessionId: string };

function createPort(config: {
    enqueueResult?: { localId?: string } | void;
    enqueueReject?: Error;
    sendResult?: { localId?: string; seq?: number } | void;
    resumeResult?: ResumeSessionResult;
    resumeReject?: Error;
    sendReject?: Error;
    canWakeMachine?: boolean;
} = {}) {
    const calls: SubmitCall[] = [];
    const port = {
        enqueuePendingMessage: async (
            sessionId: string,
            text: string,
            displayText?: string,
            metaOverrides?: Record<string, unknown>,
        ) => {
            calls.push({ type: 'enqueue', sessionId, text, displayText, metaOverrides });
            if (config.enqueueReject) throw config.enqueueReject;
            return config.enqueueResult ?? { localId: 'pending-local-id' };
        },
        sendMessage: async (
            sessionId: string,
            text: string,
            displayText?: string,
            metaOverrides?: Record<string, unknown>,
            options?: Readonly<{
                profileId?: string | null;
                localId?: string | null;
                onLocalPendingProjectionCreated?: (event: Readonly<{ localId: string }>) => void;
            }>,
        ) => {
            calls.push({ type: 'send', sessionId, text, displayText, metaOverrides });
            if (config.sendReject) throw config.sendReject;
            options?.onLocalPendingProjectionCreated?.({
                localId: (config.sendResult && typeof config.sendResult === 'object' && config.sendResult.localId) || 'direct-local-id',
            });
            return config.sendResult ?? { localId: 'direct-local-id', seq: 42 };
        },
        resumeSession: async (options: ResumeSessionOptions) => {
            calls.push({ type: 'resume', options });
            if (config.resumeReject) throw config.resumeReject;
            return config.resumeResult ?? { type: 'success' as const };
        },
        abortSession: async (sessionId: string) => {
            calls.push({ type: 'abort', sessionId });
        },
        switchSessionControlToRemote: async (sessionId: string) => {
            calls.push({ type: 'switchRemote', sessionId });
        },
        canWakeMachineId: () => config.canWakeMachine ?? true,
    };

    return { calls, port };
}

describe('submitSessionUserMessage', () => {
    beforeEach(() => {
        storageState.current = {
            sessions: {
                s1: {
                    active: false,
                    updatedAt: 10,
                    metadata: { machineId: 'm1', path: '/tmp/project', homeDir: '/Users/test', host: 'host.local' },
                },
            },
            machines: {
                m1: {
                    id: 'm1',
                    active: true,
                    activeAt: 20,
                    metadata: { host: 'host.local' },
                },
            },
            getProjectForSession: (sessionId: string) =>
                sessionId === 's1'
                    ? {
                        key: {
                            machineId: 'm1',
                            path: '/tmp/project',
                        },
                    }
                    : null,
        };
    });

    it('enqueues pending messages and wakes with the pre-enqueue transcript cursor', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort();
        const outboundHandoffs: unknown[] = [];

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession(),
            text: 'hello',
            configuredMode: 'agent_queue',
            resumeCapabilityOptions: { accountSettings: {} },
            serverId: 'server-cache',
            onOutboundHandoff: (event) => {
                outboundHandoffs.push({
                    event,
                    callTypes: calls.map((call) => call.type),
                });
            },
        });

        expect(result).toMatchObject({
            type: 'success',
            persistence: 'pending',
            wake: { attempted: true, state: 'started' },
            localId: 'pending-local-id',
        });
        expect(calls.map((call) => call.type)).toEqual(['enqueue', 'resume']);
        expect(outboundHandoffs).toEqual([{
            event: {
                persistence: 'pending',
                localId: 'pending-local-id',
            },
            callTypes: ['enqueue'],
        }]);
        expect(calls).toContainEqual(expect.objectContaining({
            type: 'resume',
            options: expect.objectContaining({
                sessionId: 's1',
                machineId: 'm1',
                directory: '/tmp/project',
                initialTranscriptAfterSeq: 41,
                serverId: 'server-cache',
            }),
        }));
    }, 120_000);

    it('keeps the pending row when no wake target is available', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort({ canWakeMachine: false });

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession(),
            text: 'queued',
            configuredMode: 'agent_queue',
            resumeCapabilityOptions: { accountSettings: {} },
        });

        expect(result).toMatchObject({
            type: 'wake_pending',
            persistence: 'pending',
            wake: { attempted: false, state: 'not_needed' },
        });
        expect(calls.map((call) => call.type)).toEqual(['enqueue']);
    });

    it('reports wake failure without falling through to direct send', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort({
            resumeResult: {
                type: 'error',
                errorCode: 'DAEMON_RPC_UNAVAILABLE',
                errorMessage: 'Daemon RPC is not available',
            },
        });

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession(),
            text: 'queued',
            configuredMode: 'agent_queue',
            resumeCapabilityOptions: { accountSettings: {} },
        });

        expect(result).toMatchObject({
            type: 'wake_failed',
            persistence: 'pending',
            wake: {
                attempted: true,
                state: 'failed',
                errorMessage: 'Daemon RPC is not available',
            },
        });
        expect(calls.map((call) => call.type)).toEqual(['enqueue', 'resume']);
    });

    it('direct-sends once for old CLI fallback without pending enqueue', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort();

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession({
                metadata: { version: '0.0.1' },
            }),
            text: 'legacy send',
            configuredMode: 'server_pending',
            resumeCapabilityOptions: { accountSettings: {} },
        });

        expect(result).toMatchObject({
            type: 'success',
            persistence: 'transcript_committed',
            wake: { attempted: false, state: 'not_needed' },
        });
        expect(calls.map((call) => call.type)).toEqual(['send']);
        expect(calls[0]).toMatchObject({
            type: 'send',
            sessionId: 's1',
            text: 'legacy send',
        });
    });

    it('does not let forceImmediate bypass inactive-session pending safety', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort();

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession(),
            text: 'force-safe',
            configuredMode: 'agent_queue',
            forceImmediate: true,
            resumeCapabilityOptions: { accountSettings: {} },
            serverId: 'server-cache',
        });

        expect(result).toMatchObject({
            type: 'success',
            persistence: 'pending',
            wake: { attempted: true, state: 'started' },
        });
        expect(calls.map((call) => call.type)).toEqual(['enqueue', 'resume']);
    });

    it('aborts before sending interrupt messages', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort();

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession({ active: true, presence: 'online' }),
            text: 'stop and do this',
            configuredMode: 'interrupt',
            resumeCapabilityOptions: { accountSettings: {} },
        });

        expect(result).toMatchObject({
            type: 'success',
            persistence: 'transcript_committed',
        });
        expect(calls.map((call) => call.type)).toEqual(['abort', 'send']);
    });

    it('returns send_failed when direct send fails', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort({ sendReject: new Error('send rejected') });
        const outboundHandoff = vi.fn();

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession({ active: true, presence: 'online' }),
            text: 'hello',
            configuredMode: 'agent_queue',
            resumeCapabilityOptions: { accountSettings: {} },
            onOutboundHandoff: outboundHandoff,
        });

        expect(result).toMatchObject({
            type: 'send_failed',
            persistence: 'none',
            errorMessage: 'send rejected',
        });
        expect(calls.map((call) => call.type)).toEqual(['send']);
        expect(outboundHandoff).not.toHaveBeenCalled();
    });

    it('waits for the direct send port to create a local pending projection before marking outbound handoff', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort({ sendResult: { localId: 'projection-local-id', seq: 42 } });
        const handoffTrace: Array<Readonly<{ event: unknown; callTypes: readonly string[] }>> = [];

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession({ active: true, presence: 'online' }),
            text: 'hello',
            configuredMode: 'agent_queue',
            resumeCapabilityOptions: { accountSettings: {} },
            onOutboundHandoff: (event) => {
                handoffTrace.push({
                    event,
                    callTypes: calls.map((call) => call.type),
                });
            },
        });

        expect(result).toMatchObject({
            type: 'success',
            persistence: 'transcript_committed',
            localId: 'projection-local-id',
        });
        expect(calls.map((call) => call.type)).toEqual(['send']);
        expect(handoffTrace).toEqual([{
            event: {
                persistence: 'transcript_committed',
                localId: 'projection-local-id',
            },
            callTypes: ['send'],
        }]);
    });

    it('does not mark outbound handoff when pending enqueue fails before a pending row exists', async () => {
        const subject = await expectSubject();
        if (!subject) return;
        const { calls, port } = createPort({ enqueueReject: new Error('enqueue rejected') });
        const outboundHandoff = vi.fn();

        const result = await subject.submitSessionUserMessage(port, {
            sessionId: 's1',
            session: createSession(),
            text: 'hello',
            configuredMode: 'agent_queue',
            resumeCapabilityOptions: { accountSettings: {} },
            onOutboundHandoff: outboundHandoff,
        });

        expect(result).toMatchObject({
            type: 'send_failed',
            persistence: 'none',
            errorMessage: 'enqueue rejected',
        });
        expect(calls.map((call) => call.type)).toEqual(['enqueue']);
        expect(outboundHandoff).not.toHaveBeenCalled();
    });
});
