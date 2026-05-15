import type { ServerSelectionPresentation } from '@/sync/domains/server/selection/serverSelectionTypes';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

import { applySessionListIndexPresentation } from './sessionListIndexPresentation';
import {
    applySessionListIndexGroupOrdering,
    reorderSessionListIndexSessionItemsByKeys,
    sortSessionListIndexItemsByOrderingMode,
    type SessionListOrderingModeV1,
} from './sessionListIndexOrdering';
import {
    filterHiddenInactiveSessionListIndexItems,
    inspectVisibleSessionListIndexSourceState,
    pruneOrphanSessionListIndexHeaders,
} from './sessionListIndexVisibility';
import {
    applySessionListIndexAttentionPromotionWithinGroups,
    buildSessionListIndexAttentionPromotion,
} from './attentionPromotion/sessionListIndexAttentionPromotion';
import {
    normalizeSessionListAttentionPromotionMode,
    type SessionListAttentionPromotionOptions,
} from './attentionPromotion/sessionListAttentionPromotion';
import { normalizeSessionListKeyParts } from './sessionListKeyNormalization';
import { normalizeTrimmedStringArrayWithSharedEmpty } from './normalizeTrimmedStringArrayWithSharedEmpty';
import type { SessionListIndexItem } from './sessionListIndex';
import type { SessionListRenderableSession } from './sessionListRenderable';
import { resolveSessionRowForIndexItem } from './sessionListIndexSessionRows';
import { PINNED_GROUP_KEY_V1 } from './sessionListOrderingStateV1';

export type { SessionListOrderingModeV1 } from './sessionListIndexOrdering';

export type ComputeVisibleSessionListIndexParams = Readonly<{
    source: ReadonlyArray<SessionListIndexItem> | null;
    resolveSessionRow: (serverId: string | null | undefined, sessionId: string) => SessionListRenderableSession | null;
    hideInactiveSessions: boolean;
    pinnedSessionKeysV1: ReadonlyArray<string>;
    sessionListGroupOrderV1: Readonly<Record<string, ReadonlyArray<string> | undefined>>;
    sessionListOrderingModeV1?: SessionListOrderingModeV1;
    presentation: Readonly<{
        enabled: boolean;
        presentation: ServerSelectionPresentation;
        selectedServerIds?: ReadonlyArray<string>;
    }>;
    storageFilterApplied?: boolean;
    attentionPromotion?: SessionListAttentionPromotionOptions;
}>;

function countOrderedGroups(orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>> | undefined): number {
    if (!orderByGroupKey) return 0;
    return Object.values(orderByGroupKey).filter((keys) => Array.isArray(keys) && keys.length > 0).length;
}

function countPinnedSessionKeys(keys: ReadonlyArray<string> | undefined): number {
    return (keys ?? []).filter((key) => typeof key === 'string' && key.trim().length > 0).length;
}

function countSessionItems(items: ReadonlyArray<SessionListIndexItem>): number {
    let count = 0;
    for (const item of items) {
        if (item.type === 'session') count += 1;
    }
    return count;
}

