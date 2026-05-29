import { randomUUID } from 'node:crypto';

import type { SessionStoredMessageContent } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import {
  encryptSessionPayload,
  resolveSessionEncryptionContextFromCredentials,
  resolveSessionStoredContentEncryptionMode,
} from '@/session/transport/encryption/sessionEncryptionContext';
import {
  commitSessionStoredMessage,
  fetchSessionById,
} from '@/session/transport/http/sessionsHttp';

type ConnectedServiceRuntimeSwitchSessionEvent = Readonly<{
  type: 'connected_service_account_switch' | 'connected_service_auth_group_switch';
  serviceId: string;
  groupId: string | null;
  fromProfileId: string | null;
  toProfileId: string | null;
  reason: string;
  mode: ConnectedServiceAccountSwitchMode;
  generation?: number;
}>;

type ConnectedServiceRuntimeSwitchDeferralSessionEvent = Readonly<{
  type: 'connected_service_account_switch_deferred';
  policy: 'defer_until_turn_boundary' | 'defer_until_idle';
  awaitingBoundary: boolean;
  timeoutMs: number;
}>;

type ConnectedServiceRuntimeSwitchDeferralCompletionSessionEvent = Readonly<{
  type: 'connected_service_account_switch_deferral_completed';
  policy: 'defer_until_turn_boundary' | 'defer_until_idle';
  reason: 'completed_at_boundary' | 'aborted_after_timeout' | 'switch_cancelled' | 'session_terminated' | 'daemon_shutdown';
}>;

type ConnectedServiceRuntimeSwitchDeferralSupersededSessionEvent = Readonly<{
  type: 'connected_service_account_switch_deferral_superseded';
  policy?: 'defer_until_turn_boundary' | 'defer_until_idle';
}>;

type ConnectedServiceRuntimeSwitchAttemptSessionEvent = Readonly<{
  type: 'connected_service_account_switch_attempt';
  ok: boolean;
  action: 'restart_requested' | 'hot_applied' | 'metadata_updated';
  errorCode: string | null;
  partialState: 'metadata_may_reference_new_binding' | 'runtime_auth_applied' | 'runtime_auth_partially_applied' | null;
}>;

type ConnectedServiceRuntimeStateSharingDegradedSessionEvent = Readonly<{
  type: 'provider_state_sharing_degraded';
  serviceId: string;
  requestedStateMode: string;
  effectiveStateMode: string;
  code: string;
  reason?: string;
  entryName?: string;
}>;

type TranscriptSwitchReason =
  | 'usage_limit'
  | 'soft_threshold'
  | 'auth_expired'
  | 'account_changed'
  | 'refresh_failure'
  | 'manual';

type ConnectedServiceAccountSwitchMode =
  | 'hot_apply'
  | 'restart_resume'
  | 'spawn_next_turn';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseSwitchMode(value: unknown): ConnectedServiceAccountSwitchMode {
  switch (value) {
    case 'hot_apply':
    case 'restart_resume':
    case 'spawn_next_turn':
      return value;
    default:
      return 'restart_resume';
  }
}

function parseRuntimeSwitchEvent(value: unknown): ConnectedServiceRuntimeSwitchSessionEvent | null {
  const record = asRecord(value);
  if (
    !record
    || (
      record.type !== 'connected_service_account_switch'
      && record.type !== 'connected_service_auth_group_switch'
    )
  ) return null;
  const serviceId = typeof record.serviceId === 'string' ? record.serviceId.trim() : '';
  const rawGroupId = typeof record.groupId === 'string' ? record.groupId.trim() : '';
  const rawFromProfileId = typeof record.fromProfileId === 'string' ? record.fromProfileId.trim() : '';
  const rawToProfileId = typeof record.toProfileId === 'string' ? record.toProfileId.trim() : '';
  const reason = typeof record.reason === 'string' ? record.reason.trim() : '';
  if (!serviceId || (!rawFromProfileId && !rawToProfileId) || !reason) return null;
  const rawGeneration = record.type === 'connected_service_auth_group_switch'
    ? record.toGeneration
    : record.generation;
  const generation = typeof rawGeneration === 'number' && Number.isFinite(rawGeneration)
    ? Math.max(0, Math.trunc(rawGeneration))
    : undefined;
  return {
    type: record.type,
    serviceId,
    groupId: rawGroupId || null,
    fromProfileId: rawFromProfileId || null,
    toProfileId: rawToProfileId || null,
    reason,
    mode: parseSwitchMode(record.mode),
    ...(generation === undefined ? {} : { generation }),
  };
}

