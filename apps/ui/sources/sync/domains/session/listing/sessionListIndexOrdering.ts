import { buildSessionFolderWorkspaceRefKey } from '@/sync/domains/session/folders/workspaceRefs';

import type { SessionListIndexItem } from './sessionListIndex';
import { normalizeSessionListKeyParts } from './sessionListKeyNormalization';
import { normalizeTrimmedString } from './normalizeTrimmedString';
import { resolveSessionRowForIndexItem, type ResolveSessionListIndexRow } from './sessionListIndexSessionRows';

export type SessionListOrderingModeV1 = 'custom' | 'created' | 'updated';

function compareSessionItemsByOrderingMode(
    a: Extract<SessionListIndexItem, { type: 'session' }>,
    b: Extract<SessionListIndexItem, { type: 'session' }>,
    orderingMode: SessionListOrderingModeV1,
    resolveSessionRow: ResolveSessionListIndexRow,
): number {
    const rowA = resolveSessionRowForIndexItem(a, resolveSessionRow);
    const rowB = resolveSessionRowForIndexItem(b, resolveSessionRow);

    const updatedA = rowA?.updatedAt ?? 0;
    const updatedB = rowB?.updatedAt ?? 0;
    const createdA = rowA?.createdAt ?? 0;
    const createdB = rowB?.createdAt ?? 0;

    if (orderingMode === 'updated' && updatedB !== updatedA) return updatedB - updatedA;
    if (orderingMode === 'created' && createdB !== createdA) return createdB - createdA;
    if (orderingMode === 'custom' && createdB !== createdA) return createdB - createdA;
    if (orderingMode === 'updated' && createdB !== createdA) return createdB - createdA;

    return normalizeTrimmedString(a.sessionId).localeCompare(normalizeTrimmedString(b.sessionId));
}

function isSessionListIndexItemsAlreadyOrderedByOrderingMode(
    source: ReadonlyArray<SessionListIndexItem>,
    orderingMode: SessionListOrderingModeV1,
    resolveSessionRow: ResolveSessionListIndexRow,
): boolean {
    const lastSessionByGroupKey = new Map<string, Extract<SessionListIndexItem, { type: 'session' }>>();

    for (const item of source) {
        if (item.type !== 'session') continue;

        const groupKey = normalizeTrimmedString(item.groupKey);
        if (!groupKey) continue;

        const previous = lastSessionByGroupKey.get(groupKey);
        if (previous && compareSessionItemsByOrderingMode(previous, item, orderingMode, resolveSessionRow) > 0) {
            return false;
        }

        lastSessionByGroupKey.set(groupKey, item);
    }

    return lastSessionByGroupKey.size > 0;
}

export function sortSessionListIndexItemsByOrderingMode(
    source: ReadonlyArray<SessionListIndexItem>,
    orderingMode: SessionListOrderingModeV1,
    resolveSessionRow: ResolveSessionListIndexRow,
): SessionListIndexItem[] {
    if (orderingMode === 'custom') {
        return source as SessionListIndexItem[];
    }

    if (isSessionListIndexItemsAlreadyOrderedByOrderingMode(source, orderingMode, resolveSessionRow)) {
        return source as SessionListIndexItem[];
    }

    const sessionsByGroupKey = new Map<string, Array<Extract<SessionListIndexItem, { type: 'session' }>>>();
    for (const item of source) {
        if (item.type !== 'session') continue;
        const groupKey = normalizeTrimmedString(item.groupKey);
        if (!groupKey) continue;
        if (!sessionsByGroupKey.has(groupKey)) {
            sessionsByGroupKey.set(groupKey, []);
        }
        sessionsByGroupKey.get(groupKey)!.push(item);
    }

    const sortedByGroupKey = new Map<string, Array<Extract<SessionListIndexItem, { type: 'session' }>>>();
    for (const [groupKey, sessions] of sessionsByGroupKey.entries()) {
        if (sessions.length < 2) continue;
        const next = [...sessions].sort((a, b) => compareSessionItemsByOrderingMode(a, b, orderingMode, resolveSessionRow));
        sortedByGroupKey.set(groupKey, next);
    }

    if (sortedByGroupKey.size === 0) {
        return source as SessionListIndexItem[];
    }

    const indicesByGroupKey = new Map<string, number>();
    const out: SessionListIndexItem[] = [];
    let didChange = false;
    for (const item of source) {
        if (item.type !== 'session') {
            out.push(item);
            continue;
        }
        const groupKey = normalizeTrimmedString(item.groupKey);
        const replacementList = groupKey ? sortedByGroupKey.get(groupKey) : undefined;
        if (!replacementList) {
            out.push(item);
            continue;
        }
        const index = indicesByGroupKey.get(groupKey) ?? 0;
        const replacement = replacementList[index] ?? item;
        if (replacement !== item) {
            didChange = true;
        }
        out.push(replacement);
        indicesByGroupKey.set(groupKey, index + 1);
    }

    return didChange ? out : (source as SessionListIndexItem[]);
}

