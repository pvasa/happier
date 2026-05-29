import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import renderer, { act } from 'react-test-renderer';

import { makeToolCall, renderScreen } from '@/dev/testkit';
import type { Message } from '@/sync/domains/messages/messageTypes';
import {
    installTranscriptCommonModuleMocks,
    resetTranscriptCommonModuleMockState,
} from './transcriptTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const settings = {
    transcriptGroupingMode: 'linear',
    transcriptGroupToolCalls: true,
    transcriptTurnToolCallsGroupStrategy: 'consecutive_tools',
    toolViewTimelineChromeMode: 'activity_feed',
    sessionThinkingDisplayMode: 'inline',
    sessionThinkingInlinePresentation: 'summary',
    transcriptThinkingPulseStaleMs: 30_000,
} as Record<string, unknown>;

const turnViewSpy = vi.fn();
const turnViewWithCommonSpy = vi.fn();
const toolCallsGroupRowSpy = vi.fn();
const toolCallsGroupRowWithCommonSpy = vi.fn();
const messageViewSpy = vi.fn();
const messageViewWithCommonSpy = vi.fn();
let scrollToIndexSpy: ReturnType<typeof vi.fn> | null = null;

vi.mock('@/sync/sync', () => ({
    sync: {
        getSyncTuning: () => ({
            transcriptFlashListEstimatedItemSize: 120,
        }),
    },
}));

installTranscriptCommonModuleMocks({
    storage: async () => {
        const { createStorageModuleStub } = await import('@/dev/testkit/mocks/storage');
        return createStorageModuleStub({
            useSetting: (key: string) => settings[key] ?? false,
            useSessionForkSupportSource: () => null,
            useSessionMessagesById: () => ({}),
            useSessionMessagesReducerState: () => null,
            useSessionWorkspacePath: () => null,
        });
    },
});

vi.mock('@/hooks/server/useFeatureEnabled', () => ({
    useFeatureEnabled: () => false,
}));

vi.mock('@shopify/flash-list', () => ({
    FlashList: React.forwardRef((props: any, ref: any) => {
        scrollToIndexSpy = vi.fn();
        const instance = {
            scrollToIndex: scrollToIndexSpy,
            scrollToOffset: vi.fn(),
            scrollToEnd: vi.fn(),
        };
        if (typeof ref === 'function') ref(instance);
        else if (ref && typeof ref === 'object') ref.current = instance;

        const data = Array.isArray(props.data) ? props.data : [];
        const header =
            props.ListHeaderComponent
                ? (typeof props.ListHeaderComponent === 'function' ? props.ListHeaderComponent() : props.ListHeaderComponent)
                : null;
        const footer =
            props.ListFooterComponent
                ? (typeof props.ListFooterComponent === 'function' ? props.ListFooterComponent() : props.ListFooterComponent)
                : null;

        return React.createElement(
            'FlashList',
            props,
            header,
            data.map((item: any, index: number) => {
                const key =
                    typeof props.keyExtractor === 'function'
                        ? props.keyExtractor(item, index)
                        : (item?.id ?? String(index));
                const child = typeof props.renderItem === 'function' ? props.renderItem({ item, index }) : null;
                return React.createElement('FlashListItem', { key }, child);
            }),
            footer,
        );
    }),
}));

vi.mock('@/components/sessions/transcript/MessageView', () => ({
    MessageView: (props: any) => {
        messageViewSpy(props);
        return React.createElement('MessageView', props);
    },
    MessageViewWithSessionCommon: (props: any) => {
        messageViewWithCommonSpy(props);
        return React.createElement('MessageViewWithSessionCommon', props);
    },
}));

vi.mock('@/components/sessions/transcript/turns/TurnView', () => ({
    TurnView: (props: any) => {
        turnViewSpy(props);
        return React.createElement('TurnView', props);
    },
    TurnViewWithSessionCommon: (props: any) => {
        turnViewWithCommonSpy(props);
        return React.createElement('TurnViewWithSessionCommon', props);
    },
}));

