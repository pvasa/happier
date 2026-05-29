import { describe, expect, it } from 'vitest';

import { chooseSubmitMode } from './submitMode';

describe('chooseSubmitMode', () => {
    const now = 1_000_000;

    it('preserves interrupt mode', () => {
        expect(chooseSubmitMode({
            configuredMode: 'interrupt',
            session: { metadata: {} } as any,
        })).toBe('interrupt');
    });

    it('falls back to agent_queue when configuredMode=server_pending but the server does not support pending', () => {
        expect(chooseSubmitMode({
            configuredMode: 'server_pending',
            session: { metadata: {} } as any,
        })).toBe('agent_queue');
    });

    it('preserves explicit server_pending mode when pending is supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'server_pending',
            session: {
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
        })).toBe('server_pending');
    });

    it('uses agent_queue while thinking when configuredMode=server_pending and in-flight steer is supported and the session is online+ready', () => {
        expect(chooseSubmitMode({
            configuredMode: 'server_pending',
            busySteerSendPolicy: 'steer_immediately',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: true } },
                pendingVersion: 0,
                pendingCount: 1,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('agent_queue');
    });

    it('uses server_pending while thinking when runtime steer availability has not arrived yet', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                agentStateVersion: 0,
                agentState: { controlledByUser: false },
                pendingVersion: 0,
                pendingCount: 1,
                metadata: { flavor: 'pi' },
            } as any,
            nowMs: now,
        })).toBe('server_pending');
    });

    it('uses server_pending for inactive sessions when pending queue V2 is supported even if stale signals look steerable', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                active: false,
                presence: 'online',
                thinking: true,
                thinkingAt: now,
                latestTurnStatus: 'in_progress',
                latestTurnStatusObservedAt: now,
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: true } },
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('server_pending');
    });

    it('keeps server_pending while thinking when in-flight steer is supported but unavailable for the active turn', () => {
        expect(chooseSubmitMode({
            configuredMode: 'server_pending',
            busySteerSendPolicy: 'steer_immediately',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                agentStateVersion: 1,
                agentState: {
                    controlledByUser: false,
                    capabilities: {
                        inFlightSteer: true,
                        inFlightSteerSupported: true,
                        inFlightSteerAvailable: false,
                    },
                },
                pendingVersion: 0,
                pendingCount: 1,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('server_pending');
    });

    it('prefers server_pending while controlledByUser when queue is supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                agentState: { controlledByUser: true },
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
        })).toBe('server_pending');
    });

    it('keeps agent_queue for shared local attachment when remote writes are allowed', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                presence: 'online',
                agentStateVersion: 1,
                agentState: {
                    controlledByUser: false,
                    localControl: {
                        attached: true,
                        topology: 'shared',
                        remoteWritable: true,
                    },
                },
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
        })).toBe('agent_queue');
    });

    it('prefers server_pending while thinking when queue is supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('server_pending');
    });

    it('keeps agent_queue while thinking when in-flight steer is supported and the session is online+ready', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: true } },
                pendingVersion: 0,
                pendingCount: 1,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('agent_queue');
    });

    it('honors an explicit server_pending send intent even when normal routing would steer immediately', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            explicitMode: 'server_pending',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: true } },
                pendingVersion: 0,
                pendingCount: 1,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('server_pending');
    });

    it('prefers server_pending while thinking when in-flight steer is supported but the user prefers server_pending', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            busySteerSendPolicy: 'server_pending',
            session: {
                thinking: true,
                thinkingAt: now,
                active: true,
                presence: 'online',
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: true } },
                pendingVersion: 0,
                pendingCount: 1,
                metadata: {},
            } as any,
            nowMs: now,
        } as any)).toBe('server_pending');
    });

    it('does not treat stale thinking as busy when choosing composer delivery', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                thinking: true,
                thinkingAt: now - 120_000,
                active: true,
                presence: 'online',
                latestTurnStatus: 'completed',
                latestTurnStatusObservedAt: now - 1_000,
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: false } },
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('agent_queue');
    });

    it('prefers server_pending when the session is offline but queue is supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                presence: 0,
                agentStateVersion: 0,
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
        })).toBe('server_pending');
    });

    it('prefers server_pending when the agent is not ready but queue is supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                presence: 'online',
                agentStateVersion: 0,
                pendingVersion: 0,
                pendingCount: 0,
                metadata: {},
            } as any,
        })).toBe('server_pending');
    });

    it('keeps agent_queue for inactive sessions if queue is not supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                active: false,
                presence: 'online',
                thinking: true,
                thinkingAt: now,
                latestTurnStatus: 'in_progress',
                latestTurnStatusObservedAt: now,
                agentStateVersion: 1,
                agentState: { controlledByUser: false, capabilities: { inFlightSteer: true } },
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('agent_queue');
    });

    it('keeps agent_queue for explicit server_pending on inactive sessions if queue is not supported', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            explicitMode: 'server_pending',
            session: {
                active: false,
                presence: 'online',
                agentStateVersion: 1,
                metadata: {},
            } as any,
            nowMs: now,
        })).toBe('agent_queue');
    });

    it('keeps agent_queue when pending is supported but the CLI version is too old (prevents stranded pending)', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            session: {
                presence: 0,
                agentStateVersion: 0,
                pendingVersion: 0,
                pendingCount: 0,
                metadata: { version: '0.0.1' },
            } as any,
        })).toBe('agent_queue');
    });

    it('keeps agent_queue for explicit server_pending on inactive sessions when the CLI version is too old', () => {
        expect(chooseSubmitMode({
            configuredMode: 'agent_queue',
            explicitMode: 'server_pending',
            session: {
                active: false,
                presence: 'online',
                agentStateVersion: 1,
                pendingVersion: 0,
                pendingCount: 0,
                metadata: { version: '0.0.1' },
            } as any,
            nowMs: now,
        })).toBe('agent_queue');
    });
});