export function reorderSessionListIndexSessionItemsByKeys(
    items: ReadonlyArray<Extract<SessionListIndexItem, { type: 'session' }>>,
    keys: ReadonlyArray<string> | undefined,
): Array<Extract<SessionListIndexItem, { type: 'session' }>> {
    if (!keys || keys.length === 0 || items.length < 2) {
        return [...items];
    }

    const byKey = new Map<string, Extract<SessionListIndexItem, { type: 'session' }>>();
    for (const item of items) {
        const key = normalizeSessionListKeyParts(item.serverId, item.sessionId).sessionKey;
        if (key) byKey.set(key, item);
    }

    const out: Array<Extract<SessionListIndexItem, { type: 'session' }>> = [];
    const used = new Set<Extract<SessionListIndexItem, { type: 'session' }>>();

    for (const key of keys) {
        const normalized = typeof key === 'string' ? key.trim() : '';
        if (!normalized) continue;
        const found = byKey.get(normalized);
        if (found && !used.has(found)) {
            out.push(found);
            used.add(found);
        }
    }

    for (const item of items) {
        if (!used.has(item)) out.push(item);
    }

    return out;
}

function buildFolderOrderKey(folderIdRaw: unknown): string | null {
    const folderId = typeof folderIdRaw === 'string' ? folderIdRaw.trim() : '';
    return folderId ? `folder:${folderId}` : null;
}

function buildListItemOrderKey(item: SessionListIndexItem): string | null {
    if (item.type === 'session') {
        return normalizeSessionListKeyParts(item.serverId, item.sessionId).sessionKey;
    }
    if (item.headerKind === 'folder') {
        return buildFolderOrderKey(item.folderId);
    }
    return null;
}

function readFolderDepth(item: SessionListIndexItem): number {
    const depth = item.folderDepth;
    return typeof depth === 'number' && Number.isFinite(depth) ? Math.max(0, Math.trunc(depth)) : 0;
}

function buildFolderRootGroupKey(item: Extract<SessionListIndexItem, { type: 'header' }>): string | null {
    if (!item.workspace) return null;
    const serverId = String(item.serverId ?? item.workspace.serverId ?? 'local').trim() || 'local';
    return `folder:${serverId}:${buildSessionFolderWorkspaceRefKey(item.workspace)}:root`;
}

function resolveFolderParentGroupKeyFromVisibleItems(params: Readonly<{
    items: ReadonlyArray<SessionListIndexItem>;
    itemIndex: number;
    folder: Extract<SessionListIndexItem, { type: 'header' }>;
}>): string | null {
    const depth = readFolderDepth(params.folder);
    if (depth <= 0) return buildFolderRootGroupKey(params.folder);
    for (let index = params.itemIndex - 1; index >= 0; index -= 1) {
        const candidate = params.items[index];
        if (candidate?.type !== 'header' || candidate.headerKind !== 'folder') continue;
        if (readFolderDepth(candidate) < depth) {
            return String(candidate.groupKey ?? '').trim() || null;
        }
    }
    return buildFolderRootGroupKey(params.folder);
}

function isInsideFolderBlock(item: SessionListIndexItem, folderDepth: number): boolean {
    if (item.type === 'session') {
        return readFolderDepth(item) > folderDepth;
    }
    return item.headerKind === 'folder' && readFolderDepth(item) > folderDepth;
}

function findFolderBlockEnd(items: ReadonlyArray<SessionListIndexItem>, startIndex: number, folderDepth: number): number {
    let cursor = startIndex + 1;
    while (cursor < items.length && isInsideFolderBlock(items[cursor]!, folderDepth)) {
        cursor += 1;
    }
    return cursor;
}

type ChildOrderEntry = Readonly<{ key: string; start: number; end: number }>;

function collectDirectChildOrderEntries(items: ReadonlyArray<SessionListIndexItem>, groupKey: string): ChildOrderEntry[] {
    const entries: ChildOrderEntry[] = [];
    for (let index = 0; index < items.length; index += 1) {
        const item = items[index]!;
        if (item.type === 'session') {
            if (item.groupKey !== groupKey) continue;
            const key = buildListItemOrderKey(item);
            if (key) entries.push({ key, start: index, end: index + 1 });
            continue;
        }

        if (item.headerKind !== 'folder') continue;
        if (resolveFolderParentGroupKeyFromVisibleItems({ items, itemIndex: index, folder: item }) !== groupKey) continue;
        const key = buildListItemOrderKey(item);
        if (!key) continue;
        const end = findFolderBlockEnd(items, index, readFolderDepth(item));
        entries.push({ key, start: index, end });
        index = end - 1;
    }
    return entries;
}

