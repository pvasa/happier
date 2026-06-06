import { describe, expect, it } from 'vitest';
import type { TranscriptTurn } from '@/components/sessions/transcript/turnGrouping/buildTranscriptTurns';
import {
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
