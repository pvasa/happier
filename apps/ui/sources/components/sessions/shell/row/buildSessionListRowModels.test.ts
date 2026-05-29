import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Message } from '@/sync/domains/messages/messageTypes';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { Metadata, Session } from '@/sync/domains/state/storageTypes';
import type { SessionMessages } from '@/sync/store/domains/messages';
import type { SessionPending } from '@/sync/store/domains/pending';
import { createReducer } from '@/sync/reducer/reducer';
import { createSessionListRowModelsCache, buildSessionListRowModels } from './buildSessionListRowModels';
import type { SessionListRowPresentationSettings } from './sessionListRowModelTypes';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

const NOW_MS = 2_000_000;

function createRenderable(id: string, overrides: Partial<SessionListRenderableSession> = {}): SessionListRenderableSession {
    return {
        id,
        seq: 1,
        createdAt: NOW_MS - 600_000,
        updatedAt: NOW_MS - 300_000,
        meaningfulActivityAt: null,
        active: false,
        activeAt: 0,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: {
            name: `Session ${id}`,
            summaryText: null,
            path: `/repo/${id}`,
            homeDir: '/repo',
            host: 'workstation.local',
            machineId: 'machine-1',
        },
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
        latestTurnStatus: null,
        latestTurnStatusObservedAt: null,
        lastRuntimeIssue: null,
        ...overrides,
    };
}

function createSession(id: string, overrides: Partial<Session> = {}): Session {
    const renderable = createRenderable(id);
    const metadata: Metadata = {
        path: renderable.metadata?.path ?? `/repo/${id}`,
        host: renderable.metadata?.host ?? 'workstation.local',
        ...(typeof renderable.metadata?.name === 'string' ? { name: renderable.metadata.name } : {}),
        ...(typeof renderable.metadata?.machineId === 'string' ? { machineId: renderable.metadata.machineId } : {}),
    };
    return {
        ...renderable,
        metadata,
        agentState: null,
        ...overrides,
    };
}

function createSessionItem(
    session: SessionListRenderableSession,
    overrides: Partial<Extract<SessionListViewItem, { type: 'session' }>> = {},
): Extract<SessionListViewItem, { type: 'session' }> {
    return {
        type: 'session',
        session,
        section: 'active',
        groupKey: 'group-a',
        groupKind: 'project',
        serverId: 'server-a',
        serverName: 'Server A',
        ...overrides,
    };
}

function createHeader(): Extract<SessionListViewItem, { type: 'header' }> {
    return {
        type: 'header',
        title: 'Header',
        headerKind: 'active',
        groupKey: 'header-a',
        serverId: 'server-a',
    };
}

function createMessage(id: string, createdAt: number, seq = 1): Message {
    return {
        kind: 'agent-text',
        id,
        seq,
        localId: null,
        createdAt,
        text: id,
    };
}

function createMessages(messages: readonly Message[] = [], version = 1): SessionMessages {
    return {
        messageIdsOldestFirst: messages.map((message) => message.id),
        messagesById: Object.fromEntries(messages.map((message) => [message.id, message])),
        messageRevisionsById: {},
        messagesMap: Object.fromEntries(messages.map((message) => [message.id, message])),
        reducerState: createReducer(),
        reducerVersion: 0,
        latestThinkingMessageId: null,
        latestThinkingMessageActivityAtMs: null,
        latestReadyEventSeq: null,
        latestReadyEventAt: null,
        messagesVersion: version,
        isLoaded: true,
    } as SessionMessages;
}

function createPending(createdAtValues: readonly number[] = []): SessionPending {
    return {
        messages: createdAtValues.map((createdAt, index) => ({
            id: `pending-${index}`,
            localId: null,
            createdAt,
            updatedAt: createdAt,
            text: `pending ${index}`,
            rawRecord: null,
        })),
        discarded: [],
        isLoaded: true,
    };
}