function parseDeferralPolicy(value: unknown): 'defer_until_turn_boundary' | 'defer_until_idle' | null {
  return value === 'defer_until_turn_boundary' || value === 'defer_until_idle' ? value : null;
}

function parseRuntimeSwitchDeferralEvent(value: unknown): ConnectedServiceRuntimeSwitchDeferralSessionEvent | null {
  const record = asRecord(value);
  if (!record || record.type !== 'connected_service_account_switch_deferred') return null;
  const policy = parseDeferralPolicy(record.policy);
  if (!policy || typeof record.awaitingBoundary !== 'boolean') return null;
  const timeoutMs = typeof record.timeoutMs === 'number' && Number.isFinite(record.timeoutMs)
    ? Math.max(0, Math.trunc(record.timeoutMs))
    : 0;
  return {
    type: 'connected_service_account_switch_deferred',
    policy,
    awaitingBoundary: record.awaitingBoundary,
    timeoutMs,
  };
}

function parseRuntimeSwitchDeferralCompletionEvent(value: unknown): ConnectedServiceRuntimeSwitchDeferralCompletionSessionEvent | null {
  const record = asRecord(value);
  if (!record || record.type !== 'connected_service_account_switch_deferral_completed') return null;
  const policy = parseDeferralPolicy(record.policy);
  const reason =
    record.reason === 'completed_at_boundary'
    || record.reason === 'aborted_after_timeout'
    || record.reason === 'switch_cancelled'
    || record.reason === 'session_terminated'
    || record.reason === 'daemon_shutdown'
      ? record.reason
      : null;
  if (!policy || !reason) return null;
  return {
    type: 'connected_service_account_switch_deferral_completed',
    policy,
    reason,
  };
}

function parseRuntimeSwitchDeferralSupersededEvent(value: unknown): ConnectedServiceRuntimeSwitchDeferralSupersededSessionEvent | null {
  const record = asRecord(value);
  if (!record || record.type !== 'connected_service_account_switch_deferral_superseded') return null;
  const policy = parseDeferralPolicy(record.policy);
  return {
    type: 'connected_service_account_switch_deferral_superseded',
    ...(policy ? { policy } : {}),
  };
}

function parseRuntimeSwitchAttemptEvent(value: unknown): ConnectedServiceRuntimeSwitchAttemptSessionEvent | null {
  const record = asRecord(value);
  if (!record || record.type !== 'connected_service_account_switch_attempt') return null;
  if (typeof record.ok !== 'boolean') return null;
  const action = record.action === 'restart_requested'
    || record.action === 'hot_applied'
    || record.action === 'metadata_updated'
      ? record.action
      : null;
  if (!action) return null;
  const errorCode = typeof record.errorCode === 'string' && record.errorCode.trim()
    ? record.errorCode.trim()
    : null;
  const partialState = record.partialState === 'metadata_may_reference_new_binding'
    || record.partialState === 'runtime_auth_applied'
    || record.partialState === 'runtime_auth_partially_applied'
      ? record.partialState
      : null;
  return {
    type: 'connected_service_account_switch_attempt',
    ok: record.ok,
    action,
    errorCode,
    partialState,
  };
}

