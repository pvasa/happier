import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { Text } from '@/components/ui/text/Text';
import type { AgentEvent } from '@/sync/typesRaw';
import { t } from '@/text';

const EVENT_ICON_SIZE = 18;
const EVENT_SPINNER_SIZE = 20;
const EVENT_ICON_CONTAINER_SIZE = 20;

function formatLimitReachedTime(timestamp: number): string {
    try {
        const date = new Date(timestamp * 1000);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return t('message.unknownTime');
    }
}

function formatQuotaResetTime(timestampMs: number): string {
    try {
        const date = new Date(timestampMs);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch {
        return t('message.unknownTime');
    }
}

function formatConnectedServiceAccountSwitchEndpointLabel(profileId: string | null): string {
    return profileId ?? t('connectedServices.authChip.nativeLabel');
}

function formatUnknownEventDetails(event: AgentEvent): string {
    const details: string[] = [event.type];
    if ('errorCode' in event && typeof event.errorCode === 'string' && event.errorCode.trim().length > 0) {
        details.push(event.errorCode.trim());
    }
    if ('reason' in event && typeof event.reason === 'string' && event.reason.trim().length > 0) {
        details.push(event.reason.trim());
    }
    if ('action' in event && typeof event.action === 'string' && event.action.trim().length > 0) {
        details.push(event.action.trim());
    }
    if ('policy' in event && typeof event.policy === 'string' && event.policy.trim().length > 0) {
        details.push(event.policy.trim());
    }
    return `${t('message.unknownEvent')} (${details.join(' · ')})`;
}

export const TranscriptEventRow = React.memo(function TranscriptEventRow(props: {
    event: AgentEvent;
}) {
    const { theme } = useUnistyles();
    let iconName: React.ComponentProps<typeof Ionicons>['name'] = 'information-circle-outline';
    let text = formatUnknownEventDetails(props.event);
    let isLoading = false;
    let testID: string | undefined;

    if (props.event.type === 'switch') {
        iconName = 'swap-horizontal-outline';
        text = t('message.switchedToMode', { mode: props.event.mode });
    } else if (props.event.type === 'message') {
        iconName = 'information-circle-outline';
        text = props.event.message;
    } else if (props.event.type === 'context-compaction') {
        const isPaused = props.event.phase === 'completed' && props.event.continuation === 'paused';
        testID = `transcript-event-context-compaction-${isPaused ? 'paused' : props.event.phase}`;
        if (props.event.phase === 'started' || props.event.phase === 'progress') {
            isLoading = true;
            text = t('message.contextCompactionStarted');
        } else if (props.event.phase === 'failed') {
            iconName = 'warning-outline';
            text = t('message.contextCompactionFailed');
        } else if (props.event.phase === 'cancelled') {
            iconName = 'close-circle-outline';
            text = t('message.contextCompactionCancelled');
        } else if (isPaused) {
            iconName = 'pause-circle-outline';
            text = t('message.contextCompactionPaused');
        } else {
            iconName = 'checkmark-circle-outline';
            text = t('message.contextCompactionCompleted');
        }
    } else if (props.event.type === 'limit-reached') {
        iconName = 'warning-outline';
        text = t('message.usageLimitUntil', { time: formatLimitReachedTime(props.event.endsAt) });
    } else if (props.event.type === 'connected-service-account-switch') {
        testID = 'transcript-event-connected-service-account-switch';
        iconName = 'swap-horizontal-outline';
        text = t('message.connectedServiceAccountSwitch', {
            from: formatConnectedServiceAccountSwitchEndpointLabel(props.event.fromProfileId),
            to: formatConnectedServiceAccountSwitchEndpointLabel(props.event.toProfileId),
        });
    } else if (props.event.type === 'provider-quota-wait') {
        testID = 'transcript-event-provider-quota-wait';
        iconName = 'time-outline';
        text = t('message.providerQuotaWait', { time: formatQuotaResetTime(props.event.resetAtMs) });
    } else if (props.event.type === 'provider-quota-recovered') {
        testID = 'transcript-event-provider-quota-recovered';
        iconName = 'checkmark-circle-outline';
        text = t('message.providerQuotaRecovered');
    } else if (props.event.type === 'connected-service-account-switch-attempt') {
        testID = 'transcript-event-connected-service-account-switch-attempt';
        if (props.event.ok) {
            iconName = 'checkmark-circle-outline';
            if (props.event.action === 'restart_requested') {
                text = t('connectedServices.authSwitch.status.restarting');
            } else if (props.event.action === 'metadata_updated') {
                text = t('connectedServices.authSwitch.status.appliesOnNextResume');
            } else {
                text = t('connectedServices.authSwitch.confirmAction');
            }
        } else {
            iconName = 'warning-outline';
            text = t('connectedServices.authSwitch.switchFailed');
            if (typeof props.event.errorCode === 'string' && props.event.errorCode.trim().length > 0) {
                text = `${text} (${props.event.errorCode.trim()})`;
            }
        }
    } else if (props.event.type === 'connected-service-account-switch-deferral') {
        testID = 'transcript-event-connected-service-account-switch-deferral';
        iconName = 'time-outline';
        text = props.event.policy === 'defer_until_idle'
            ? t('message.connectedServiceSwitchDeferredIdle')
            : t('message.connectedServiceSwitchDeferred');
    } else if (props.event.type === 'connected-service-account-switch-deferral-completed') {
        testID = 'transcript-event-connected-service-account-switch-deferral-completed';
        const cancellationReasons = new Set(['aborted_after_timeout', 'switch_cancelled', 'session_terminated', 'daemon_shutdown']);
        if (cancellationReasons.has(props.event.reason)) {
            iconName = 'close-circle-outline';
            text = t('message.connectedServiceSwitchDeferralCancelled');
        } else {
            iconName = 'checkmark-circle-outline';
            text = t('message.connectedServiceSwitchDeferralCompleted');
        }
    } else if (props.event.type === 'connected-service-account-switch-deferral-superseded') {
        testID = 'transcript-event-connected-service-account-switch-deferral-superseded';
        iconName = 'swap-horizontal-outline';
        text = t('message.connectedServiceSwitchDeferralSuperseded');
    } else if (props.event.type === 'provider-state-sharing-degraded') {
        testID = 'transcript-event-provider-state-sharing-degraded';
        iconName = 'warning-outline';
        text = t('message.providerStateSharingDegraded');
    }

    const content = (
        <>
            <View style={styles.row}>
                <View style={styles.iconContainer}>
                    {isLoading ? (
                        <ActivitySpinner size={EVENT_SPINNER_SIZE} color={theme.colors.text.secondary} />
                    ) : (
                        <Ionicons name={iconName} size={EVENT_ICON_SIZE} color={theme.colors.text.secondary} />
                    )}
                </View>
                <Text selectable style={styles.text}>
                    {text}
                </Text>
            </View>
        </>
    );

    return (
        <View style={styles.container} testID={testID}>
            {testID === 'transcript-event-connected-service-account-switch' ? (
                <View testID="session-event-connected-service-account-switch">
                    {content}
                </View>
            ) : content}
        </View>
    );
});

const styles = StyleSheet.create((theme) => ({
    container: {
        marginHorizontal: 16,
        paddingBottom: 22,
        alignSelf: 'stretch',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        minWidth: 0,
    },
    iconContainer: {
        width: EVENT_ICON_CONTAINER_SIZE,
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
    },
    text: {
        color: theme.colors.text.secondary,
        fontSize: 14,
        lineHeight: 20,
        fontWeight: '500',
        flexShrink: 1,
    },
}));
