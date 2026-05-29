import { describe, expect, it, vi } from 'vitest';

import { sendTranscriptSelectionToSession } from './sendTranscriptSelectionToSession';
import type { SendTranscriptSelectionDestination } from './sendTranscriptSelectionToSession';
import type { TranscriptSelectionToolbarMessage } from './TranscriptSelectionToolbar';

const selectedMessages: ReadonlyArray<TranscriptSelectionToolbarMessage> = [
    { id: 'm1', role: 'user', text: 'Question' },
    { id: 'm2', role: 'assistant', text: 'Answer' },
];

describe('sendTranscriptSelectionToSession', () => {
    it('formats messages, applies the template, writes sessionInitialPromptV1, and navigates to the destination session', async () => {
        const chooseDestinationSessionId = vi.fn(async (): Promise<SendTranscriptSelectionDestination> => ({ sessionId: 'dest', serverId: 'server-b' }));
        const writeInitialPrompt = vi.fn(async () => undefined);
        const navigateToSession = vi.fn();

        const result = await sendTranscriptSelectionToSession({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            sourceSessionName: 'Source session',
            selectedMessages,
            bulkCopyFormat: 'markdown_labeled',
            template: 'Review these from {{SOURCE_SESSION_NAME}}:\n\n{{MESSAGES}}',
            roleLabels: { user: 'You', assistant: 'Assistant' },
            nowMs: () => 123,
            chooseDestinationSessionId,
            writeInitialPrompt,
            navigateToSession,
        });

        expect(result).toBe(true);
        const expectedPromptText = 'Review these from Source session:\n\n**You:**\n\nQuestion\n\n**Assistant:**\n\nAnswer';
        expect(chooseDestinationSessionId).toHaveBeenCalledWith({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            previewText: expectedPromptText,
        });
        expect(writeInitialPrompt).toHaveBeenCalledWith({
            destinationSessionId: 'dest',
            serverId: 'server-b',
            prompt: {
                v: 1,
                text: expectedPromptText,
                mode: 'append',
                createdAtMs: 123,
                sourceMessageIds: ['m1', 'm2'],
                sourceSessionId: 'source',
            },
        });
        expect(navigateToSession).toHaveBeenCalledWith({ sessionId: 'dest', serverId: 'server-b' });
    });

    it('does nothing when the picker is cancelled', async () => {
        const writeInitialPrompt = vi.fn(async () => undefined);
        const navigateToSession = vi.fn();

        const result = await sendTranscriptSelectionToSession({
            sourceSessionId: 'source',
            sourceServerId: 'server-a',
            sourceSessionName: null,
            selectedMessages,
            bulkCopyFormat: 'plain',
            template: '{{MESSAGES}}',
            roleLabels: { user: 'You', assistant: 'Assistant' },
            nowMs: () => 123,
            chooseDestinationSessionId: vi.fn(async () => null),
            writeInitialPrompt,
            navigateToSession,
        });

        expect(result).toBe(false);
        expect(writeInitialPrompt).not.toHaveBeenCalled();
        expect(navigateToSession).not.toHaveBeenCalled();
    });
});
