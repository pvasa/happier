import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import type { Message } from '@/sync/domains/messages/messageTypes';
import type { PendingMessage } from '@/sync/domains/state/storageTypes';
import { getStorage } from '@/sync/domains/state/storageStore';
import type { SessionListViewItem } from '@/sync/domains/state/storage';

import { sessionTagKey } from './sessionTagUtils';

const EMPTY_SEARCH_TEXT_BY_SESSION_KEY: Readonly<Record<string, string>> = Object.freeze({});

function readMessageText(message: Message): string | null {
    if (message.kind === 'user-text') {
        return message.displayText ?? message.text;
    }
    if (message.kind === 'agent-text') return message.text;
    if (message.kind === 'tool-call') {
        return message.tool.description ?? null;
    }
    return null;
}

function appendText(parts: string[], value: string | null | undefined): void {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed.length > 0) parts.push(trimmed);
}

function collectSessionKeys(items: ReadonlyArray<SessionListViewItem>): ReadonlyArray<Readonly<{
    serverId: string;
    sessionId: string;
    key: string;
}>> {
    const keys: Array<Readonly<{ serverId: string; sessionId: string; key: string }>> = [];
    const seen = new Set<string>();
    for (const item of items) {
        if (item.type !== 'session') continue;
        const serverId = String(item.serverId ?? '').trim();
        const sessionId = String(item.session?.id ?? '').trim();
        if (!serverId || !sessionId) continue;
        const key = sessionTagKey(serverId, sessionId);
        if (seen.has(key)) continue;
        seen.add(key);
        keys.push({ serverId, sessionId, key });
    }
    return keys;
}

export function useSessionListSearchTextByKey(
    items: ReadonlyArray<SessionListViewItem>,
    enabled: boolean,
): Readonly<Record<string, string>> {
    const sessionKeys = React.useMemo(() => collectSessionKeys(items), [items]);
    return getStorage()(useShallow((state) => {
        if (!enabled || sessionKeys.length === 0) return EMPTY_SEARCH_TEXT_BY_SESSION_KEY;
        const out: Record<string, string> = {};

        for (const entry of sessionKeys) {
            const parts: string[] = [];
            const committed = state.sessionMessages[entry.sessionId];
            if (committed) {
                const ids = committed.messageIdsOldestFirst;
                const messages = Array.isArray(ids) && ids.length > 0
                    ? ids.map((id) => committed.messagesById[id]).filter((message): message is Message => message != null)
                    : Object.values(committed.messagesById ?? {});
                for (const message of messages) {
                    appendText(parts, readMessageText(message));
                }
            }

            const pending = state.sessionPending[entry.sessionId];
            for (const pendingMessage of (pending?.messages ?? []) as PendingMessage[]) {
                appendText(parts, pendingMessage.displayText ?? pendingMessage.text);
            }
            for (const discardedMessage of (pending?.discarded ?? []) as PendingMessage[]) {
                appendText(parts, discardedMessage.displayText ?? discardedMessage.text);
            }

            if (parts.length > 0) {
                out[entry.key] = parts.join('\n');
            }
        }

        return Object.keys(out).length > 0 ? out : EMPTY_SEARCH_TEXT_BY_SESSION_KEY;
    }));
}
