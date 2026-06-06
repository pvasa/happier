import { ActivityIndicator } from 'react-native';
import { describe, expect, it } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { rawRecordSchema, type AgentEvent } from '@/sync/typesRaw/schemas';
import { t } from '@/text';

import { TranscriptEventRow } from './TranscriptEventRow';

function parseProtocolValidAgentEvent<T extends AgentEvent>(event: T): T {
    const parsed = rawRecordSchema.safeParse({
        role: 'agent',
        content: {
            type: 'event',
            id: `event-${event.type}`,
            data: event,
        },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('expected protocol-valid transcript event');
    const content = parsed.data.content;
    if (content.type !== 'event') throw new Error('expected event content');
    expect(content.data.type).toBe(event.type);
    if (content.data.type !== event.type) throw new Error('expected matching event type');
    return content.data as T;
}

describe('TranscriptEventRow', () => {
    it('derives started context compaction loading from the phase', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'started',
                    lifecycleId: 'compact_1',
                    provider: 'codex',
                }}
            />,
        );

        expect(screen.findByType(ActivityIndicator)).toBeTruthy();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-started' })).toBeTruthy();
    });

    it('renders completed context compaction events as a persisted event row', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'completed',
                    lifecycleId: 'compact_1',
                    provider: 'codex',
                }}
            />,
        );

        expect(() => screen.findByType(ActivityIndicator)).toThrow();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-completed' })).toBeTruthy();
    });

    it('renders paused context compaction events as a distinct persisted event row', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'completed',
                    lifecycleId: 'pi:context-compaction',
                    provider: 'pi',
                    continuation: 'paused',
                    pauseReason: 'provider-idle-after-compaction',
                }}
            />,
        );

        expect(() => screen.findByType(ActivityIndicator)).toThrow();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-paused' })).toBeTruthy();
    });

    it('renders cancelled context compaction events without loading state', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'context-compaction',
                    phase: 'cancelled',
                    lifecycleId: 'compact_1',
                    provider: 'pi',
                    source: 'provider-event',
                }}
            />,
        );

        expect(() => screen.findByType(ActivityIndicator)).toThrow();
        expect(screen.findByProps({ testID: 'transcript-event-context-compaction-cancelled' })).toBeTruthy();
    });

    it('renders structured connected-service account switch events', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-account-switch',
                    serviceId: 'openai-codex',
                    groupId: 'codex-main',
                    fromProfileId: 'work',
                    toProfileId: 'backup',
                    reason: 'usage_limit',
                    mode: 'hot_apply',
                    effectiveRemainingPct: 12,
                }}
            />,
        );

        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch' })).toBeTruthy();
        expect(screen.findByProps({ testID: 'session-event-connected-service-account-switch' })).toBeTruthy();
    });

    it('renders native connected-service account switch endpoints without leaking null labels', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-account-switch',
                    serviceId: 'openai-codex',
                    groupId: 'happier',
                    fromProfileId: null,
                    toProfileId: 'team',
                    reason: 'manual',
                    mode: 'restart_resume',
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        const nativeLabel = t('connectedServices.authChip.nativeLabel');
        expect(screen.findByProps({ testID: 'session-event-connected-service-account-switch' })).toBeTruthy();
        expect(serialized).toContain(nativeLabel);
        expect(serialized).not.toContain('from null');
    });

    it('renders structured provider quota wait and recovered events', async () => {
        const waiting = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'provider-quota-wait',
                    serviceId: 'openai-codex',
                    profileId: 'work',
                    groupId: 'codex-main',
                    resetAtMs: 1_000,
                    reason: 'usage_limit',
                }}
            />,
        );

        expect(waiting.findByProps({ testID: 'transcript-event-provider-quota-wait' })).toBeTruthy();

        const recovered = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'provider-quota-recovered',
                    serviceId: 'openai-codex',
                    profileId: 'work',
                    groupId: 'codex-main',
                    reason: 'reset_confirmed',
                }}
            />,
        );

        expect(recovered.findByProps({ testID: 'transcript-event-provider-quota-recovered' })).toBeTruthy();
    });

    it('renders connected-service account switch attempt failures with error-code context', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-account-switch-attempt',
                    ok: false,
                    action: 'restart_requested',
                    errorCode: 'provider_session_state_unavailable_for_resume',
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-attempt' })).toBeTruthy();
        expect(serialized).toContain(t('connectedServices.authSwitch.switchFailed'));
        expect(serialized).toContain('provider_session_state_unavailable_for_resume');
    });

    it('renders connected-service account switch attempt diagnostics through the shared presentation mapping', async () => {
        const event = parseProtocolValidAgentEvent({
            type: 'connected-service-account-switch-attempt',
            ok: false,
            action: 'hot_applied',
            attemptedContinuityMode: 'hot_apply',
            outcome: 'failed',
            outcomeAction: 'none',
            errorCode: 'provider_account_adoption_mismatch',
            diagnostic: {
                code: 'provider_account_adoption_mismatch',
                failurePhase: 'post_switch_verification',
                source: 'transcript_switch_attempt',
                serviceId: 'openai-codex',
                agentId: 'codex',
                retryable: true,
                suggestedActions: ['retry', 'open_connected_accounts'],
            },
        });

        const screen = await renderScreen(
            <TranscriptEventRow
                event={event}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-attempt' })).toBeTruthy();
        expect(serialized).toContain(t('connectedServices.diagnostics.status.provider_account_adoption_mismatch'));
        expect(serialized).not.toContain('provider_account_adoption_mismatch)');
    });

    it('uses explicit failed outcome fields before legacy successful switch-attempt actions', async () => {
        const event = parseProtocolValidAgentEvent({
            type: 'connected-service-account-switch-attempt',
            ok: false,
            action: 'hot_applied',
            attemptedContinuityMode: 'hot_apply',
            outcome: 'failed',
            outcomeAction: 'none',
            errorCode: 'hot_apply_failed',
        });

        const screen = await renderScreen(
            <TranscriptEventRow
                event={event}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-attempt' })).toBeTruthy();
        expect(serialized).toContain(t('connectedServices.authSwitch.switchFailed'));
        expect(serialized).toContain('hot_apply_failed');
        expect(serialized).not.toContain(t('connectedServices.authSwitch.confirmAction'));
    });

    it('renders observed-only switch attempts as neutral observation, not successful adoption', async () => {
        const event = parseProtocolValidAgentEvent({
            type: 'connected-service-account-switch-attempt',
            ok: true,
            action: 'metadata_updated',
            attemptedContinuityMode: 'metadata_only',
            outcome: 'observed',
            outcomeAction: 'metadata_updated',
            groupGeneration: 12,
            sessionAdoption: 'observed_only',
        });

        const screen = await renderScreen(
            <TranscriptEventRow
                event={event}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-attempt' })).toBeTruthy();
        expect(serialized).toContain('information-circle-outline');
        expect(serialized).not.toContain('checkmark-circle-outline');
    });

    it('renders runtime-auth recovery retry events through the shared diagnostic presentation', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-runtime-auth-recovery',
                    status: 'retry_scheduled',
                    serviceId: 'openai-codex',
                    profileId: 'work',
                    attempt: 1,
                    nextRetryAtMs: 1_700_000_000_000,
                    diagnostic: {
                        code: 'recovery_retry_scheduled',
                        failurePhase: 'runtime_auth_recovery',
                        source: 'runtime_auth_recovery',
                        serviceId: 'openai-codex',
                        agentId: 'codex',
                        retryable: true,
                        suggestedActions: ['retry', 'open_connected_accounts'],
                    },
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-runtime-auth-recovery' })).toBeTruthy();
        expect(serialized).toContain(t('connectedServices.diagnostics.status.recovery_retry_scheduled'));
        expect(serialized).not.toContain(t('message.unknownEvent'));
    });

    it('renders runtime-auth recovery recovered events without diagnostic data', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-runtime-auth-recovery',
                    status: 'recovered',
                    serviceId: 'openai-codex',
                    profileId: 'work',
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-runtime-auth-recovery' })).toBeTruthy();
        expect(serialized).toContain(t('message.connectedServiceRuntimeAuthRecoveryRecovered'));
        expect(serialized).not.toContain(t('message.unknownEvent'));
    });

    it('renders connected-service account switch deferral events explicitly (not as unknown event)', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-account-switch-deferral',
                    policy: 'defer_until_turn_boundary',
                    awaitingBoundary: true,
                    timeoutMs: 60000,
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-deferral' })).toBeTruthy();
        expect(serialized).not.toContain(t('message.unknownEvent'));
    });

    it('renders connected-service account switch deferral-completed events explicitly (not as unknown event)', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-account-switch-deferral-completed',
                    policy: 'defer_until_turn_boundary',
                    reason: 'completed_at_boundary',
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-deferral-completed' })).toBeTruthy();
        expect(serialized).not.toContain(t('message.unknownEvent'));
    });

    it('renders connected-service account switch deferral-superseded events explicitly (not as unknown event)', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'connected-service-account-switch-deferral-superseded',
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-connected-service-account-switch-deferral-superseded' })).toBeTruthy();
        expect(serialized).not.toContain(t('message.unknownEvent'));
    });

    it('renders provider-state-sharing-degraded events explicitly (not as unknown event)', async () => {
        const screen = await renderScreen(
            <TranscriptEventRow
                event={{
                    type: 'provider-state-sharing-degraded',
                    serviceId: 'openai-codex',
                    requestedStateMode: 'shared',
                    effectiveStateMode: 'isolated',
                    code: 'provider_state_sharing_degraded',
                    reason: 'materialize_failed',
                }}
            />,
        );

        const serialized = JSON.stringify(screen.tree.toJSON());
        expect(screen.findByProps({ testID: 'transcript-event-provider-state-sharing-degraded' })).toBeTruthy();
        expect(serialized).not.toContain(t('message.unknownEvent'));
    });
});
