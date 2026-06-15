import { ConnectedServiceIdSchema, type SessionContinuationRecoveryIdentityV1 } from '@happier-dev/protocol';

import { createSessionContinuationRecoveryController } from '../continuation/sessionContinuationRecovery';
import { listMatchingRuntimeAuthRecoveryIntents } from '../runtimeAuth/matchRuntimeAuthRecoveryIntent';
import { buildRuntimeAuthRecoveryKey } from '../runtimeAuth/recoveryKey/runtimeAuthRecoveryKey';
import type { RuntimeAuthRecoveryIntent } from '../runtimeAuth/RuntimeAuthRecoveryScheduler';
import type { ProviderOutcomeProofKind } from './providerOutcomeProof';

/**
 * Session-metadata persistence boundary for the continuation recovery state
 * (matches the controller's store contract in sessionContinuationRecovery).
 */
type ContinuationRecoveryStore = Readonly<{
  read: (sessionId: string) => Promise<unknown | null> | unknown | null;
  write: (sessionId: string, state: unknown) => Promise<void> | void;
}>;

type RuntimeAuthRecoveryForProviderActivityProof = Readonly<{
  readForSession: (sessionId: string) => ReadonlyArray<RuntimeAuthRecoveryIntent>;
  markProviderOutcomeProofByKey: (input: Readonly<{
    recoveryKey: string;
    proofKind: ProviderOutcomeProofKind;
  }>) => Promise<unknown>;
}>;

type UsageLimitRecoveryForProviderActivityProof = Readonly<{
  markProviderOutcomeProofForSession: (input: Readonly<{
    sessionId: string;
    proofKind: ProviderOutcomeProofKind;
    serviceId: string;
    profileId?: string | null;
    groupId?: string | null;
  }>) => Promise<unknown>;
}>;

type ScopedProviderActivityRecoveryIdentity = Readonly<{
  recoveryIdentity: SessionContinuationRecoveryIdentityV1;
  source: 'explicit' | 'runtime_auth_intent';
}>;

export type ConnectedServiceProviderActivityProofRecorder = (input: Readonly<{
  sessionId: string;
  recoveryIdentities?: readonly SessionContinuationRecoveryIdentityV1[];
}>) => Promise<void>;

/**
 * REV-1: gate for treating a turn-lifecycle event as `provider_activity` proof.
 * `assistant_message_end` is also emitted by failTurn / ACP turn_failed markers;
 * a FAILED turn (the usage-limit interruption itself) must not clear the very
 * recovery intents it just armed. A missing terminal status (legacy producers)
 * keeps the completed-turn behavior.
 */
