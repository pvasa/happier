import type { SessionInitialPromptV1 } from '@/sync/domains/sessionInitialPrompt/sessionInitialPromptV1';

import { applySendToSessionTemplate } from './applySendToSessionTemplate';
import { formatSelectedMessagesForClipboard } from './formatSelectedMessagesForClipboard';
import type { TranscriptBulkCopyFormat } from './_types';
import type { TranscriptSelectionToolbarMessage } from './TranscriptSelectionToolbar';

export type SendTranscriptSelectionChooseDestinationInput = Readonly<{
    sourceSessionId: string;
    sourceServerId: string;
    previewText: string;
}>;

export type SendTranscriptSelectionDestination = Readonly<{
    sessionId: string;
    serverId: string;
}>;

export type SendTranscriptSelectionWriteInitialPromptInput = Readonly<{
    destinationSessionId: string;
    serverId: string;
    prompt: SessionInitialPromptV1;
}>;

export async function sendTranscriptSelectionToSession(params: Readonly<{
    sourceSessionId: string;
    sourceServerId: string;
    sourceSessionName: string | null;
    selectedMessages: ReadonlyArray<TranscriptSelectionToolbarMessage>;
    bulkCopyFormat: TranscriptBulkCopyFormat;
    template: string;
    roleLabels: Readonly<{ user: string; assistant: string }>;
    nowMs: () => number;
    chooseDestinationSessionId: (input: SendTranscriptSelectionChooseDestinationInput) => Promise<SendTranscriptSelectionDestination | null>;
    writeInitialPrompt: (input: SendTranscriptSelectionWriteInitialPromptInput) => Promise<void>;
    navigateToSession: (input: Readonly<{ sessionId: string; serverId: string }>) => void;
}>): Promise<boolean> {
    if (params.selectedMessages.length === 0) return false;
    const formattedMessages = formatSelectedMessagesForClipboard(params.selectedMessages, {
        format: params.bulkCopyFormat,
        roleLabels: params.roleLabels,
    });
    const promptText = applySendToSessionTemplate({
        template: params.template,
        formattedMessages,
        selectedCount: params.selectedMessages.length,
        sourceSessionName: params.sourceSessionName,
    });
    if (!promptText.trim()) return false;

    const destination = await params.chooseDestinationSessionId({
        sourceSessionId: params.sourceSessionId,
        sourceServerId: params.sourceServerId,
        previewText: promptText,
    });
    if (!destination) return false;

    const prompt: SessionInitialPromptV1 = {
        v: 1,
        text: promptText,
        mode: 'append',
        createdAtMs: params.nowMs(),
        sourceMessageIds: params.selectedMessages.map((message) => message.id),
        sourceSessionId: params.sourceSessionId,
    };

    await params.writeInitialPrompt({
        destinationSessionId: destination.sessionId,
        serverId: destination.serverId,
        prompt,
    });
    params.navigateToSession({ sessionId: destination.sessionId, serverId: destination.serverId });
    return true;
}