function parseRuntimeStateSharingDegradedEvent(value: unknown): ConnectedServiceRuntimeStateSharingDegradedSessionEvent | null {
  const record = asRecord(value);
  if (!record || record.type !== 'provider_state_sharing_degraded') return null;
  const serviceId = typeof record.serviceId === 'string' ? record.serviceId.trim() : '';
  const requestedStateMode = typeof record.requestedStateMode === 'string' ? record.requestedStateMode.trim() : '';
  const effectiveStateMode = typeof record.effectiveStateMode === 'string' ? record.effectiveStateMode.trim() : '';
  const code = typeof record.code === 'string' ? record.code.trim() : '';
  if (!serviceId || !requestedStateMode || !effectiveStateMode || !code) return null;
  const reason = typeof record.reason === 'string' && record.reason.trim() ? record.reason.trim() : undefined;
  const entryName = typeof record.entryName === 'string' && record.entryName.trim() ? record.entryName.trim() : undefined;
  return {
    type: 'provider_state_sharing_degraded',
    serviceId,
    requestedStateMode,
    effectiveStateMode,
    code,
    ...(reason ? { reason } : {}),
    ...(entryName ? { entryName } : {}),
  };
}

function mapSwitchReason(reason: string): TranscriptSwitchReason | null {
  switch (reason) {
    case 'usage_limit':
    case 'rate_limit':
    case 'capacity':
      return 'usage_limit';
    case 'soft_threshold':
      return 'soft_threshold';
    case 'auth_expired':
    case 'auth_invalid':
    case 'account_disabled':
    case 'permission_denied':
      return 'auth_expired';
    case 'account_changed':
      return 'account_changed';
    case 'refresh_failed':
    case 'refresh_failure':
      return 'refresh_failure';
    case 'manual':
      return 'manual';
    default:
      return null;
  }
}

function buildStoredContent(params: Readonly<{
  credentials: Credentials;
  rawSession: Awaited<ReturnType<typeof fetchSessionById>>;
  payload: unknown;
}>): SessionStoredMessageContent {
  const mode = resolveSessionStoredContentEncryptionMode(params.rawSession ?? undefined);
  if (mode === 'plain') {
    return { t: 'plain', v: params.payload };
  }
  const ctx = resolveSessionEncryptionContextFromCredentials(params.credentials, params.rawSession ?? undefined);
  return {
    t: 'encrypted',
    c: encryptSessionPayload({ ctx, payload: params.payload }),
  };
}