function reorderEntriesByKeys(entries: ReadonlyArray<ChildOrderEntry>, keys: ReadonlyArray<string>): ChildOrderEntry[] {
    const byKey = new Map(entries.map((entry) => [entry.key, entry]));
    const used = new Set<ChildOrderEntry>();
    const out: ChildOrderEntry[] = [];
    for (const key of keys) {
        const normalized = typeof key === 'string' ? key.trim() : '';
        if (!normalized) continue;
        const found = byKey.get(normalized);
        if (found && !used.has(found)) {
            out.push(found);
            used.add(found);
        }
    }
    for (const entry of entries) {
        if (!used.has(entry)) out.push(entry);
    }
    return out;
}

function applyMixedChildOrderingForGroup(
    source: ReadonlyArray<SessionListIndexItem>,
    groupKey: string,
    keys: ReadonlyArray<string>,
): SessionListIndexItem[] {
    if (!keys.some((key) => typeof key === 'string' && key.startsWith('folder:'))) {
        return source as SessionListIndexItem[];
    }
    const entries = collectDirectChildOrderEntries(source, groupKey);
    if (entries.length < 2) {
        return source as SessionListIndexItem[];
    }
    const reordered = reorderEntriesByKeys(entries, keys);
    if (reordered.every((entry, index) => entry === entries[index])) {
        return source as SessionListIndexItem[];
    }

    const firstEntry = entries[0]!;
    const lastEntry = entries[entries.length - 1]!;
    return [
        ...source.slice(0, firstEntry.start),
        ...reordered.flatMap((entry) => source.slice(entry.start, entry.end)),
        ...source.slice(lastEntry.end),
    ];
}

function applyMixedChildOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
): SessionListIndexItem[] {
    let out = source as SessionListIndexItem[];
    for (const [groupKeyRaw, keys] of Object.entries(orderByGroupKey)) {
        const groupKey = String(groupKeyRaw ?? '').trim();
        if (!groupKey || !keys || keys.length === 0) continue;
        out = applyMixedChildOrderingForGroup(out, groupKey, keys);
    }
    return out;
}

function applySessionOnlyGroupOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
): SessionListIndexItem[] {
    const sessionsByGroup = new Map<string, Array<Extract<SessionListIndexItem, { type: 'session' }>>>();

    for (const item of source) {
        if (item.type !== 'session') continue;
        const groupKey = typeof item.groupKey === 'string' ? item.groupKey : '';
        if (!groupKey) continue;
        if (!sessionsByGroup.has(groupKey)) sessionsByGroup.set(groupKey, []);
        sessionsByGroup.get(groupKey)!.push(item);
    }

    const reorderedByGroup = new Map<string, Array<Extract<SessionListIndexItem, { type: 'session' }>>>();
    for (const [groupKey, items] of sessionsByGroup.entries()) {
        const keys = orderByGroupKey[groupKey];
        if (!keys || keys.length === 0) continue;
        reorderedByGroup.set(groupKey, reorderSessionListIndexSessionItemsByKeys(items, keys));
    }

    if (reorderedByGroup.size === 0) {
        return source as SessionListIndexItem[];
    }

    const indicesByGroup = new Map<string, number>();
    const out: SessionListIndexItem[] = [];
    let didChange = false;
    for (const item of source) {
        if (item.type !== 'session') {
            out.push(item);
            continue;
        }
        const groupKey = typeof item.groupKey === 'string' ? item.groupKey : '';
        const replacementList = reorderedByGroup.get(groupKey);
        if (!replacementList) {
            out.push(item);
            continue;
        }
        const index = indicesByGroup.get(groupKey) ?? 0;
        const replacement = replacementList[index] ?? item;
        if (replacement !== item) didChange = true;
        out.push(replacement);
        indicesByGroup.set(groupKey, index + 1);
    }

    return didChange ? out : (source as SessionListIndexItem[]);
}

export function applySessionListIndexGroupOrdering(
    source: ReadonlyArray<SessionListIndexItem>,
    orderByGroupKey: Readonly<Record<string, ReadonlyArray<string> | undefined>>,
): SessionListIndexItem[] {
    const sessionOrdered = applySessionOnlyGroupOrdering(source, orderByGroupKey);
    return applyMixedChildOrdering(sessionOrdered, orderByGroupKey);
}
