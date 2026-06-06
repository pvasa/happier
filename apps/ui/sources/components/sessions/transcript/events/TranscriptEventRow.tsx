import * as React from 'react';
import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';

import { Text } from '@/components/ui/text/Text';
import type { AgentEvent } from '@/sync/typesRaw';
import { t } from '@/text';
import { resolveConnectedServiceShortName } from '@/components/settings/connectedServices/model/resolveConnectedServiceDisplayName';
import { resolveConnectedServiceUxDiagnosticPresentation } from '@/components/sessions/connectedServices/diagnostics/connectedServiceUxDiagnostics';

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

function formatConnectedServiceSwitchAttemptFailureText(event: Extract<AgentEvent, { type: 'connected-service-account-switch-attempt' }>): string {
    const diagnosticPresentation = resolveConnectedServiceUxDiagnosticPresentation(event.diagnostic);
    const text = diagnosticPresentation
        ? t(diagnosticPresentation.statusKey)
        : t('connectedServices.authSwitch.switchFailed');
    if (diagnosticPresentation) return text;
    return typeof event.errorCode === 'string' && event.errorCode.trim().length > 0
        ? `${text} (${event.errorCode.trim()})`
        : text;
}

function formatConnectedServiceSwitchAttemptSuccessText(event: Extract<AgentEvent, { type: 'connected-service-account-switch-attempt' }>): string {
    const outcomeAction = event.outcomeAction;
    if (outcomeAction === 'restarted' || (!outcomeAction && event.action === 'restart_requested')) {
        return t('connectedServices.authSwitch.status.restarting');
    }
    if (outcomeAction === 'metadata_updated' || (!outcomeAction && event.action === 'metadata_updated')) {
        return t('connectedServices.authSwitch.status.appliesOnNextResume');
    }
    if (outcomeAction === 'credential_refreshed') {
        return t('connectedServices.authSwitch.confirmAction');
    }
    return t('connectedServices.authSwitch.confirmAction');
}

function resolveConnectedServiceSwitchAttemptOutcome(event: Extract<AgentEvent, { type: 'connected-service-account-switch-attempt' }>):
    | 'failed'
    | 'scheduled_retry'
    | 'succeeded'
    | 'observed'
    | 'terminal' {
    return event.outcome ?? (event.ok ? 'succeeded' : 'failed');
}

function isObservedOnlyConnectedServiceSwitchAttempt(
    event: Extract<AgentEvent, { type: 'connected-service-account-switch-attempt' }>,
    outcome: ReturnType<typeof resolveConnectedServiceSwitchAttemptOutcome>,
): boolean {
    return outcome === 'observed' || event.sessionAdoption === 'observed_only';
}

function formatRuntimeAuthRecoveryText(event: Extract<AgentEvent, { type: 'connected-service-runtime-auth-recovery' }>): string {
    const diagnosticPresentation = resolveConnectedServiceUxDiagnosticPresentation(event.diagnostic);
    if (diagnosticPresentation) return t(diagnosticPresentation.statusKey);
    switch (event.status) {
        case 'retry_scheduled':
            return t('connectedServices.diagnostics.status.recovery_retry_scheduled');
        case 'dead_lettered':
            return t('connectedServices.diagnostics.status.recovery_dead_lettered');
        case 'recovered':
            return t('message.connectedServiceRuntimeAuthRecoveryRecovered');
        case 'cancelled':
            return t('message.connectedServiceRuntimeAuthRecoveryCancelled');
    }
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
            provider: resolveConnectedServiceShortName(props.event.serviceId, t),
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
        const outcome = resolveConnectedServiceSwitchAttemptOutcome(props.event);
        if (outcome === 'failed' || outcome === 'terminal') {
            iconName = 'warning-outline';
            text = formatConnectedServiceSwitchAttemptFailureText(props.event);
        } else if (outcome === 'scheduled_retry') {
            iconName = 'time-outline';
            const diagnosticPresentation = resolveConnectedServiceUxDiagnosticPresentation(props.event.diagnostic);
            text = diagnosticPresentation
                ? t(diagnosticPresentation.statusKey)
                : t('connectedServices.diagnostics.status.recovery_retry_scheduled');
        } else if (isObservedOnlyConnectedServiceSwitchAttempt(props.event, outcome)) {
            iconName = 'information-circle-outline';
            text = formatConnectedServiceSwitchAttemptSuccessText(props.event);
        } else {
            iconName = 'checkmark-circle-outline';
            text = formatConnectedServiceSwitchAttemptSuccessText(props.event);
        }
    } else if (props.event.type === 'connected-service-runtime-auth-recovery') {
        testID = 'transcript-event-connected-service-runtime-auth-recovery';
        if (props.event.status === 'retry_scheduled') {
            iconName = 'time-outline';
        } else if (props.event.status === 'dead_lettered') {
            iconName = 'warning-outline';
        } else if (props.event.status === 'cancelled') {
            iconName = 'close-circle-outline';
        } else {
            iconName = 'checkmark-circle-outline';
        }
        text = formatRuntimeAuthRecoveryText(props.event);
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