export async function commitConnectedServiceAccountSwitchSessionEvent(params: Readonly<{
  credentials: Credentials;
  sessionId: string;
  event: unknown;
}>): Promise<void> {
  const deferral = parseRuntimeSwitchDeferralEvent(params.event);
  if (deferral) {
    const rawSession = await fetchSessionById({
      token: params.credentials.token,
      sessionId: params.sessionId,
    });
    if (!rawSession) return;
    const eventId = [
      'connected-service-account-switch-deferral',
      deferral.policy,
      deferral.awaitingBoundary ? 'awaiting-boundary' : 'awaiting-idle',
      randomUUID(),
    ].join(':');
    await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: params.sessionId,
      localId: eventId,
      messageRole: 'event',
      content: buildStoredContent({
        credentials: params.credentials,
        rawSession,
        payload: {
          role: 'agent',
          content: {
            type: 'event',
            id: eventId,
            data: {
              type: 'connected-service-account-switch-deferral',
              policy: deferral.policy,
              awaitingBoundary: deferral.awaitingBoundary,
              timeoutMs: deferral.timeoutMs,
            },
          },
        },
      }),
    });
    return;
  }

  const deferralCompletion = parseRuntimeSwitchDeferralCompletionEvent(params.event);
  if (deferralCompletion) {
    const rawSession = await fetchSessionById({
      token: params.credentials.token,
      sessionId: params.sessionId,
    });
    if (!rawSession) return;
    const eventId = [
      'connected-service-account-switch-deferral-completed',
      deferralCompletion.policy,
      deferralCompletion.reason,
      randomUUID(),
    ].join(':');
    await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: params.sessionId,
      localId: eventId,
      messageRole: 'event',
      content: buildStoredContent({
        credentials: params.credentials,
        rawSession,
        payload: {
          role: 'agent',
          content: {
            type: 'event',
            id: eventId,
            data: {
              type: 'connected-service-account-switch-deferral-completed',
              policy: deferralCompletion.policy,
              reason: deferralCompletion.reason,
            },
          },
        },
      }),
    });
    return;
  }

  const superseded = parseRuntimeSwitchDeferralSupersededEvent(params.event);
  if (superseded) {
    const rawSession = await fetchSessionById({
      token: params.credentials.token,
      sessionId: params.sessionId,
    });
    if (!rawSession) return;
    const eventId = [
      'connected-service-account-switch-deferral-superseded',
      superseded.policy ?? 'unknown',
      randomUUID(),
    ].join(':');
    await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: params.sessionId,
      localId: eventId,
      messageRole: 'event',
      content: buildStoredContent({
        credentials: params.credentials,
        rawSession,
        payload: {
          role: 'agent',
          content: {
            type: 'event',
            id: eventId,
            data: {
              type: 'connected-service-account-switch-deferral-superseded',
              ...(superseded.policy ? { policy: superseded.policy } : {}),
            },
          },
        },
      }),
    });
    return;
  }

  const attempt = parseRuntimeSwitchAttemptEvent(params.event);
  if (attempt) {
    const rawSession = await fetchSessionById({
      token: params.credentials.token,
      sessionId: params.sessionId,
    });
    if (!rawSession) return;
    const eventId = [
      'connected-service-account-switch-attempt',
      attempt.ok ? 'ok' : 'failed',
      randomUUID(),
    ].join(':');
    await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: params.sessionId,
      localId: eventId,
      messageRole: 'event',
      content: buildStoredContent({
        credentials: params.credentials,
        rawSession,
        payload: {
          role: 'agent',
          content: {
            type: 'event',
            id: eventId,
            data: {
              type: 'connected-service-account-switch-attempt',
              ok: attempt.ok,
              action: attempt.action,
              ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}),
              ...(attempt.partialState ? { partialState: attempt.partialState } : {}),
            },
          },
        },
      }),
    });
    return;
  }

  const degraded = parseRuntimeStateSharingDegradedEvent(params.event);
  if (degraded) {
    const rawSession = await fetchSessionById({
      token: params.credentials.token,
      sessionId: params.sessionId,
    });
    if (!rawSession) return;
    const eventId = [
      'provider-state-sharing-degraded',
      degraded.serviceId,
      randomUUID(),
    ].join(':');
    await commitSessionStoredMessage({
      token: params.credentials.token,
      sessionId: params.sessionId,
      localId: eventId,
      messageRole: 'event',
      content: buildStoredContent({
        credentials: params.credentials,
        rawSession,
        payload: {
          role: 'agent',
          content: {
            type: 'event',
            id: eventId,
            data: {
              type: 'provider-state-sharing-degraded',
              serviceId: degraded.serviceId,
              requestedStateMode: degraded.requestedStateMode,
              effectiveStateMode: degraded.effectiveStateMode,
              code: degraded.code,
              ...(degraded.reason ? { reason: degraded.reason } : {}),
              ...(degraded.entryName ? { entryName: degraded.entryName } : {}),
            },
          },
        },
      }),
    });
    return;
  }

  const parsed = parseRuntimeSwitchEvent(params.event);
  const reason = parsed ? mapSwitchReason(parsed.reason) : null;
  if (!parsed || !reason) return;

  const rawSession = await fetchSessionById({
    token: params.credentials.token,
    sessionId: params.sessionId,
  });
  if (!rawSession) return;

  const eventId = [
    'connected-service-account-switch',
    parsed.serviceId,
    parsed.groupId ?? 'direct',
    parsed.generation ?? randomUUID(),
  ].join(':');
  const payload = {
    role: 'agent',
    content: {
      type: 'event',
      id: eventId,
      data: {
        type: 'connected-service-account-switch',
        serviceId: parsed.serviceId,
        groupId: parsed.groupId,
        fromProfileId: parsed.fromProfileId,
        toProfileId: parsed.toProfileId,
        reason,
        mode: parsed.mode,
      },
    },
  };

  await commitSessionStoredMessage({
    token: params.credentials.token,
    sessionId: params.sessionId,
    localId: eventId,
    messageRole: 'event',
    content: buildStoredContent({
      credentials: params.credentials,
      rawSession,
      payload,
    }),
  });
}