export function isProviderActivityTurnLifecycleEvent(
  event: 'prompt_or_steer' | 'task_started' | 'assistant_message_end' | 'turn_cancelled',
  terminalStatus?: 'completed' | 'failed',
): boolean {
  if (event === 'task_started') return true;
  return event === 'assistant_message_end' && terminalStatus !== 'failed';
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPendingRuntimeAuthRecoveryIntent(intent: RuntimeAuthRecoveryIntent): boolean {
  return intent.status === 'waiting'
    || intent.status === 'checking'
    || intent.status === 'resumed_awaiting_proof';
}

function toRuntimeAuthIntentRecoveryIdentity(
  intent: RuntimeAuthRecoveryIntent,
): SessionContinuationRecoveryIdentityV1 | null {
  if (!isPendingRuntimeAuthRecoveryIntent(intent)) return null;
  const serviceId = normalizeOptionalString(intent.serviceId);
  if (!serviceId) return null;
  const profileId = normalizeOptionalString(intent.profileId);
  const groupId = normalizeOptionalString(intent.groupId);
  if (groupId) {
    return {
      serviceId,
      selectionKind: 'group',
      groupId,
      ...(profileId ? { profileId } : {}),
    };
  }
  if (!profileId) return null;
  return {
    serviceId,
    selectionKind: 'profile',
    profileId,
  };
}

function runtimeAuthIdentityDedupeKey(identity: SessionContinuationRecoveryIdentityV1): string {
  return JSON.stringify({
    serviceId: identity.serviceId,
    groupId: identity.groupId ?? null,
    profileId: identity.profileId ?? null,
  });
}

function resolveSinglePendingRuntimeAuthRecoveryIdentity(
  intents: ReadonlyArray<RuntimeAuthRecoveryIntent>,
): SessionContinuationRecoveryIdentityV1 | null {
  const identitiesByKey = new Map<string, SessionContinuationRecoveryIdentityV1>();
  for (const intent of intents) {
    const identity = toRuntimeAuthIntentRecoveryIdentity(intent);
    if (!identity) continue;
    identitiesByKey.set(runtimeAuthIdentityDedupeKey(identity), identity);
  }
  return identitiesByKey.size === 1 ? [...identitiesByKey.values()][0] ?? null : null;
}

/**
 * The `provider_activity` proof PRODUCER (closed outcome-proof union,
 * providerOutcomeProof.ts). Turn-lifecycle provider activity (task_started /
 * assistant_message_end) that matches a recovery identity clears the matching
 * runtime-auth and usage-limit intents directly.
 *
 * RD-REC-2: clearing must NOT require a continuation attempt sitting in
 * `awaiting_provider_activity`. Recoveries with no live attempt (idle session,
 * suppressed replay, `resumePromptMode: off`, provider_context_unavailable)
 * still produce real provider work; the attempt row is presentation, the
 * activity is the proof. The continuation controller is still informed so any
 * awaiting attempt settles, but its observation count no longer gates the
 * scheduler clears.
 */
export function createConnectedServiceProviderActivityProofRecorder(params: Readonly<{
  nowMs?: () => number;
  providerActivityTimeoutMs: number;
  continuationStore: ContinuationRecoveryStore;
  runtimeAuthRecovery?: RuntimeAuthRecoveryForProviderActivityProof | null;
  usageLimitRecovery?: UsageLimitRecoveryForProviderActivityProof | null;
  logDebug?: (message: string, error: unknown) => void;
}>): ConnectedServiceProviderActivityProofRecorder {
  const controller = createSessionContinuationRecoveryController({
    nowMs: params.nowMs ?? (() => Date.now()),
    providerActivityTimeoutMs: params.providerActivityTimeoutMs,
    store: params.continuationStore,
  });

  const clearMatchingRuntimeAuthIntents = async (input: Readonly<{
    sessionId: string;
    recoveryIdentity: SessionContinuationRecoveryIdentityV1;
    serviceId: ReturnType<typeof ConnectedServiceIdSchema.parse>;
  }>): Promise<void> => {
    if (!params.runtimeAuthRecovery) return;
    const serviceId = input.serviceId;
    const intents = params.runtimeAuthRecovery.readForSession(input.sessionId);
    const matches = listMatchingRuntimeAuthRecoveryIntents(intents, {
      serviceId,
      groupId: input.recoveryIdentity.groupId ?? null,
      profileId: input.recoveryIdentity.profileId ?? null,
    });
    await Promise.all(matches.map(async (intent) => {
      await params.runtimeAuthRecovery?.markProviderOutcomeProofByKey({
        recoveryKey: buildRuntimeAuthRecoveryKey({
          sessionId: intent.sessionId,
          serviceId: intent.serviceId,
          profileId: intent.profileId,
          groupId: intent.groupId,
        }),
        proofKind: 'provider_activity',
      });
    }));
  };

  const recordScopedProviderActivity = async (input: Readonly<{
    sessionId: string;
    scopedIdentity: ScopedProviderActivityRecoveryIdentity;
  }>): Promise<void> => {
    const recoveryIdentity = input.scopedIdentity.recoveryIdentity;
    if (input.scopedIdentity.source === 'explicit') {
      await controller.recordProviderActivity({ sessionId: input.sessionId, recoveryIdentity });
    }
    const serviceId = ConnectedServiceIdSchema.safeParse(recoveryIdentity.serviceId);
    if (!serviceId.success) {
      params.logDebug?.(
        '[DAEMON RUN] Skipping connected-service provider-activity proof for invalid service id (non-fatal)',
        serviceId.error,
      );
      return;
    }
    await clearMatchingRuntimeAuthIntents({
      sessionId: input.sessionId,
      recoveryIdentity,
      serviceId: serviceId.data,
    }).catch((error) => {
      params.logDebug?.('[DAEMON RUN] Failed to clear runtime-auth recovery after connected-service provider activity (non-fatal)', error);
    });
    if (input.scopedIdentity.source !== 'explicit') return;
    await params.usageLimitRecovery?.markProviderOutcomeProofForSession({
      sessionId: input.sessionId,
      proofKind: 'provider_activity',
      serviceId: serviceId.data,
      profileId: recoveryIdentity.profileId ?? null,
      groupId: recoveryIdentity.groupId ?? null,
    }).catch((error) => {
      params.logDebug?.('[DAEMON RUN] Failed to clear usage-limit recovery after connected-service provider activity (non-fatal)', error);
    });
  };

  return async (input) => {
    const explicitIdentities = input.recoveryIdentities ?? [];
    if (explicitIdentities.length === 0) {
      await controller.recordProviderActivity({ sessionId: input.sessionId });
      // Daemon respawn/reattach can lose the live connected-service binding while
      // the runtime-auth recovery intent remains durable. When there is exactly
      // one pending durable identity, that intent is the scoped recovery owner.
      // Multiple possible identities stay fail-closed because a generic provider
      // lifecycle event cannot prove which service/account recovered.
      const runtimeAuthIntents = params.runtimeAuthRecovery?.readForSession(input.sessionId) ?? [];
      const runtimeAuthRecoveryIdentity = resolveSinglePendingRuntimeAuthRecoveryIdentity(runtimeAuthIntents);
      if (!runtimeAuthRecoveryIdentity) {
        const possibleIdentityCount = runtimeAuthIntents
          .map(toRuntimeAuthIntentRecoveryIdentity)
          .filter((identity): identity is SessionContinuationRecoveryIdentityV1 => identity !== null)
          .length;
        if (possibleIdentityCount > 1) {
          params.logDebug?.(
            '[DAEMON RUN] Skipping unscoped provider-activity runtime-auth proof because multiple recovery identities are possible',
            { sessionId: input.sessionId, possibleIdentityCount },
          );
        }
        return;
      }
      await recordScopedProviderActivity({
        sessionId: input.sessionId,
        scopedIdentity: {
          recoveryIdentity: runtimeAuthRecoveryIdentity,
          source: 'runtime_auth_intent',
        },
      });
      return;
    }
    for (const recoveryIdentity of explicitIdentities) {
      await recordScopedProviderActivity({
        sessionId: input.sessionId,
        scopedIdentity: {
          recoveryIdentity,
          source: 'explicit',
        },
      });
    }
  };
}
