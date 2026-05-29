import * as React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { StyleSheet } from 'react-native-unistyles';

import { SelectionList, type SelectionListOption, type SelectionListStep } from '@/components/ui/selectionList';
import { Text } from '@/components/ui/text/Text';
import { useKeyboardHeight } from '@/hooks/ui/useKeyboardHeight';
import type { CustomModalInjectedProps } from '@/modal';
import { useModalCardChrome } from '@/modal/components/card/useModalCardChrome';
import { resolveServerIdForSessionIdFromLocalCache } from '@/sync/runtime/orchestration/serverScopedRpc/resolveServerIdForSessionIdFromLocalCache';
import { useSessions } from '@/sync/domains/state/storage';
import type { Session } from '@/sync/domains/state/storageTypes';
import { t } from '@/text';
import { getSessionName } from '@/utils/sessions/sessionUtils';

import { resolveTranscriptSendToSessionTargets } from './resolveTranscriptSendToSessionTargets';
import {
    resolveTranscriptSendToSessionModalLayout,
    TRANSCRIPT_SEND_TO_SESSION_MODAL_SIZE,
    TRANSCRIPT_SEND_TO_SESSION_MODAL_WIDTH,
} from './resolveTranscriptSendToSessionModalLayout';
import type { SendTranscriptSelectionDestination } from './sendTranscriptSelectionToSession';

export type TranscriptSendToSessionModalProps = CustomModalInjectedProps & Readonly<{
    sourceSessionId: string;
    sourceServerId: string;
    previewText: string;
    onResolve: (destination: SendTranscriptSelectionDestination | null) => void;
}>;

const styles = StyleSheet.create((theme) => ({
    body: {
        flex: 1,
        minHeight: 0,
    },
    subtitle: {
        paddingHorizontal: 16,
        paddingTop: 12,
        paddingBottom: 8,
        color: theme.colors.text.secondary,
        fontSize: 13,
    },
    empty: {
        padding: 16,
        color: theme.colors.text.secondary,
    },
    preview: {
        marginHorizontal: 16,
        marginTop: 8,
        marginBottom: 14,
        padding: 12,
        borderRadius: 14,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: theme.colors.border.default,
        backgroundColor: theme.colors.surface.inset,
        gap: 6,
    },
    previewTitle: {
        color: theme.colors.text.secondary,
        fontSize: 12,
        fontWeight: '600',
        textTransform: 'uppercase',
    },
    previewText: {
        color: theme.colors.text.primary,
        fontSize: 13,
        lineHeight: 18,
    },
}));

type TranscriptSendToSessionTarget = Session & Readonly<{ serverId: string }>;

function getSessionSubtitle(session: Session): string | undefined {
    const metadata = session.metadata;
    if (metadata && typeof metadata === 'object') {
        const path = (metadata as Readonly<Record<string, unknown>>).path;
        if (typeof path === 'string' && path.trim().length > 0) return path.trim();
    }
    return undefined;
}

export const TranscriptSendToSessionModal = React.memo(function TranscriptSendToSessionModal(
    props: TranscriptSendToSessionModalProps,
) {
    const sessions = useSessions() ?? [];
    const windowDimensions = useWindowDimensions();
    const keyboardHeight = useKeyboardHeight();
    const modalLayout = React.useMemo(() => resolveTranscriptSendToSessionModalLayout({
        windowHeight: windowDimensions.height,
        keyboardHeight,
    }), [keyboardHeight, windowDimensions.height]);
    const chrome = React.useMemo(() => ({
        kind: 'card' as const,
        layout: 'fill' as const,
        dimensions: {
            width: TRANSCRIPT_SEND_TO_SESSION_MODAL_WIDTH,
            maxHeightRatio: modalLayout.maxHeightRatio,
            size: TRANSCRIPT_SEND_TO_SESSION_MODAL_SIZE,
        },
    }), [modalLayout.maxHeightRatio]);
    useModalCardChrome(props.setChrome, chrome);

    const sourceServerId = props.sourceServerId.trim();
    const targets = React.useMemo<ReadonlyArray<TranscriptSendToSessionTarget>>(() => {
        const candidates: TranscriptSendToSessionTarget[] = sessions.flatMap((session) => {
            const serverId = (session.serverId ?? resolveServerIdForSessionIdFromLocalCache(session.id) ?? '').trim();
            return serverId ? [{ ...session, serverId }] : [];
        });
        return resolveTranscriptSendToSessionTargets({
            sourceSessionId: props.sourceSessionId,
            sourceServerId,
            sessions: candidates,
        }) as ReadonlyArray<TranscriptSendToSessionTarget>;
    }, [props.sourceSessionId, sessions, sourceServerId]);

    const onResolve = props.onResolve;
    const onClose = props.onClose;
    const options = React.useMemo<ReadonlyArray<SelectionListOption>>(() => targets.map((session) => ({
        id: session.id,
        testID: `transcript-send-to-session-option-${session.id}`,
        label: getSessionName(session),
        subtitle: getSessionSubtitle(session),
        onSelect: () => {
            onResolve({ sessionId: session.id, serverId: session.serverId });
            onClose();
        },
    })), [onClose, onResolve, targets]);

    const rootStep = React.useMemo<SelectionListStep>(() => ({
        id: 'transcript-send-to-session-root',
        title: t('transcript.selection.sendTo.modalTitle'),
        inputPlaceholder: t('transcript.selection.sendTo.searchPlaceholder'),
        emptyStateLabel: t('transcript.selection.sendTo.noResults'),
        sections: [
            {
                kind: 'static',
                id: 'sessions',
                options,
                virtualization: 'auto',
            },
        ],
    }), [options]);

    return (
        <View testID="transcript-send-to-session-modal-body" style={styles.body}>
            <Text style={styles.subtitle}>{t('transcript.selection.sendTo.modalSubtitle')}</Text>
            {options.length > 0 ? (
                <SelectionList
                    testID="transcript-send-to-session-list"
                    rootStep={rootStep}
                    onSelect={(id) => {
                        const selected = targets.find((target) => target.id === id);
                        onResolve(selected ? { sessionId: selected.id, serverId: selected.serverId } : null);
                        onClose();
                    }}
                    onRequestClose={() => {
                        onResolve(null);
                        onClose();
                    }}
                    autoFocusInputOnWeb
                    keyboardHintsEnabled
                    maxHeight={modalLayout.listMaxHeight}
                    heightBehavior="measuredToMaxHeight"
                />
            ) : (
                <Text testID="transcript-send-to-session-empty" style={styles.empty}>
                    {t('transcript.selection.sendTo.noResults')}
                </Text>
            )}
            <View style={styles.preview}>
                <Text style={styles.previewTitle}>{t('transcript.selection.sendTo.preview')}</Text>
                <Text style={styles.previewText} numberOfLines={modalLayout.previewNumberOfLines}>{props.previewText}</Text>
            </View>
        </View>
    );
});
