import type { ServerSelectionPresentation } from '@/sync/domains/server/selection/serverSelectionTypes';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';

import { applySessionListIndexPresentation } from './sessionListIndexPresentation';
import {
    applySessionListIndexGroupOrdering,
    applySessionListStructuralGroupOrder,
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
    applySessionListIndexWorkingPlacementWithinGroups,
    buildSessionListIndexAttentionPromotion,
    buildSessionListIndexWorkingPlacement,
} from './attentionPromotion/sessionListIndexAttentionPromotion';
import {
    normalizeSessionListAttentionPromotionMode,
    normalizeSessionListWorkingPlacementMode,
    type SessionListAttentionPromotionOptions,
    type SessionListWorkingPlacementOptions,
} from './attentionPromotion/sessionListAttentionPromotion';
import {
    normalizeSessionListFolderSortModeV1,
    type SessionListFolderSortModeV1,
} from './sessionListFolderSortMode';
import {
    normalizeSessionListOrderingSectionMode,
    normalizeSessionListOrderingModeV1,
    resolveEffectiveSessionListOrderingModeForGroup,
    resolveEffectiveSessionListFolderSortMode,
    type SessionListOrderingSectionMode,
} from './sessionListOrderingRules';
import { normalizeSessionListKeyParts } from './sessionListKeyNormalization';
import { normalizeTrimmedStringArrayWithSharedEmpty } from './normalizeTrimmedStringArrayWithSharedEmpty';
import type { SessionListIndexItem } from './sessionListIndex';
import type { SessionListRenderableSession } from './sessionListRenderable';
import { resolveSessionRowForIndexItem } from './sessionListIndexSessionRows';
import { PINNED_GROUP_KEY_V1 } from './sessionListOrderingStateV1';
import {
    applySessionWorkspaceOrderV1ToIndex,
    type SessionWorkspaceOrderV1,
} from './sessionWorkspaceOrderStateV1';
import type { SessionListWorkingRetentionKeySource } from './placement/sessionListWorkingRetention';

export type { SessionListOrderingModeV1 } from './sessionListIndexOrdering';

export type ComputeVisibleSessionListIndexParams = Readonly<{
    source: ReadonlyArray<SessionListIndexItem> | null;
    resolveSessionRow: (serverId: string | null | undefined, sessionId: string) => SessionListRenderableSession | null;
    hideInactiveSessions: boolean;
    pinnedSessionKeysV1: ReadonlyArray<string>;
    sessionListGroupOrderV1: Readonly<Record<string, ReadonlyArray<string> | undefined>>;
    sessionWorkspaceOrderV1?: SessionWorkspaceOrderV1;
    sessionListOrderingModeV1?: SessionListOrderingModeV1;
    sessionListSectionModeV1?: SessionListOrderingSectionMode;
    sessionListFolderSortModeV1?: SessionListFolderSortModeV1;
    presentation: Readonly<{
        enabled: boolean;
        presentation: ServerSelectionPresentation;
        selectedServerIds?: ReadonlyArray<string>;
    }>;
    storageFilterApplied?: boolean;
    attentionPromotion?: SessionListAttentionPromotionOptions;
    workingPlacement?: SessionListWorkingPlacementOptions;
    retainWorkingSessionKeys?: SessionListWorkingRetentionKeySource;
    nowMs?: number;
}>;

function countOrderedGroups(orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>> | undefined): number {
    if (!orderByGroupKey) return 0;
    return Object.values(orderByGroupKey).filter((keys) => Array.isArray(keys) && keys.length > 0).length;
}

function countPinnedSessionKeys(keys: ReadonlyArray<string> | undefined): number {
    return (keys ?? []).filter((key) => typeof key === 'string' && key.trim().length > 0).length;
}

const SESSION_LIST_ORDERING_MODE_TELEMETRY_CODE: Readonly<Record<SessionListOrderingModeV1, number>> = {
    custom: 0,
    created: 1,
    updated: 2,
};

const SESSION_LIST_FOLDER_SORT_MODE_TELEMETRY_CODE: Readonly<Record<SessionListFolderSortModeV1, number>> = {
    foldersFirst: 0,
    mixed: 1,
};

function encodeOrderingModeForTelemetry(orderingMode: SessionListOrderingModeV1): number {
    return SESSION_LIST_ORDERING_MODE_TELEMETRY_CODE[orderingMode];
}

function encodeFolderSortModeForTelemetry(folderSortMode: SessionListFolderSortModeV1): number {
    return SESSION_LIST_FOLDER_SORT_MODE_TELEMETRY_CODE[folderSortMode];
}

type VisibleSessionListSourceTelemetry = Readonly<{
    sessionCount: number;
    effectiveModeOverrides: number;
    bucketSortApplied: number;
    hasNonCustomSessionOrdering: boolean;
}>;

