import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';
import { selectSessionListRowStateSnapshot } from '@/sync/store/sessionListRowStateSnapshot';
import type {
    SessionListRowModel,
    SessionListRowPresentationSettings,
    SessionListRowSessionItem,
    SessionListRowStateSnapshot,
    SessionListRowStoreState,
} from './sessionListRowModelTypes';
import { buildSessionListRowModel } from './buildSessionListRowModel';
import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { areSessionListRenderablesEqual } from '@/sync/domains/session/listing/sessionListRenderable';
import { formatShortRelativeTimeAt } from '@/utils/time/formatShortRelativeTime';
import { sessionTagKey } from '../sessionTagUtils';

type CacheEntry = Readonly<{
    model: SessionListRowModel;
    inputSignature: string;
    itemSessionRef: SessionListRowSessionItem['session'];
    sessionRef: SessionListRowStateSnapshot['session'];
    renderableRef: SessionListRowStateSnapshot['renderable'];
    messagesRef: SessionListRowStateSnapshot['messages'];
    pendingRef: SessionListRowStateSnapshot['pending'];
}>;

export type SessionListRowModelsCache = {
    entries: Map<string, CacheEntry>;
};

export type BuildSessionListRowModelsInput = Readonly<{
    items: ReadonlyArray<SessionListViewItem>;
    state: SessionListRowStoreState;
    settings: SessionListRowPresentationSettings;
    cache: SessionListRowModelsCache;
}>;

export function createSessionListRowModelsCache(): SessionListRowModelsCache {
    return { entries: new Map() };
}

function isSessionItem(item: SessionListViewItem): item is SessionListRowSessionItem {
    return item.type === 'session';
}

function appendSignaturePart(parts: string[], value: unknown): void {
    const normalized = value == null ? '' : String(value);
    parts.push(`${normalized.length}:${normalized}`);
}

function appendSignatureList(parts: string[], values: readonly unknown[]): void {
    appendSignaturePart(parts, values.length);
    for (const value of values) {
        appendSignaturePart(parts, value);
    }
}

