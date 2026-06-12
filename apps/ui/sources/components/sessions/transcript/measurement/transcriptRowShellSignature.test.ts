import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '@/components/sessions/transcript/turnGrouping/buildTranscriptTurns';
import {
    buildTranscriptRowShellSignature,
    resolveTranscriptItemActiveThinkingMessageId,
    type TranscriptRowShellItem,
} from './transcriptRowShellSignature';

function messageItem(messageId: string): TranscriptRowShellItem {
    return {
        kind: 'message',
        id: messageId,
        messageId,
        createdAt: 1,
        seq: 1,
    };
}

function turnItem(turn: TranscriptTurn): TranscriptRowShellItem {
    return {
        kind: 'turn',
        id: turn.id,
        turn,
    };
}

describe('resolveTranscriptItemActiveThinkingMessageId', () => {
    it('returns the active id only for rows that contain the active thinking message', () => {
        expect(resolveTranscriptItemActiveThinkingMessageId(messageItem('thinking-1'), 'thinking-1')).toBe('thinking-1');
        expect(resolveTranscriptItemActiveThinkingMessageId(messageItem('other'), 'thinking-1')).toBeNull();
        expect(resolveTranscriptItemActiveThinkingMessageId(messageItem('thinking-1'), null)).toBeNull();
    });

    it('recognizes active thinking messages nested inside turn rows', () => {
        const turn: TranscriptTurn = {
            id: 'turn-1',
            userMessageId: 'user-1',
            content: [
                { kind: 'message', messageId: 'agent-1' },
                { kind: 'tool_calls', id: 'tools-1', toolMessageIds: ['tool-1', 'tool-2'] },
            ],
        };

        expect(resolveTranscriptItemActiveThinkingMessageId(turnItem(turn), 'agent-1')).toBe('agent-1');
        expect(resolveTranscriptItemActiveThinkingMessageId(turnItem(turn), 'user-1')).toBe('user-1');
        expect(resolveTranscriptItemActiveThinkingMessageId(turnItem(turn), 'tool-2')).toBe('tool-2');
        expect(resolveTranscriptItemActiveThinkingMessageId(turnItem(turn), 'outside')).toBeNull();
    });

    it('does not mark non-message transcript rows as thinking-active', () => {
        const item: TranscriptRowShellItem = {
            kind: 'tool-calls-group',
            id: 'group-1',
            toolMessageIds: ['tool-1'],
            createdAt: 1,
        };

        expect(resolveTranscriptItemActiveThinkingMessageId(item, 'tool-1')).toBeNull();
    });
});

describe('buildTranscriptRowShellSignature', () => {
    function toolMessage(id: string, input: unknown = { value: id }) {
        return {
            kind: 'tool-call',
            id,
            localId: null,
            createdAt: 1,
            tool: {
                id: `call:${id}`,
                name: 'shell',
                state: 'completed',
                input,
            },
            children: [],
        } as any;
    }

    function buildSignature(params: Readonly<{
        item: TranscriptRowShellItem;
        messagesById: Readonly<Record<string, any>>;
        expandedToolCallsAnchorMessageIds?: ReadonlySet<string>;
    }>) {
        return buildTranscriptRowShellSignature({
            activeThinkingMessageId: null,
            expandedToolCallsAnchorMessageIds: params.expandedToolCallsAnchorMessageIds ?? new Set(),
            forkMessageMetadataById: null,
            getMessageById: (messageId) => params.messagesById[messageId] ?? null,
            groupingMode: 'turns',
            item: params.item,
            latestCommittedActivityKey: null,
            resolveThinkingExpanded: () => false,
            sessionActive: false,
            widthBucket: 'w:400',
            fontScaleKey: 'fs:1',
        });
    }

    it('keeps collapsed large tool groups stable when hidden completed tool details change', () => {
        const toolMessageIds = Array.from({ length: 20 }, (_, index) => `tool-${index + 1}`);
        const item: TranscriptRowShellItem = {
            kind: 'tool-calls-group',
            id: 'tools:large',
            toolMessageIds,
            createdAt: 1,
        };
        const messagesById = Object.fromEntries(toolMessageIds.map((id) => [id, toolMessage(id)]));
        const changedHiddenMessagesById = {
            ...messagesById,
            'tool-1': toolMessage('tool-1', { value: 'hidden changed' }),
        };

        const before = buildSignature({ item, messagesById });
        const after = buildSignature({ item, messagesById: changedHiddenMessagesById });

        expect(after.structuralKey).toBe(before.structuralKey);
        expect(after.expansionKey).toBe(before.expansionKey);
    });

    it('invalidates collapsed large tool groups when visible preview tool details change', () => {
        const toolMessageIds = Array.from({ length: 20 }, (_, index) => `tool-${index + 1}`);
        const item: TranscriptRowShellItem = {
            kind: 'tool-calls-group',
            id: 'tools:large',
            toolMessageIds,
            createdAt: 1,
        };
        const messagesById = Object.fromEntries(toolMessageIds.map((id) => [id, toolMessage(id)]));
        const changedPreviewMessagesById = {
            ...messagesById,
            'tool-20': toolMessage('tool-20', { value: 'preview changed' }),
        };

        const before = buildSignature({ item, messagesById });
        const after = buildSignature({ item, messagesById: changedPreviewMessagesById });

        expect(after.structuralKey).not.toBe(before.structuralKey);
    });

    it('keeps collapsed large tool groups stable inside turn rows when hidden completed tool details change', () => {
        const toolMessageIds = Array.from({ length: 20 }, (_, index) => `tool-${index + 1}`);
        const item: TranscriptRowShellItem = {
            kind: 'turn',
            id: 'turn:tools',
            turn: {
                id: 'turn:tools',
                userMessageId: null,
                content: [{
                    kind: 'tool_calls',
                    id: 'tools:large',
                    toolMessageIds,
                }],
            },
        };
        const messagesById = Object.fromEntries(toolMessageIds.map((id) => [id, toolMessage(id)]));
        const changedHiddenMessagesById = {
            ...messagesById,
            'tool-1': toolMessage('tool-1', { value: 'hidden changed' }),
        };

        const before = buildSignature({ item, messagesById });
        const after = buildSignature({ item, messagesById: changedHiddenMessagesById });

        expect(after.structuralKey).toBe(before.structuralKey);
        expect(after.expansionKey).toBe(before.expansionKey);
    });
});