type VisibleSessionListTelemetrySink = {
    sourceTelemetry?: VisibleSessionListSourceTelemetry;
};

function inspectVisibleSessionListOrderingState(params: Readonly<{
    source: ReadonlyArray<SessionListIndexItem>;
    orderingMode: SessionListOrderingModeV1;
    sectionMode: SessionListOrderingSectionMode;
}>): VisibleSessionListSourceTelemetry {
    let sessionCount = 0;
    let bucketSortApplied = 0;
    let hasNonCustomSessionOrdering = false;
    const overrideScopeKeys = new Set<string>();

    for (const item of params.source) {
        if (item.type !== 'session') continue;
        sessionCount += 1;

        const groupKey = typeof item.groupKey === 'string' ? item.groupKey.trim() : '';
        if (!groupKey) continue;
        const section = params.sectionMode === 'single' ? 'sessions' : item.section;
        const effectiveMode = resolveEffectiveSessionListOrderingModeForGroup({
            section,
            sectionMode: params.sectionMode,
            groupKind: item.groupKind,
            userOrderingMode: params.orderingMode,
        });
        if (effectiveMode !== params.orderingMode) {
            overrideScopeKeys.add(`${params.sectionMode}:${section ?? 'unknown'}:${groupKey}`);
        }
        if (effectiveMode !== 'custom') {
            hasNonCustomSessionOrdering = true;
        }
        if (effectiveMode === 'updated') {
            bucketSortApplied = 1;
        }
    }

    return {
        sessionCount,
        effectiveModeOverrides: overrideScopeKeys.size,
        bucketSortApplied,
        hasNonCustomSessionOrdering,
    };
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

function buildPinnedSessionStructuralOrderKeys(params: Readonly<{
    groupOrderKeys: ReadonlyArray<string> | undefined;
    pinnedSessionKeys: ReadonlyArray<string>;
}>): string[] {
    const orderedKeys = normalizeTrimmedStringArrayWithSharedEmpty(params.groupOrderKeys ?? []);
    if (orderedKeys.length === 0) return [...params.pinnedSessionKeys];

    const seen = new Set<string>();
    const out: string[] = [];
    for (const key of orderedKeys) {
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    for (const key of params.pinnedSessionKeys) {
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(key);
    }
    return out;
}

function orderPinnedSessionListIndexItems(params: Readonly<{
    pinnedSessions: ReadonlyArray<Extract<SessionListIndexItem, { type: 'session' }>>;
    pinnedSessionKeys: ReadonlyArray<string>;
    groupOrderKeys: ReadonlyArray<string> | undefined;
    orderingMode: SessionListOrderingModeV1;
    resolveSessionRow: ComputeVisibleSessionListIndexParams['resolveSessionRow'];
}>): Array<Extract<SessionListIndexItem, { type: 'session' }>> {
    if (params.orderingMode === 'custom') {
        return reorderSessionListIndexSessionItemsByKeys(
            params.pinnedSessions,
            buildPinnedSessionStructuralOrderKeys({
                groupOrderKeys: params.groupOrderKeys,
                pinnedSessionKeys: params.pinnedSessionKeys,
            }),
        );
    }

    return sortSessionListIndexItemsByOrderingMode(
        params.pinnedSessions,
        params.orderingMode,
        params.resolveSessionRow,
        { sectionMode: 'single' },
    ) as Array<Extract<SessionListIndexItem, { type: 'session' }>>;
}

function applyPinnedSessionListIndexFlags(params: Readonly<{
    ordered: ReadonlyArray<SessionListIndexItem>;
    pinnedSessionKeys: ReadonlyArray<string>;
}>): SessionListIndexItem[] {
    if (params.pinnedSessionKeys.length === 0 || params.ordered.length === 0) {
        return params.ordered as SessionListIndexItem[];
    }

    const pinnedSet = new Set(params.pinnedSessionKeys);
    let changed = false;
    const next = params.ordered.map((item) => {
        if (item.type !== 'session') return item;
        const key = normalizeSessionListKeyParts(item.serverId, item.sessionId).sessionKey;
        if (!key || !pinnedSet.has(key)) return item;
        if (item.pinned === true && item.variant === 'default') return item;
        changed = true;
        return {
            ...item,
            pinned: true,
            variant: 'default' as const,
        };
    });

    return changed ? next : params.ordered as SessionListIndexItem[];
}

function computeVisibleSessionListIndexUnmeasured(
    params: ComputeVisibleSessionListIndexParams,
    telemetrySink?: VisibleSessionListTelemetrySink,
): SessionListIndexItem[] | null {
    const source = params.source;
    if (!source) return null;

    const orderingMode = normalizeSessionListOrderingModeV1(params.sessionListOrderingModeV1);
    const sectionMode = normalizeSessionListOrderingSectionMode(params.sessionListSectionModeV1);
    const sourceTelemetry = inspectVisibleSessionListOrderingState({ source, orderingMode, sectionMode });
    if (telemetrySink) {
        telemetrySink.sourceTelemetry = sourceTelemetry;
    }
    const folderSortMode = resolveEffectiveSessionListFolderSortMode({
        orderingMode,
        folderSortMode: normalizeSessionListFolderSortModeV1(params.sessionListFolderSortModeV1),
    });
    const pinnedSessionKeys = normalizeTrimmedStringArrayWithSharedEmpty(params.pinnedSessionKeysV1);
    const presentationEnabled = params.presentation.enabled === true;
    const attentionPromotionMode = normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode);
    const attentionPromotionEnabled = attentionPromotionMode !== 'off';
    const workingPlacementMode = normalizeSessionListWorkingPlacementMode(params.workingPlacement?.mode);
    const workingPlacementEnabled = workingPlacementMode !== 'off';
    const placementNowMs = params.nowMs ?? Date.now();
    const hasOrderingOverrides = hasGroupOrderingOverrides(params.sessionListGroupOrderV1)
        || hasGroupOrderingOverrides(params.sessionWorkspaceOrderV1 ?? {});
    const sourceState = inspectVisibleSessionListIndexSourceState(source, params.resolveSessionRow);
    const hasNonCustomSessionOrdering = sourceTelemetry.hasNonCustomSessionOrdering;

    if (canReturnSourceForNoop({
        orderingMode,
        hideInactiveSessions: params.hideInactiveSessions,
        pinnedSessionKeys,
        presentationEnabled,
        hasOrderingOverrides,
        hasArchivedSessionItems: sourceState.hasArchivedSessionItems,
        hasOrphanHeaders: sourceState.hasOrphanHeaders,
    }) && !attentionPromotionEnabled && !workingPlacementEnabled && !hasNonCustomSessionOrdering) {
        return source as SessionListIndexItem[];
    }

    const orderedByWorkspace = applySessionWorkspaceOrderV1ToIndex(source, params.sessionWorkspaceOrderV1 ?? {});
    const orderedByGroup = orderingMode === 'custom'
        ? applySessionListIndexGroupOrdering(orderedByWorkspace, params.sessionListGroupOrderV1 ?? {}, { folderSortMode, sectionMode })
        : applySessionListStructuralGroupOrder(orderedByWorkspace, params.sessionListGroupOrderV1 ?? {}, { folderSortMode });
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
        && !workingPlacementEnabled
        && !hasNonCustomSessionOrdering
    ) {
        return source as SessionListIndexItem[];
    }

    const ordered = sortSessionListIndexItemsByOrderingMode(orderedByGroup, orderingMode, params.resolveSessionRow, { sectionMode });
    if (
        orderingMode !== 'custom'
        && ordered === source
        && !params.hideInactiveSessions
        && pinnedSessionKeys.length === 0
        && !presentationEnabled
        && !attentionPromotionEnabled
        && !workingPlacementEnabled
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
        && !workingPlacementEnabled
        && !hasOrderingOverrides
        && !sourceState.hasArchivedSessionItems
        && !sourceState.hasOrphanHeaders
        && !sourceState.hasInactiveSessionsThatNeedFiltering
        && !hasNonCustomSessionOrdering
    ) {
        return source as SessionListIndexItem[];
    }

    const orderedWithoutArchived = ordered.filter((item) => {
        if (item.type !== 'session') return true;
        const row = resolveSessionRowForIndexItem(item, params.resolveSessionRow);
        return row?.archivedAt == null;
    });

    const orderedWithPinnedFlags = applyPinnedSessionListIndexFlags({
        ordered: orderedWithoutArchived,
        pinnedSessionKeys,
    });

    const globalAttentionSource = pruneOrphanSessionListIndexHeaders(orderedWithPinnedFlags);
    const attentionPromotion = buildSessionListIndexAttentionPromotion({
        source: globalAttentionSource,
        options: params.attentionPromotion,
        resolveSessionRow: params.resolveSessionRow,
        nowMs: placementNowMs,
    });
    const orderedWithoutGlobalAttention = attentionPromotion
        ? pruneOrphanSessionListIndexHeaders(attentionPromotion.remainder)
        : orderedWithPinnedFlags;
    const workingPlacement = buildSessionListIndexWorkingPlacement({
        source: pruneOrphanSessionListIndexHeaders(orderedWithoutGlobalAttention),
        options: params.workingPlacement,
        retainedKeys: params.retainWorkingSessionKeys,
        resolveSessionRow: params.resolveSessionRow,
        nowMs: placementNowMs,
    });
    const orderedWithoutGlobalWorking = workingPlacement
        ? pruneOrphanSessionListIndexHeaders(workingPlacement.remainder)
        : orderedWithoutGlobalAttention;

    const { pinnedSessions, remainder } = buildPinnedSessionListIndexItems({
        ordered: orderedWithoutGlobalWorking,
        pinnedSessionKeys,
    });

    const pinnedHeader: Extract<SessionListIndexItem, { type: 'header' }> | null =
        pinnedSessions.length > 0
            ? { type: 'header', title: 'Pinned', headerKind: 'pinned', groupKey: PINNED_GROUP_KEY_V1 }
            : null;

    const pinnedOrdered = orderPinnedSessionListIndexItems({
        pinnedSessions,
        pinnedSessionKeys,
        groupOrderKeys: params.sessionListGroupOrderV1?.[PINNED_GROUP_KEY_V1],
        orderingMode,
        resolveSessionRow: params.resolveSessionRow,
    });

    const remainderPruned = pruneOrphanSessionListIndexHeaders(remainder);
    const remainderAfterWorking = workingPlacementMode === 'withinGroups'
        ? applySessionListIndexWorkingPlacementWithinGroups({
            source: remainderPruned,
            options: params.workingPlacement,
            retainedKeys: params.retainWorkingSessionKeys,
            resolveSessionRow: params.resolveSessionRow,
            nowMs: placementNowMs,
        })
        : remainderPruned;
    const remainderAfterAttention = attentionPromotionMode === 'withinGroups'
        ? applySessionListIndexAttentionPromotionWithinGroups({
            source: remainderAfterWorking,
            options: params.attentionPromotion,
            resolveSessionRow: params.resolveSessionRow,
            nowMs: placementNowMs,
        })
        : remainderAfterWorking;
    const remainderFiltered = params.hideInactiveSessions
        ? filterHiddenInactiveSessionListIndexItems(remainderAfterAttention, params.resolveSessionRow)
        : remainderAfterAttention;

    const remainderPresented = applySessionListIndexPresentation(remainderFiltered, {
        enabled: params.presentation.enabled,
        presentation: params.presentation.presentation,
        selectedServerIds: params.presentation.selectedServerIds,
    });

    return [
        ...(attentionPromotion?.attentionItems ?? []),
        ...(workingPlacement?.workingItems ?? []),
        ...(pinnedHeader ? [pinnedHeader, ...pinnedOrdered] : []),
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
    const telemetrySink: VisibleSessionListTelemetrySink = {};
    const result = computeVisibleSessionListIndexUnmeasured(params, telemetrySink);
    const orderingMode = normalizeSessionListOrderingModeV1(params.sessionListOrderingModeV1);
    const effectiveFolderSortMode = resolveEffectiveSessionListFolderSortMode({
        orderingMode,
        folderSortMode: normalizeSessionListFolderSortModeV1(params.sessionListFolderSortModeV1),
    });
    const sourceTelemetry = telemetrySink.sourceTelemetry ?? {
        sessionCount: 0,
        effectiveModeOverrides: 0,
        bucketSortApplied: 0,
        hasNonCustomSessionOrdering: false,
    };
    syncPerformanceTelemetry.recordDuration(
        'sync.sessions.list.visible.compute',
        nowMs() - startedAtMs,
        {
            items: source.length,
            sessions: sourceTelemetry.sessionCount,
            headers: source.length - sourceTelemetry.sessionCount,
            fastPath: result === source ? 1 : 0,
            orderingMode: encodeOrderingModeForTelemetry(orderingMode),
            effectiveFolderSortMode: encodeFolderSortModeForTelemetry(effectiveFolderSortMode),
            effectiveModeOverrides: sourceTelemetry.effectiveModeOverrides,
            bucketSortApplied: sourceTelemetry.bucketSortApplied,
            hideInactive: params.hideInactiveSessions === true ? 1 : 0,
            pins: countPinnedSessionKeys(params.pinnedSessionKeysV1),
            customOrder: countOrderedGroups(params.sessionListGroupOrderV1),
            presentationEnabled: params.presentation.enabled === true ? 1 : 0,
            storageFilter: params.storageFilterApplied === true ? 1 : 0,
            attentionPromotionEnabled: normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode) === 'off' ? 0 : 1,
            attentionPromotionGlobal: normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode) === 'global' ? 1 : 0,
            attentionPromotionWithinGroups: normalizeSessionListAttentionPromotionMode(params.attentionPromotion?.mode) === 'withinGroups' ? 1 : 0,
            workingPlacementEnabled: normalizeSessionListWorkingPlacementMode(params.workingPlacement?.mode) === 'off' ? 0 : 1,
            workingPlacementGlobal: normalizeSessionListWorkingPlacementMode(params.workingPlacement?.mode) === 'global' ? 1 : 0,
            workingPlacementWithinGroups: normalizeSessionListWorkingPlacementMode(params.workingPlacement?.mode) === 'withinGroups' ? 1 : 0,
        },
    );
    return result;
}