function nowMs(): number {
    const perf = (globalThis as unknown as { performance?: { now?: () => number } }).performance;
    return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function hasGroupOrderingOverrides(
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
): boolean {
    return Object.values(orderByGroupKey ?? {}).some((keys) => Array.isArray(keys) && keys.length > 0);
}

function canReturnSourceForNoop(params: Readonly<{
    orderingMode: SessionListOrderingModeV1;
    hideInactiveSessions: boolean;
    pinnedSessionKeys: ReadonlyArray<string>;
    presentationEnabled: boolean;
    hasOrderingOverrides: boolean;
    hasArchivedSessionItems: boolean;
    hasOrphanHeaders: boolean;
}>): boolean {
    return params.orderingMode === 'custom'
        && !params.hideInactiveSessions
        && params.pinnedSessionKeys.length === 0
        && !params.presentationEnabled
        && !params.hasOrderingOverrides
        && !params.hasArchivedSessionItems
        && !params.hasOrphanHeaders;
}

function buildPinnedSessionListIndexItems(params: Readonly<{
    ordered: ReadonlyArray<SessionListIndexItem>;
    pinnedSessionKeys: ReadonlyArray<string>;
}>): Readonly<{
    pinnedSessions: Array<Extract<SessionListIndexItem, { type: 'session' }>>;
    remainder: SessionListIndexItem[];
}> {
    const pinnedSet = new Set(params.pinnedSessionKeys);
    const pinnedSessions: Array<Extract<SessionListIndexItem, { type: 'session' }>> = [];
    const remainder: SessionListIndexItem[] = [];

    for (const item of params.ordered) {
        if (item.type !== 'session') {
            remainder.push(item);
            continue;
        }
        const key = normalizeSessionListKeyParts(item.serverId, item.sessionId).sessionKey;
        if (key && pinnedSet.has(key)) {
            pinnedSessions.push({
                ...item,
                pinned: true,
                groupKey: PINNED_GROUP_KEY_V1,
                groupKind: 'pinned',
                variant: 'default',
            });
            continue;
        }
        remainder.push(item);
    }

    return { pinnedSessions, remainder };
}

function computeVisibleSessionListIndexUnmeasured(
    params: ComputeVisibleSessionListIndexParams,
): SessionListIndexItem[] | null {
    const source = params.source;
    if (!source) return null;

    const orderingMode = params.sessionListOrderingModeV1 ?? 'custom';
    const pinnedSessionKeys = normalizeTrimmedStringArrayWithSharedEmpty(params.pinnedSessionKeysV1);
    const presentationEnabled = params.presentation.enabled === true;
    const attentionPromotionMode = normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode);
    const attentionPromotionEnabled = attentionPromotionMode !== 'off';
    const hasOrderingOverrides = hasGroupOrderingOverrides(params.sessionListGroupOrderV1);
    const sourceState = inspectVisibleSessionListIndexSourceState(source, params.resolveSessionRow);

    if (canReturnSourceForNoop({
        orderingMode,
        hideInactiveSessions: params.hideInactiveSessions,
        pinnedSessionKeys,
        presentationEnabled,
        hasOrderingOverrides,
        hasArchivedSessionItems: sourceState.hasArchivedSessionItems,
        hasOrphanHeaders: sourceState.hasOrphanHeaders,
    }) && !attentionPromotionEnabled) {
        return source as SessionListIndexItem[];
    }

    const orderedByGroup = orderingMode === 'custom'
        ? applySessionListIndexGroupOrdering(source, params.sessionListGroupOrderV1 ?? {})
        : source;
    if (
        orderingMode === 'custom'
        && orderedByGroup === source
        && canReturnSourceForNoop({
            orderingMode,
            hideInactiveSessions: params.hideInactiveSessions,
            pinnedSessionKeys,
            presentationEnabled,
            hasOrderingOverrides: false,
            hasArchivedSessionItems: sourceState.hasArchivedSessionItems,
            hasOrphanHeaders: sourceState.hasOrphanHeaders,
        }) && !attentionPromotionEnabled
    ) {
        return source as SessionListIndexItem[];
    }

    const ordered = orderingMode === 'custom'
        ? orderedByGroup
        : sortSessionListIndexItemsByOrderingMode(source, orderingMode, params.resolveSessionRow);
    if (
        orderingMode !== 'custom'
        && ordered === source
        && !params.hideInactiveSessions
        && pinnedSessionKeys.length === 0
        && !presentationEnabled
        && !attentionPromotionEnabled
        && !sourceState.hasArchivedSessionItems
        && !sourceState.hasOrphanHeaders
    ) {
        return source as SessionListIndexItem[];
    }

    if (
        orderingMode === 'custom'
        && params.hideInactiveSessions
        && pinnedSessionKeys.length === 0
        && !presentationEnabled
        && !attentionPromotionEnabled
        && !hasOrderingOverrides
        && !sourceState.hasArchivedSessionItems
        && !sourceState.hasOrphanHeaders
        && !sourceState.hasInactiveSessionsThatNeedFiltering
    ) {
        return source as SessionListIndexItem[];
    }

    const orderedWithoutArchived = ordered.filter((item) => {
        if (item.type !== 'session') return true;
        const row = resolveSessionRowForIndexItem(item, params.resolveSessionRow);
        return row?.archivedAt == null;
    });

    const { pinnedSessions, remainder } = buildPinnedSessionListIndexItems({
        ordered: orderedWithoutArchived,
        pinnedSessionKeys,
    });

    const pinnedHeader: Extract<SessionListIndexItem, { type: 'header' }> | null =
        pinnedSessions.length > 0
            ? { type: 'header', title: 'Pinned', headerKind: 'pinned', groupKey: PINNED_GROUP_KEY_V1 }
            : null;

    const pinnedOrdered = orderingMode === 'custom'
        ? reorderSessionListIndexSessionItemsByKeys(pinnedSessions, params.sessionListGroupOrderV1?.[PINNED_GROUP_KEY_V1])
        : sortSessionListIndexItemsByOrderingMode(pinnedSessions, orderingMode, params.resolveSessionRow);

    const remainderPruned = pruneOrphanSessionListIndexHeaders(remainder);
    const attentionPromotion = buildSessionListIndexAttentionPromotion({
        source: remainderPruned,
        options: params.attentionPromotion,
        resolveSessionRow: params.resolveSessionRow,
    });
    const remainderAfterAttention = attentionPromotionMode === 'withinGroups'
        ? applySessionListIndexAttentionPromotionWithinGroups({
            source: remainderPruned,
            options: params.attentionPromotion,
            resolveSessionRow: params.resolveSessionRow,
        })
        : attentionPromotion
            ? pruneOrphanSessionListIndexHeaders(attentionPromotion.remainder)
            : remainderPruned;
    const remainderFiltered = params.hideInactiveSessions
        ? filterHiddenInactiveSessionListIndexItems(remainderAfterAttention, params.resolveSessionRow)
        : remainderAfterAttention;

    const remainderPresented = applySessionListIndexPresentation(remainderFiltered, {
        enabled: params.presentation.enabled,
        presentation: params.presentation.presentation,
        selectedServerIds: params.presentation.selectedServerIds,
    });

    return [
        ...(pinnedHeader ? [pinnedHeader, ...pinnedOrdered] : []),
        ...(attentionPromotion?.attentionItems ?? []),
        ...remainderPresented,
    ];
}