vi.mock('@/components/sessions/transcript/toolCalls/ToolCallsGroupRow', () => ({
    ToolCallsGroupRow: (props: any) => {
        toolCallsGroupRowSpy(props);
        return React.createElement('ToolCallsGroupRow', props);
    },
    ToolCallsGroupRowWithSessionCommon: (props: any) => {
        toolCallsGroupRowWithCommonSpy(props);
        return React.createElement('ToolCallsGroupRowWithSessionCommon', props);
    },
}));

describe('ChainTranscriptList presentation parity', () => {
    beforeEach(() => {
        vi.resetModules();
        resetTranscriptCommonModuleMockState();
        settings.transcriptGroupingMode = 'linear';
        settings.transcriptGroupToolCalls = true;
        settings.transcriptTurnToolCallsGroupStrategy = 'consecutive_tools';
        settings.toolViewTimelineChromeMode = 'activity_feed';
        settings.sessionThinkingDisplayMode = 'inline';
        settings.sessionThinkingInlinePresentation = 'summary';
        settings.transcriptThinkingPulseStaleMs = 30_000;
        turnViewSpy.mockReset();
        turnViewWithCommonSpy.mockReset();
        toolCallsGroupRowSpy.mockReset();
        toolCallsGroupRowWithCommonSpy.mockReset();
        messageViewSpy.mockReset();
        messageViewWithCommonSpy.mockReset();
        scrollToIndexSpy = null;
    });

    it('renders linear messages through parent-provided transcript session common', async () => {
        settings.transcriptGroupToolCalls = false;
        settings.toolViewTimelineChromeMode = 'cards';
        settings.transcriptMessageTimestampDisplayMode = 'always';

        const { ChainTranscriptList } = await import('./ChainTranscriptList');

        const agentMessage: Message = {
            kind: 'agent-text',
            id: 'agent-1',
            localId: null,
            createdAt: 1,
            text: 'Done',
            isThinking: false,
        };

        await renderScreen(React.createElement(ChainTranscriptList, {
            sessionId: 's1',
            messages: [agentMessage],
            metadata: null,
            interaction: { canSendMessages: true, canApprovePermissions: true, disableToolNavigation: true },
        }));

        expect(messageViewSpy).not.toHaveBeenCalled();
        expect(messageViewWithCommonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 's1',
                message: expect.objectContaining({ id: 'agent-1' }),
                messageDisplayCommon: expect.objectContaining({
                    transcriptMessageTimestampDisplayMode: 'always',
                }),
                toolChromeCommon: expect.objectContaining({
                    toolViewTimelineChromeMode: 'cards',
                }),
            }),
        );
    });

    it('groups consecutive tool calls the same way as the main transcript when grouping is enabled', async () => {
        const { ChainTranscriptList } = await import('./ChainTranscriptList');

        const toolMessageOne: Message = {
            kind: 'tool-call',
            id: 'tool-msg-1',
            localId: null,
            createdAt: 1,
            tool: makeToolCall({ id: 'tool-1', name: 'Read', input: { file: 'a.ts' }, createdAt: 1 }),
            children: [],
        };
        const toolMessageTwo: Message = {
            kind: 'tool-call',
            id: 'tool-msg-2',
            localId: null,
            createdAt: 2,
            tool: makeToolCall({ id: 'tool-2', name: 'Read', input: { file: 'b.ts' }, createdAt: 2 }),
            children: [],
        };

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(React.createElement(ChainTranscriptList, {
                    sessionId: 's1',
                    messages: [toolMessageOne, toolMessageTwo],
                    metadata: null,
                    interaction: { canSendMessages: true, canApprovePermissions: true, disableToolNavigation: true },
                }))).tree;

        expect(toolCallsGroupRowSpy).not.toHaveBeenCalled();
        expect(toolCallsGroupRowWithCommonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                sessionId: 's1',
                toolMessageIds: ['tool-msg-1', 'tool-msg-2'],
                toolChromeCommon: expect.objectContaining({
                    toolViewTimelineChromeMode: 'activity_feed',
                }),
            }),
        );
        expect(messageViewSpy).not.toHaveBeenCalled();
    });

    it('uses turn layout in tool transcripts when transcript layout is set to turns', async () => {
        settings.transcriptGroupingMode = 'turns';

        const { ChainTranscriptList } = await import('./ChainTranscriptList');

        const userMessage: Message = {
            kind: 'user-text',
            id: 'user-1',
            localId: null,
            createdAt: 1,
            text: 'Start a task',
        };
        const toolMessage: Message = {
            kind: 'tool-call',
            id: 'tool-msg-1',
            localId: null,
            createdAt: 2,
            tool: makeToolCall({ id: 'tool-1', name: 'Read', input: { file: 'a.ts' }, createdAt: 2 }),
            children: [],
        };

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(React.createElement(ChainTranscriptList, {
                    sessionId: 's1',
                    messages: [userMessage, toolMessage],
                    metadata: null,
                    interaction: { canSendMessages: true, canApprovePermissions: true, disableToolNavigation: true },
                }))).tree;

        expect(turnViewSpy).not.toHaveBeenCalled();
        expect(turnViewWithCommonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                turn: expect.objectContaining({
                    userMessageId: 'user-1',
                }),
                messageDisplayCommon: expect.objectContaining({
                    sessionThinkingDisplayMode: 'inline',
                }),
            }),
        );
    });

    it('passes forced transcript permission prompts through to turn layouts', async () => {
        settings.transcriptGroupingMode = 'turns';

        const { ChainTranscriptList } = await import('./ChainTranscriptList');

        const userMessage: Message = {
            kind: 'user-text',
            id: 'user-1',
            localId: null,
            createdAt: 1,
            text: 'Start a subagent',
        };

        await renderScreen(React.createElement(ChainTranscriptList, {
                    sessionId: 's1',
                    messages: [userMessage],
                    metadata: null,
                    interaction: { canSendMessages: true, canApprovePermissions: true, disableToolNavigation: true },
                    forcePermissionPromptsInTranscript: true,
                }));

        expect(turnViewWithCommonSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                forcePermissionPromptsInTranscript: true,
            }),
        );
    });

    it('keeps the initial auto-pin when local tool expansion does not change state', async () => {
        const { ChainTranscriptList } = await import('./ChainTranscriptList');

        const toolMessageOne: Message = {
            kind: 'tool-call',
            id: 'tool-msg-1',
            localId: null,
            createdAt: 1,
            tool: makeToolCall({ id: 'tool-1', name: 'Read', input: { file: 'a.ts' }, createdAt: 1 }),
            children: [],
        };
        const toolMessageTwo: Message = {
            kind: 'tool-call',
            id: 'tool-msg-2',
            localId: null,
            createdAt: 2,
            tool: makeToolCall({ id: 'tool-2', name: 'Read', input: { file: 'b.ts' }, createdAt: 2 }),
            children: [],
        };

        const screen = await renderScreen(React.createElement(ChainTranscriptList, {
            sessionId: 's1',
            messages: [toolMessageOne, toolMessageTwo],
            metadata: null,
            interaction: { canSendMessages: true, canApprovePermissions: true, disableToolNavigation: true },
        }));

        const toolRow = screen.tree.root.findByType('ToolCallsGroupRowWithSessionCommon' as any);
        act(() => {
            toolRow.props.onSetExpanded({
                toolCallsGroupId: toolRow.props.toolCallsGroupId,
                toolMessageIds: toolRow.props.toolMessageIds,
                expanded: false,
            });
        });

        const list = screen.tree.root.findByType('FlashList' as any);
        const initialScrollToIndexSpy = scrollToIndexSpy;
        if (!initialScrollToIndexSpy) {
            throw new Error('Expected FlashList ref to provide scrollToIndex');
        }
        act(() => {
            list.props.onLayout({ nativeEvent: { layout: { height: 300 } } });
            list.props.onContentSizeChange(0, 600);
        });

        expect(initialScrollToIndexSpy).toHaveBeenCalledWith(
            expect.objectContaining({
                index: 0,
                animated: false,
                viewPosition: 1,
            }),
        );
    });

});