function normalizeServerId(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function resolveRowKey(item: SessionListRowSessionItem): string {
    const sessionId = String(item.session.id);
    const serverId = normalizeServerId(item.serverId);
    return serverId ? sessionTagKey(serverId, sessionId) : sessionId;
}

function buildInputSignature(input: Readonly<{
    item: SessionListRowSessionItem;
    rowKey: string;
    dataIndex: number;
    adjacency: Readonly<{ isFirst: boolean; isLast: boolean; isSingle: boolean }>;
    snapshot: SessionListRowStateSnapshot;
    settings: SessionListRowPresentationSettings;
}>): string {
    const { item, rowKey, settings } = input;
    const parts: string[] = [];
    const rowTags = settings.sessionTagsByKey[rowKey] ?? [];
    const reachableDisplay = settings.reachableSessionDisplayByKey[rowKey];
    appendSignaturePart(parts, rowKey);
    appendSignaturePart(parts, input.dataIndex);
    appendSignaturePart(parts, item.section);
    appendSignaturePart(parts, item.groupKey);
    appendSignaturePart(parts, item.groupKind);
    appendSignaturePart(parts, item.folderId);
    appendSignaturePart(parts, item.folderDepth);
    appendSignaturePart(parts, item.pinned === true ? 1 : 0);
    appendSignaturePart(parts, (item as SessionListRowSessionItem & { selected?: boolean }).selected === true ? 1 : 0);
    appendSignaturePart(parts, item.variant);
    appendSignaturePart(parts, item.serverId);
    appendSignaturePart(parts, item.serverName);
    appendSignaturePart(parts, input.adjacency.isFirst ? 1 : 0);
    appendSignaturePart(parts, input.adjacency.isLast ? 1 : 0);
    appendSignaturePart(parts, input.adjacency.isSingle ? 1 : 0);
    appendSignaturePart(parts, settings.currentUserId);
    appendSignaturePart(parts, settings.density);
    appendSignaturePart(parts, settings.compact ? 1 : 0);
    appendSignaturePart(parts, settings.compactMinimal ? 1 : 0);
    appendSignaturePart(parts, settings.identityDisplay);
    appendSignaturePart(parts, settings.activeColorMode);
    appendSignaturePart(parts, settings.workingIndicatorMode);
    appendSignaturePart(parts, settings.workingTextMode);
    appendSignaturePart(parts, settings.hideInactiveSessions ? 1 : 0);
    appendSignaturePart(parts, settings.showServerBadge ? 1 : 0);
    appendSignaturePart(parts, settings.showPinnedServerBadge ? 1 : 0);
    appendSignaturePart(parts, settings.tagsEnabled ? 1 : 0);
    appendSignatureList(parts, rowTags);
    appendSignatureList(parts, settings.allKnownTags);
    appendSignaturePart(parts, settings.pinnedSessionKeys.includes(rowKey) ? 1 : 0);
    appendSignaturePart(parts, settings.hasMultipleMachines ? 1 : 0);
    appendSignaturePart(parts, reachableDisplay?.workspaceSubtitle);
    appendSignaturePart(parts, reachableDisplay?.machineLabel);
    appendSignaturePart(parts, reachableDisplay?.workspaceSubtitleEllipsizeMode);
    appendSignaturePart(parts, settings.folderViewEnabled ? 1 : 0);
    appendSignaturePart(parts, settings.statusColors.connected);
    appendSignaturePart(parts, settings.statusColors.connecting);
    appendSignaturePart(parts, settings.statusColors.actionRequired);
    appendSignaturePart(parts, settings.statusColors.disconnected);
    appendSignaturePart(parts, settings.statusColors.error);
    appendSignaturePart(parts, settings.statusColors.default);
    appendSignaturePart(parts, input.snapshot.messages?.messagesVersion ?? null);
    appendSignaturePart(parts, input.snapshot.pending?.messages.length ?? null);
    return parts.join('|');
}

function isCachedActivityFresh(model: SessionListRowModel, relativeNowMs: number): boolean {
    const timestamp = model.activity.timestamp;
    if (typeof timestamp !== 'number' || timestamp <= 0) {
        return model.activity.label === '';
    }
    return formatShortRelativeTimeAt(timestamp, relativeNowMs) === model.activity.label;
}

function isCachedRuntimeFresh(model: SessionListRowModel, runtimeNowMs: number): boolean {
    const nextRuntimeFreshnessAtMs = model.nextRuntimeFreshnessAtMs;
    return nextRuntimeFreshnessAtMs === null || runtimeNowMs < nextRuntimeFreshnessAtMs;
}

function resolveCacheSessionRef(snapshot: SessionListRowStateSnapshot): SessionListRowStateSnapshot['session'] {
    return snapshot.renderable ? undefined : snapshot.session;
}

function canReuseItemSession(entry: CacheEntry, item: SessionListRowSessionItem): boolean {
    return entry.itemSessionRef === item.session
        || areSessionListRenderablesEqual(entry.itemSessionRef, item.session);
}

function canReuseEntry(
    entry: CacheEntry | undefined,
    snapshot: SessionListRowStateSnapshot,
    item: SessionListRowSessionItem,
    inputSignature: string,
    settings: SessionListRowPresentationSettings,
): entry is CacheEntry {
    return entry !== undefined
        && entry.inputSignature === inputSignature
        && canReuseItemSession(entry, item)
        && entry.sessionRef === resolveCacheSessionRef(snapshot)
        && entry.renderableRef === snapshot.renderable
        && entry.messagesRef === snapshot.messages
        && entry.pendingRef === snapshot.pending
        && isCachedActivityFresh(entry.model, settings.relativeNowMs)
        && isCachedRuntimeFresh(entry.model, settings.runtimeNowMs);
}

type RowModelTelemetryTotals = {
    sessionRows: number;
    reusedRows: number;
    rebuiltRows: number;
    cacheMisses: number;
    signatureChanges: number;
    itemSessionRefChanges: number;
    sessionRefChanges: number;
    renderableRefChanges: number;
    messagesRefChanges: number;
    pendingRefChanges: number;
    activityFreshnessMisses: number;
    runtimeFreshnessMisses: number;
};

function createRowModelTelemetryTotals(): RowModelTelemetryTotals {
    return {
        sessionRows: 0,
        reusedRows: 0,
        rebuiltRows: 0,
        cacheMisses: 0,
        signatureChanges: 0,
        itemSessionRefChanges: 0,
        sessionRefChanges: 0,
        renderableRefChanges: 0,
        messagesRefChanges: 0,
        pendingRefChanges: 0,
        activityFreshnessMisses: 0,
        runtimeFreshnessMisses: 0,
    };
}

function recordRowModelReuseMiss(
    totals: RowModelTelemetryTotals,
    entry: CacheEntry | undefined,
    snapshot: SessionListRowStateSnapshot,
    item: SessionListRowSessionItem,
    inputSignature: string,
    settings: SessionListRowPresentationSettings,
): void {
    totals.rebuiltRows += 1;
    if (!entry) {
        totals.cacheMisses += 1;
        return;
    }
    if (entry.inputSignature !== inputSignature) totals.signatureChanges += 1;
    if (!canReuseItemSession(entry, item)) totals.itemSessionRefChanges += 1;
    if (entry.sessionRef !== resolveCacheSessionRef(snapshot)) totals.sessionRefChanges += 1;
    if (entry.renderableRef !== snapshot.renderable) totals.renderableRefChanges += 1;
    if (entry.messagesRef !== snapshot.messages) totals.messagesRefChanges += 1;
    if (entry.pendingRef !== snapshot.pending) totals.pendingRefChanges += 1;
    if (!isCachedActivityFresh(entry.model, settings.relativeNowMs)) totals.activityFreshnessMisses += 1;
    if (!isCachedRuntimeFresh(entry.model, settings.runtimeNowMs)) totals.runtimeFreshnessMisses += 1;
}

function recordRowModelBuildTelemetry(
    itemCount: number,
    cacheEntryCount: number,
    nextRuntimeFreshnessAtMs: number | null,
    totals: RowModelTelemetryTotals,
): void {
    if (!syncPerformanceTelemetry.isEnabled()) return;
    syncPerformanceTelemetry.count('ui.sessionsList.rows.modelBuild', {
        items: itemCount,
        nonSessionRows: itemCount - totals.sessionRows,
        sessionRows: totals.sessionRows,
        reusedRows: totals.reusedRows,
        rebuiltRows: totals.rebuiltRows,
        cacheMisses: totals.cacheMisses,
        signatureChanges: totals.signatureChanges,
        itemSessionRefChanges: totals.itemSessionRefChanges,
        sessionRefChanges: totals.sessionRefChanges,
        renderableRefChanges: totals.renderableRefChanges,
        messagesRefChanges: totals.messagesRefChanges,
        pendingRefChanges: totals.pendingRefChanges,
        activityFreshnessMisses: totals.activityFreshnessMisses,
        runtimeFreshnessMisses: totals.runtimeFreshnessMisses,
        cacheEntries: cacheEntryCount,
        hasNextRuntimeFreshness: nextRuntimeFreshnessAtMs === null ? 0 : 1,
    });
}

function resolveAdjacency(
    items: ReadonlyArray<SessionListViewItem>,
    index: number,
): Readonly<{ isFirst: boolean; isLast: boolean; isSingle: boolean }> {
    const item = items[index];
    const groupKey = isSessionItem(item) ? String(item.groupKey ?? '').trim() : '';
    const prev = index > 0 ? items[index - 1] : null;
    const next = index < items.length - 1 ? items[index + 1] : null;
    const prevGroupKey = prev && isSessionItem(prev) ? String(prev.groupKey ?? '').trim() : '';
    const nextGroupKey = next && isSessionItem(next) ? String(next.groupKey ?? '').trim() : '';
    const isFirst = !groupKey || prevGroupKey !== groupKey;
    const isLast = !groupKey || nextGroupKey !== groupKey;
    return {
        isFirst,
        isLast,
        isSingle: isFirst && isLast,
    };
}

export function buildSessionListRowModels(input: BuildSessionListRowModelsInput): Readonly<{
    rows: readonly SessionListRowModel[];
    modelsByRowKey: ReadonlyMap<string, SessionListRowModel>;
    nextRuntimeFreshnessAtMs: number | null;
}> {
    const rows: SessionListRowModel[] = [];
    const modelsByRowKey = new Map<string, SessionListRowModel>();
    let nextRuntimeFreshnessAtMs: number | null = null;
    const telemetryTotals = createRowModelTelemetryTotals();

    for (let index = 0; index < input.items.length; index += 1) {
        const item = input.items[index];
        if (!isSessionItem(item)) continue;
        telemetryTotals.sessionRows += 1;
        const snapshot = selectSessionListRowStateSnapshot(input.state, {
            sessionId: item.session.id,
            serverId: item.serverId,
        });
        const adjacency = resolveAdjacency(input.items, index);
        const rowKey = resolveRowKey(item);
        const inputSignature = buildInputSignature({
            item,
            rowKey,
            dataIndex: index,
            adjacency,
            snapshot,
            settings: input.settings,
        });
        const cached = input.cache.entries.get(rowKey);
        const canReuseCachedModel = canReuseEntry(cached, snapshot, item, inputSignature, input.settings);
        const model = canReuseCachedModel
            ? cached.model
            : buildSessionListRowModel({
                item,
                state: snapshot,
                dataIndex: index,
                isFirst: adjacency.isFirst,
                isLast: adjacency.isLast,
                isSingle: adjacency.isSingle,
                settings: input.settings,
            });
        if (canReuseCachedModel) {
            telemetryTotals.reusedRows += 1;
        } else {
            recordRowModelReuseMiss(telemetryTotals, cached, snapshot, item, inputSignature, input.settings);
        }
        input.cache.entries.set(rowKey, {
            model,
            inputSignature,
            itemSessionRef: item.session,
            sessionRef: resolveCacheSessionRef(snapshot),
            renderableRef: snapshot.renderable,
            messagesRef: snapshot.messages,
            pendingRef: snapshot.pending,
        });
        rows.push(model);
        modelsByRowKey.set(model.rowKey, model);
        const freshnessAt = model.nextRuntimeFreshnessAtMs;
        if (freshnessAt !== null) {
            nextRuntimeFreshnessAtMs = nextRuntimeFreshnessAtMs === null
                ? freshnessAt
                : Math.min(nextRuntimeFreshnessAtMs, freshnessAt);
        }
    }

    recordRowModelBuildTelemetry(
        input.items.length,
        input.cache.entries.size,
        nextRuntimeFreshnessAtMs,
        telemetryTotals,
    );

    return {
        rows,
        modelsByRowKey,
        nextRuntimeFreshnessAtMs,
    };
}
