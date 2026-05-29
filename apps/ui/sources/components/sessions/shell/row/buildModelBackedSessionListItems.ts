import type { SessionListViewItem } from '@/sync/domains/session/listing/sessionListViewData';
import { areSessionListRenderablesEqual } from '@/sync/domains/session/listing/sessionListRenderable';
import { compareSessionFolderWorkspaceRefs } from '@/sync/domains/session/folders';
import type { SessionListRowModel } from './sessionListRowModelTypes';
import { syncPerformanceTelemetry } from '@/sync/runtime/syncPerformanceTelemetry';
import { sessionTagKey } from '../sessionTagUtils';

export type SessionListSessionItem = Extract<SessionListViewItem, { type: 'session' }> & { selected?: boolean };
export type SessionListModelBackedSessionItem = SessionListSessionItem & { rowModel: SessionListRowModel };
export type SessionListRenderedItem = Exclude<SessionListViewItem, { type: 'session' }> | SessionListModelBackedSessionItem;

export type ModelBackedSessionListItemCacheEntry = Readonly<{
    model: SessionListRowModel;
    sourceItem: SessionListSessionItem;
    item: SessionListModelBackedSessionItem;
}>;

export type ModelBackedSessionListItemsCache = Map<string, ModelBackedSessionListItemCacheEntry>;

const EMPTY_SESSION_LIST_RENDERED_ITEMS: ReadonlyArray<SessionListRenderedItem> = Object.freeze([]);
const previousRenderedItemsByCache = new WeakMap<ModelBackedSessionListItemsCache, ReadonlyArray<SessionListRenderedItem>>();

function resolveSessionItemRowKey(item: Extract<SessionListViewItem, { type: 'session' }>): string {
    const serverId = typeof item.serverId === 'string' ? item.serverId.trim() : '';
    const sessionId = String(item.session?.id ?? '').trim();
    return serverId && sessionId ? sessionTagKey(serverId, sessionId) : sessionId;
}

function areRenderedItemsReferenceEqual(
    left: ReadonlyArray<SessionListRenderedItem> | undefined,
    right: ReadonlyArray<SessionListRenderedItem>,
): left is ReadonlyArray<SessionListRenderedItem> {
    if (!left || left.length !== right.length) return false;
    for (let index = 0; index < right.length; index += 1) {
        if (left[index] !== right[index]) return false;
    }
    return true;
}

function areWorkspaceRefsEquivalent(
    left: SessionListSessionItem['workspace'],
    right: SessionListSessionItem['workspace'],
): boolean {
    if (left === right) return true;
    if (!left || !right) return false;
    return compareSessionFolderWorkspaceRefs(left, right);
}

function areSessionItemSourcesEquivalent(
    left: SessionListSessionItem,
    right: SessionListSessionItem,
): boolean {
    if (left === right) return true;
    return areSessionListRenderablesEqual(left.session, right.session)
        && left.section === right.section
        && left.groupKey === right.groupKey
        && left.groupKind === right.groupKind
        && left.folderId === right.folderId
        && left.folderDepth === right.folderDepth
        && Boolean(left.pinned) === Boolean(right.pinned)
        && left.attentionPromotionReason === right.attentionPromotionReason
        && left.workingPlacementReason === right.workingPlacementReason
        && left.variant === right.variant
        && left.serverId === right.serverId
        && left.serverName === right.serverName
        && Boolean(left.selected) === Boolean(right.selected)
        && areWorkspaceRefsEquivalent(left.workspace, right.workspace);
}

function recordModelBackedItemsTelemetry(fields: Readonly<Record<string, number>>): void {
    if (!syncPerformanceTelemetry.isEnabled()) return;
    syncPerformanceTelemetry.count('ui.sessionsList.rows.modelBackedItems', fields);
}

export function buildModelBackedSessionListItems(
    items: ReadonlyArray<SessionListViewItem>,
    rowModels: readonly SessionListRowModel[],
    cache: ModelBackedSessionListItemsCache,
): ReadonlyArray<SessionListRenderedItem> {
    if (items.length === 0) return EMPTY_SESSION_LIST_RENDERED_ITEMS;
    const liveKeys = new Set<string>();
    const nextItems: SessionListRenderedItem[] = [];
    let rowModelIndex = 0;
    let reusedItems = 0;
    let replacedItems = 0;
    let missingModels = 0;
    for (const item of items) {
        if (item.type !== 'session') {
            nextItems.push(item);
            continue;
        }
        const rowModel = rowModels[rowModelIndex];
        rowModelIndex += 1;
        if (!rowModel) {
            missingModels += 1;
            continue;
        }
        const rowKey = rowModel.rowKey || resolveSessionItemRowKey(item);
        liveKeys.add(rowKey);
        const sourceItem = item as SessionListSessionItem;
        const cached = cache.get(rowKey);
        if (cached?.model === rowModel && areSessionItemSourcesEquivalent(cached.sourceItem, sourceItem)) {
            reusedItems += 1;
            nextItems.push(cached.item);
            continue;
        }
        const modelBackedItem: SessionListModelBackedSessionItem = {
            ...sourceItem,
            rowModel,
        };
        cache.set(rowKey, {
            model: rowModel,
            sourceItem,
            item: modelBackedItem,
        });
        replacedItems += 1;
        nextItems.push(modelBackedItem);
    }
    for (const rowKey of Array.from(cache.keys())) {
        if (!liveKeys.has(rowKey)) {
            cache.delete(rowKey);
        }
    }
    const previousOutput = previousRenderedItemsByCache.get(cache);
    const canReuseOutputArray = areRenderedItemsReferenceEqual(previousOutput, nextItems);
    const output: ReadonlyArray<SessionListRenderedItem> = canReuseOutputArray ? previousOutput : nextItems;
    previousRenderedItemsByCache.set(cache, output);
    recordModelBackedItemsTelemetry({
        items: items.length,
        sessionRows: rowModelIndex,
        nonSessionRows: items.length - rowModelIndex,
        reusedItems,
        replacedItems,
        missingModels,
        cacheEntries: cache.size,
        outputArrayReused: canReuseOutputArray ? 1 : 0,
    });
    return output;
}
