import { afterEach, describe, expect, it } from 'vitest';

import type { SessionListRenderableSession } from '@/sync/domains/session/listing/sessionListRenderable';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import type { SessionListRowModel } from './sessionListRowModelTypes';
import { sessionTagKey } from '../sessionTagUtils';
import { buildModelBackedSessionListItems } from './buildModelBackedSessionListItems';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

const SESSION_ID = 'session-1';
const SERVER_ID = 'server-1';
const ROW_KEY = sessionTagKey(SERVER_ID, SESSION_ID);

function makeSession(): SessionListRenderableSession {
    return {
        id: SESSION_ID,
        seq: 1,
        createdAt: 1,
        updatedAt: 1,
        active: true,
        activeAt: 1,
        metadataVersion: 1,
        agentStateVersion: 1,
        metadata: null,
        thinking: false,
        thinkingAt: 0,
        presence: 'online',
    };
}

function makeSessionItem(groupKey: string): Extract<SessionListViewItem, { type: 'session' }> {
    return {
        type: 'session',
        session: makeSession(),
        serverId: SERVER_ID,
        groupKind: 'folder',
        groupKey,
        folderId: groupKey,
        folderDepth: groupKey === 'folder-a' ? 1 : 2,
        variant: groupKey === 'folder-a' ? 'default' : 'no-path',
    };
}

function makeRowModel(): SessionListRowModel {
    const session = makeSession();
    return {
        rowKey: ROW_KEY,
        sessionId: SESSION_ID,
        serverId: SERVER_ID,
        serverName: 'Server',
        treeRowId: `session:${ROW_KEY}`,
        testID: `session-list-item-${SESSION_ID}`,
        dataIndex: 0,
        session,
        status: {
            state: 'disconnected',
            isConnected: false,
            statusText: '',
            shouldShowStatus: false,
            statusColor: 'transparent',
            statusDotColor: 'transparent',
        },
        statusSignature: '',
        nextRuntimeFreshnessAtMs: null,
        secondaryLineMode: 'path',
        attention: {
            listState: 'quiet',
            rowState: 'quiet',
        },
        presentation: {
            attentionIndicator: 'none',
            titleTone: 'quiet',
            secondaryLine: 'path',
        },
        activity: {
            mode: 'meaningful',
            timestamp: null,
            label: '',
            bucket: '',
        },
        isIdentityLoading: false,
        title: 'Session',
        subtitle: '',
        subtitleEllipsizeMode: 'head',
        groupKey: 'folder-a',
        groupKind: 'folder',
        section: 'active',
        variant: 'default',
        folder: { id: 'folder-a', depth: 1 },
        adjacency: { isFirst: true, isLast: true, isSingle: true },
        isSelected: false,
        isPinned: false,
        isArchived: false,
        isActive: true,
        hasUnreadMessages: false,
        pendingCount: 0,
        tags: [],
        allKnownTags: [],
        tagsEnabled: false,
        currentUserId: null,
        showServerBadge: false,
        compact: false,
        compactMinimal: false,
        identityDisplay: 'avatar',
        activeColorMode: 'activityAndAttention',
        workingIndicatorMode: 'spinner',
        hideInactiveSessions: false,
    };
}

describe('buildModelBackedSessionListItems', () => {
    afterEach(() => {
        syncPerformanceTelemetry.configure({ enabled: false });
        syncPerformanceTelemetry.reset();
    });

    it('returns the previous output array when every rendered item is unchanged', () => {
        const cache = new Map();
        const rowModel = makeRowModel();
        const sourceItem = makeSessionItem('folder-a');

        const first = buildModelBackedSessionListItems([sourceItem], [rowModel], cache);
        const second = buildModelBackedSessionListItems([sourceItem], [rowModel], cache);

        expect(second).toBe(first);
    });

    it('reuses the previous output array when equivalent session items replace source objects', () => {
        const cache = new Map();
        const rowModel = makeRowModel();
        const firstSourceItem = makeSessionItem('folder-a');
        const secondSourceItem = makeSessionItem('folder-a');

        const first = buildModelBackedSessionListItems([firstSourceItem], [rowModel], cache);
        const second = buildModelBackedSessionListItems([secondSourceItem], [rowModel], cache);

        expect(second).toBe(first);
        expect(second[0]).toBe(first[0]);
    });

    it('refreshes outer session item fields when the row model is reused', () => {
        const cache = new Map();
        const rowModel = makeRowModel();

        buildModelBackedSessionListItems([makeSessionItem('folder-a')], [rowModel], cache);
        const result = buildModelBackedSessionListItems([makeSessionItem('folder-b')], [rowModel], cache);
        const item = result[0];

        expect(item?.type).toBe('session');
        if (item?.type !== 'session') return;
        expect(item.groupKey).toBe('folder-b');
        expect(item.folderDepth).toBe(2);
        expect(item.variant).toBe('no-path');
        expect(item.rowModel).toBe(rowModel);
    });

    it('records item reuse telemetry when telemetry is enabled', () => {
        syncPerformanceTelemetry.configure({
            enabled: true,
            slowThresholdMs: 1_000_000,
            flushIntervalMs: 60_000,
        });
        syncPerformanceTelemetry.reset();
        const cache = new Map();
        const rowModel = makeRowModel();
        const sourceItem = makeSessionItem('folder-a');

        buildModelBackedSessionListItems([sourceItem], [rowModel], cache);
        syncPerformanceTelemetry.reset();
        buildModelBackedSessionListItems([sourceItem], [rowModel], cache);

        const event = syncPerformanceTelemetry
            .snapshot()
            .events.find((entry) => entry.name === 'ui.sessionsList.rows.modelBackedItems');
        expect(event?.fields).toEqual(expect.objectContaining({
            items: 1,
            sessionRows: 1,
            reusedItems: 1,
            replacedItems: 0,
            outputArrayReused: 1,
        }));
    });
});