function createSettings(overrides: Partial<SessionListRowPresentationSettings> = {}): SessionListRowPresentationSettings {
    return {
        currentUserId: null,
        density: 'default',
        compact: false,
        compactMinimal: false,
        identityDisplay: 'avatar',
        activeColorMode: 'activityAndAttention',
        workingIndicatorMode: 'spinner',
        workingTextMode: 'static',
        hideInactiveSessions: false,
        showServerBadge: false,
        showPinnedServerBadge: true,
        tagsEnabled: false,
        sessionTagsByKey: {},
        allKnownTags: [],
        pinnedSessionKeys: [],
        hasMultipleMachines: false,
        reachableSessionDisplayByKey: {},
        folderViewEnabled: true,
        relativeNowMs: NOW_MS,
        runtimeNowMs: NOW_MS,
        statusColors: {
            connected: 'connected-token',
            connecting: 'connecting-token',
            actionRequired: 'action-token',
            disconnected: 'disconnected-token',
            error: 'error-token',
            default: 'default-token',
        },
        ...overrides,
    };
}

describe('buildSessionListRowModels', () => {
    afterEach(() => {
        syncPerformanceTelemetry.configure({ enabled: false });
        syncPerformanceTelemetry.reset();
        vi.restoreAllMocks();
    });

    it('keeps unaffected row model references stable across unrelated outer store and item changes', () => {
        const first = createSessionItem(createRenderable('s1'));
        const second = createSessionItem(createRenderable('s2'));
        const cache = createSessionListRowModelsCache();
        const firstResult = buildSessionListRowModels({
            items: [createHeader(), first, second],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache,
        });

        const secondResult = buildSessionListRowModels({
            items: [createHeader(), { ...first, groupKey: 'group-a' }, second],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache,
        });

        expect(secondResult.rows[0]).toBe(firstResult.rows[0]);
        expect(secondResult.rows[1]).toBe(firstResult.rows[1]);
    });

    it('replaces only the affected row when exact per-id renderable, message, or pending inputs change', () => {
        const first = createSessionItem(createRenderable('s1'));
        const second = createSessionItem(createRenderable('s2'));
        const firstMessages = createMessages([createMessage('m1', NOW_MS - 120_000)], 1);
        const firstPending = createPending([]);
        const cache = createSessionListRowModelsCache();
        const firstResult = buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {
                    s1: first.session,
                    s2: second.session,
                },
                sessionMessages: {
                    s1: firstMessages,
                    s2: createMessages([createMessage('m2', NOW_MS - 120_000)], 1),
                },
                sessionPending: {
                    s1: firstPending,
                    s2: createPending([]),
                },
            },
            settings: createSettings(),
            cache,
        });
        const changedSecondRenderable = createRenderable('s2', { meaningfulActivityAt: NOW_MS - 60_000 });
        const secondResult = buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {
                    s1: first.session,
                    s2: changedSecondRenderable,
                },
                sessionMessages: {
                    s1: firstMessages,
                    s2: createMessages([createMessage('m2', NOW_MS - 30_000)], 2),
                },
                sessionPending: {
                    s1: firstPending,
                    s2: createPending([NOW_MS - 30_000]),
                },
            },
            settings: createSettings(),
            cache,
        });

        expect(secondResult.rows[0]).toBe(firstResult.rows[0]);
        expect(secondResult.rows[1]).not.toBe(firstResult.rows[1]);
    });

    it('reuses renderable-backed row models when only the backing session reference changes', () => {
        const item = createSessionItem(createRenderable('s1'));
        const cache = createSessionListRowModelsCache();
        const firstResult = buildSessionListRowModels({
            items: [item],
            state: {
                sessions: { s1: createSession('s1') },
                sessionListRenderables: { s1: item.session },
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache,
        });
        const secondResult = buildSessionListRowModels({
            items: [item],
            state: {
                sessions: { s1: createSession('s1', { seq: 2, updatedAt: NOW_MS }) },
                sessionListRenderables: { s1: item.session },
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache,
        });

        expect(secondResult.rows[0]).toBe(firstResult.rows[0]);
    });

    it('uses relative-time buckets so minute ticks replace only rows whose visible label changes', () => {
        const first = createSessionItem(createRenderable('s1', { meaningfulActivityAt: NOW_MS - 59_000 }));
        const second = createSessionItem(createRenderable('s2', { meaningfulActivityAt: NOW_MS - 2 * 60 * 60 * 1000 }));
        const cache = createSessionListRowModelsCache();
        const firstResult = buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings({ relativeNowMs: NOW_MS, runtimeNowMs: NOW_MS }),
            cache,
        });
        const secondResult = buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings({ relativeNowMs: NOW_MS + 1_000, runtimeNowMs: NOW_MS }),
            cache,
        });

        expect(firstResult.rows[0]?.activity.label).toBe('now');
        expect(secondResult.rows[0]?.activity.label).toBe('1m');
        expect(secondResult.rows[0]).not.toBe(firstResult.rows[0]);
        expect(secondResult.rows[1]).toBe(firstResult.rows[1]);
    });

    it('lets runtime freshness ticks replace affected status rows without broad relative-time churn', () => {
        const activeAt = NOW_MS - 120_000 + 1;
        const first = createSessionItem(createRenderable('s1', {
            active: true,
            activeAt,
            latestTurnStatus: 'in_progress',
            latestTurnStatusObservedAt: activeAt,
        }));
        const second = createSessionItem(createRenderable('s2'));
        const cache = createSessionListRowModelsCache();
        const firstResult = buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings({ relativeNowMs: NOW_MS, runtimeNowMs: NOW_MS }),
            cache,
        });
        const secondResult = buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings({ relativeNowMs: NOW_MS, runtimeNowMs: NOW_MS + 2 }),
            cache,
        });

        expect(firstResult.nextRuntimeFreshnessAtMs).toBe(NOW_MS + 1);
        expect(firstResult.rows[0]?.status.state).toBe('thinking');
        expect(secondResult.rows[0]?.status.state).toBe('waiting');
        expect(secondResult.rows[0]).not.toBe(firstResult.rows[0]);
        expect(secondResult.rows[1]).toBe(firstResult.rows[1]);
    });

    it('records row model reuse telemetry when telemetry is enabled', () => {
        syncPerformanceTelemetry.configure({
            enabled: true,
            slowThresholdMs: 1_000_000,
            flushIntervalMs: 60_000,
        });
        syncPerformanceTelemetry.reset();
        const first = createSessionItem(createRenderable('s1'));
        const second = createSessionItem(createRenderable('s2'));
        const cache = createSessionListRowModelsCache();

        buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {
                    s1: first.session,
                    s2: second.session,
                },
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache,
        });
        syncPerformanceTelemetry.reset();

        const changedSecondRenderable = createRenderable('s2', { meaningfulActivityAt: NOW_MS - 60_000 });
        buildSessionListRowModels({
            items: [first, second],
            state: {
                sessions: {},
                sessionListRenderables: {
                    s1: first.session,
                    s2: changedSecondRenderable,
                },
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache,
        });

        const event = syncPerformanceTelemetry
            .snapshot()
            .events.find((entry) => entry.name === 'ui.sessionsList.rows.modelBuild');
        expect(event?.fields).toEqual(expect.objectContaining({
            items: 2,
            sessionRows: 2,
            reusedRows: 1,
            rebuiltRows: 1,
            renderableRefChanges: 1,
        }));
    });

    it('does not use JSON serialization while building hot-path row cache signatures', () => {
        const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation(() => {
            throw new Error('JSON.stringify must not run in session row model cache signatures');
        });

        const result = buildSessionListRowModels({
            items: [createSessionItem(createRenderable('s1'))],
            state: {
                sessions: {},
                sessionListRenderables: {},
                sessionMessages: {},
                sessionPending: {},
            },
            settings: createSettings(),
            cache: createSessionListRowModelsCache(),
        });

        expect(result.rows).toHaveLength(1);
        expect(stringifySpy).not.toHaveBeenCalled();
    });

    it('reuses exact cached rows without scanning transcript messages when row inputs are unchanged', () => {
        const item = createSessionItem(createRenderable('s1'));
        const messages = createMessages([createMessage('m1', NOW_MS - 120_000)], 1);
        const pending = createPending([]);
        const cache = createSessionListRowModelsCache();
        const firstResult = buildSessionListRowModels({
            items: [item],
            state: {
                sessions: {},
                sessionListRenderables: { s1: item.session },
                sessionMessages: { s1: messages },
                sessionPending: { s1: pending },
            },
            settings: createSettings(),
            cache,
        });

        Object.defineProperty(messages, 'messageIdsOldestFirst', {
            configurable: true,
            get: () => {
                throw new Error('unchanged cached rows must not rescan transcript messages');
            },
        });

        const secondResult = buildSessionListRowModels({
            items: [item],
            state: {
                sessions: {},
                sessionListRenderables: { s1: item.session },
                sessionMessages: { s1: messages },
                sessionPending: { s1: pending },
            },
            settings: createSettings(),
            cache,
        });

        expect(secondResult.rows[0]).toBe(firstResult.rows[0]);
    });
});