export function computeVisibleSessionListIndex(
    params: ComputeVisibleSessionListIndexParams,
): SessionListIndexItem[] | null {
    const source = params.source;
    if (!source) return null;
    if (!syncPerformanceTelemetry.isEnabled()) {
        return computeVisibleSessionListIndexUnmeasured(params);
    }

    const startedAtMs = nowMs();
    const result = computeVisibleSessionListIndexUnmeasured(params);
    const sessionCount = countSessionItems(source);
    syncPerformanceTelemetry.recordDuration(
        'sync.sessions.list.visible.compute',
        nowMs() - startedAtMs,
        {
            items: source.length,
            sessions: sessionCount,
            headers: source.length - sessionCount,
            fastPath: result === source ? 1 : 0,
            hideInactive: params.hideInactiveSessions === true ? 1 : 0,
            pins: countPinnedSessionKeys(params.pinnedSessionKeysV1),
            customOrder: countOrderedGroups(params.sessionListGroupOrderV1),
            presentationEnabled: params.presentation.enabled === true ? 1 : 0,
            storageFilter: params.storageFilterApplied === true ? 1 : 0,
            attentionPromotionEnabled: normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode) === 'off' ? 0 : 1,
            attentionPromotionGlobal: normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode) === 'global' ? 1 : 0,
            attentionPromotionWithinGroups: normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode) === 'withinGroups' ? 1 : 0,
        },
    );
    return result;
}
