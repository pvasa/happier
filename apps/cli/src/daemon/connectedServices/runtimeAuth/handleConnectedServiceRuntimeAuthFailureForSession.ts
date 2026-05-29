import type { TrackedSession } from '@/daemon/types';
import type { ConnectedServiceCredentialRefreshResult } from '../refresh/ConnectedServiceRefreshCoordinator';

import {
  readConnectedServiceChildSelectionsFromEnv,
  type ConnectedServiceChildSelection,
} from '../connectedServiceChildEnvironment';
import { parseConnectedServiceBindingSelections } from '../parseConnectedServicesBindings';
import {
  SESSION_SWITCH_LIMIT_WINDOW_MS,
  type ConnectedServiceAuthGroupSwitchEvent,
  type ConnectedServiceAuthGroupSwitchResult,
} from '../accountGroups/switching/ConnectedServiceAuthGroupSwitchCoordinator';
import { handleConnectedServiceRuntimeAuthFailure } from './handleConnectedServiceRuntimeAuthFailure';
import type { ConnectedServiceRuntimeAuthSwitchAttemptTracker } from './ConnectedServiceRuntimeAuthSwitchAttemptTracker';
import type { ConnectedServiceRuntimeFailureClassification } from './types';
import {
  createConnectedServiceSessionAuthSwitchCore,
  type ConnectedServiceSessionAuthSwitchCore,
} from './connectedServiceSessionAuthSwitchCore';

type RuntimeRecoverySelection =
  | Readonly<{
      kind: 'profile';
      serviceId: string;
      profileId: string;
    }>
  | Readonly<{
      kind: 'group';
      serviceId: string;
      groupId: string;
      activeProfileId?: string;
      fallbackProfileId?: string;
    }>;

type SwitchCoordinatorLike = Parameters<typeof handleConnectedServiceRuntimeAuthFailure>[0]['switchCoordinator'];
type TemporaryThrottleRecoveryLike = NonNullable<
  Parameters<typeof handleConnectedServiceRuntimeAuthFailure>[0]['temporaryThrottleRecovery']
>;
type SwitchAttemptTrackerLike = Pick<
  ConnectedServiceRuntimeAuthSwitchAttemptTracker,
  | 'resolveSwitchesThisTurn'
  | 'recordSwitchResult'
  | 'countRecordedSwitchesInWindow'
  | 'hasFreshCredentialRefreshAttempt'
  | 'recordCredentialRefreshAttempt'
  | 'clearSession'
>;

type RuntimeCredentialRefreshService = Readonly<{
  refreshConnectedServiceCredentialForRuntimeAuthFailure(input: Readonly<{
    serviceId: string;
    profileId: string;
  }>): Promise<ConnectedServiceCredentialRefreshResult>;
}>;

const unavailableSwitchCoordinator: SwitchCoordinatorLike = {
  switchAfterClassifiedFailure: async () => ({
    status: 'no_eligible_member',
    generation: 0,
    groupExhausted: true,
    retryAtMs: null,
    excluded: [],
  }),
};

const defaultSwitchCore = createConnectedServiceSessionAuthSwitchCore();

function normalizeSessionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findTrackedSession(
  children: ReadonlyArray<TrackedSession>,
  sessionId: string,
): TrackedSession | null {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) return null;
  return children.find((child) => normalizeSessionId(child.happySessionId) === normalized) ?? null;
}

function isRuntimeCredentialFailure(classification: ConnectedServiceRuntimeFailureClassification): boolean {
  return classification.kind === 'auth_expired'
    || classification.kind === 'account_changed'
    || classification.kind === 'refresh_failed'
    || classification.kind === 'permission_denied';
}

function isReconnectRequiredRefreshResult(result: ConnectedServiceCredentialRefreshResult): boolean {
  const category = result.diagnostic.category;
  return result.status === 'credential_missing'
    || category === 'invalid_grant'
    || category === 'invalid_client'
    || category === 'provider_401'
    || category === 'provider_403'
    || category === 'missing_refresh_token';
}

function mapChildSelectionToRuntimeRecoverySelection(
  selection: ConnectedServiceChildSelection | null,
): RuntimeRecoverySelection | null {
  if (!selection) return null;
  if (selection.kind === 'profile') {
    return {
      kind: 'profile',
      serviceId: selection.serviceId,
      profileId: selection.profileId,
    };
  }
  return {
    kind: 'group',
    serviceId: selection.serviceId,
    groupId: selection.groupId,
    activeProfileId: selection.activeProfileId,
    fallbackProfileId: selection.fallbackProfileId,
  };
}

function resolveRuntimeRecoverySelection(input: Readonly<{
  canonicalSelection: RuntimeRecoverySelection | null;
  selections: ReadonlyArray<RuntimeRecoverySelection>;
  classification: ConnectedServiceRuntimeFailureClassification;
}>): RuntimeRecoverySelection | null {
  if (input.canonicalSelection?.serviceId === input.classification.serviceId) {
    return input.canonicalSelection;
  }

  const trackedSelection = input.selections.find((candidate) => (
    candidate.serviceId === input.classification.serviceId
  ));
  if (trackedSelection) return trackedSelection;

  const serviceId = normalizeSessionId(input.classification.serviceId);
  const profileId = normalizeSessionId(input.classification.profileId);
  if (!serviceId || !profileId) return null;

  const groupId = normalizeSessionId(input.classification.groupId);
  if (groupId) {
    return {
      kind: 'group',
      serviceId,
      groupId,
      fallbackProfileId: profileId,
    };
  }

  return {
    kind: 'profile',
    serviceId,
    profileId,
  };
}

function isGroupRuntimeRecoverySelection(
  selection: RuntimeRecoverySelection,
): selection is Extract<RuntimeRecoverySelection, Readonly<{ kind: 'group' }>> {
  return selection.kind === 'group';
}

function normalizeNullableProfileId(value: unknown): string | null {
  const normalized = normalizeSessionId(value);
  return normalized.length > 0 ? normalized : null;
}

function emitRuntimeGroupSwitchSessionEvent(input: Readonly<{
  emitSessionEvent?: (sessionId: string, event: unknown) => void;
  sessionId: string;
  selection: Extract<RuntimeRecoverySelection, Readonly<{ kind: 'group' }>>;
  classification: ConnectedServiceRuntimeFailureClassification;
  result: ConnectedServiceAuthGroupSwitchResult;
}>): void {
  if (input.result.status !== 'switched') return;
  const fromProfileId = normalizeNullableProfileId(
    input.classification.profileId
      ?? input.selection.activeProfileId
      ?? input.selection.fallbackProfileId,
  );
  const event = {
    type: 'connected_service_auth_group_switch',
    serviceId: input.selection.serviceId,
    groupId: input.selection.groupId,
    fromProfileId,
    toProfileId: input.result.activeProfileId,
    reason: input.classification.kind,
    ...(input.result.mode ? { mode: input.result.mode } : {}),
    fromGeneration: 0,
    toGeneration: input.result.generation,
    resultStatus: input.result.status,
    success: true,
    latencyMs: 0,
  } satisfies ConnectedServiceAuthGroupSwitchEvent;
  input.emitSessionEvent?.(input.sessionId, event);
}

async function maybeRestartAfterRuntimeGroupSwitch(input: Readonly<{
  tracked: TrackedSession;
  result: ConnectedServiceAuthGroupSwitchResult;
  restartSession?: ((tracked: TrackedSession) => Promise<void> | void) | null;
}>): Promise<void> {
  if (input.result.status !== 'switched') return;
  if (input.result.mode !== 'spawn_next_turn') return;
  await input.restartSession?.(input.tracked);
}

async function maybeRefreshCredentialBeforeRuntimeRecovery(input: Readonly<{
  sessionId: string;
  tracked: TrackedSession;
  classification: ConnectedServiceRuntimeFailureClassification;
  selection: RuntimeRecoverySelection;
  switchAttemptTracker?: SwitchAttemptTrackerLike | null;
  credentialRefreshService?: RuntimeCredentialRefreshService | null;
  restartSession?: ((tracked: TrackedSession) => Promise<void> | void) | null;
}>): Promise<
  | null
  | Readonly<{
      status: 'credential_refreshed';
      result: ConnectedServiceCredentialRefreshResult;
      restartRequested: boolean;
    }>
> {
  if (!input.credentialRefreshService || !isRuntimeCredentialFailure(input.classification)) return null;
  const profileId = normalizeSessionId(
    input.classification.profileId
    ?? (
      input.selection.kind === 'profile'
        ? input.selection.profileId
        : input.selection.activeProfileId ?? input.selection.fallbackProfileId
    )
    ?? '',
  );
  if (!profileId) return null;

  const attempt = {
    sessionId: input.sessionId,
    serviceId: input.selection.serviceId,
    profileId,
    reason: input.classification.kind,
  };
  if (input.switchAttemptTracker?.hasFreshCredentialRefreshAttempt(attempt)) return null;
  input.switchAttemptTracker?.recordCredentialRefreshAttempt(attempt);

  const result = await input.credentialRefreshService.refreshConnectedServiceCredentialForRuntimeAuthFailure({
    serviceId: input.selection.serviceId,
    profileId,
  });
  if (result.status === 'refreshed') {
    await input.restartSession?.(input.tracked);
    return {
      status: 'credential_refreshed',
      result,
      restartRequested: Boolean(input.restartSession),
    };
  }
  if (result.status === 'refresh_failed' && !isReconnectRequiredRefreshResult(result)) {
    return null;
  }
  return null;
}

export async function handleConnectedServiceRuntimeAuthFailureForSession(input: Readonly<{
  getChildren: () => ReadonlyArray<TrackedSession>;
  switchCoordinator: SwitchCoordinatorLike | null;
  switchAttemptTracker?: SwitchAttemptTrackerLike | null;
  switchCore?: ConnectedServiceSessionAuthSwitchCore | null;
  temporaryThrottleRecovery?: TemporaryThrottleRecoveryLike | null;
  credentialRefreshService?: RuntimeCredentialRefreshService | null;
  restartSession?: ((tracked: TrackedSession) => Promise<void> | void) | null;
  emitSessionEvent?: (sessionId: string, event: unknown) => void;
  sessionId: string;
  switchesThisTurn: number;
  classification: ConnectedServiceRuntimeFailureClassification | null;
}>): Promise<
  | Awaited<ReturnType<typeof handleConnectedServiceRuntimeAuthFailure>>
  | Readonly<{
      status: 'credential_refreshed';
      result: ConnectedServiceCredentialRefreshResult;
      restartRequested: boolean;
    }>
  | Readonly<{ status: 'session_not_found' }>
  | Readonly<{
      status: 'switch_coordinator_unavailable';
      blocker: 'CLI has no connected-service auth-group load/commit API in this branch.';
    }>
> {
  const tracked = findTrackedSession(input.getChildren(), input.sessionId);
  if (!tracked) {
    input.switchAttemptTracker?.clearSession(input.sessionId);
    input.switchCore?.clearSession(input.sessionId);
    return { status: 'session_not_found' };
  }
  const classification = input.classification;
  if (!classification) {
    return await handleConnectedServiceRuntimeAuthFailure({
      selection: null,
      classification,
      switchesThisTurn: input.switchesThisTurn,
      switchCoordinator: input.switchCoordinator ?? unavailableSwitchCoordinator,
      temporaryThrottleRecovery: input.temporaryThrottleRecovery ?? null,
    });
  }

  const selections = parseConnectedServiceBindingSelections(tracked.spawnOptions?.connectedServices);
  const canonicalSelection = mapChildSelectionToRuntimeRecoverySelection(
    readConnectedServiceChildSelectionsFromEnv(
      tracked.spawnOptions?.environmentVariables ?? {},
    ).find((candidate) => candidate.serviceId === classification.serviceId) ?? null,
  );
  const selection = resolveRuntimeRecoverySelection({
    canonicalSelection,
    selections,
    classification,
  });
  if (!selection) {
    return await handleConnectedServiceRuntimeAuthFailure({
      sessionId: input.sessionId,
      selection,
      classification,
      switchesThisTurn: input.switchesThisTurn,
      switchCoordinator: input.switchCoordinator ?? unavailableSwitchCoordinator,
      temporaryThrottleRecovery: input.temporaryThrottleRecovery ?? null,
    });
  }

  const switchCore = input.switchCore ?? defaultSwitchCore;
  const result = await switchCore.run({
    sessionId: input.sessionId,
    reason: 'automatic_runtime_failure',
    execute: async () => {
      const refreshed = await maybeRefreshCredentialBeforeRuntimeRecovery({
        sessionId: input.sessionId,
        tracked,
        classification,
        selection,
        switchAttemptTracker: input.switchAttemptTracker ?? null,
        credentialRefreshService: input.credentialRefreshService ?? null,
        restartSession: input.restartSession ?? null,
      });
      if (refreshed) return refreshed;

      if (!isGroupRuntimeRecoverySelection(selection)) {
        if (!input.switchCoordinator) {
          return await handleConnectedServiceRuntimeAuthFailure({
            sessionId: input.sessionId,
            selection,
            classification,
            switchesThisTurn: input.switchesThisTurn,
            switchCoordinator: unavailableSwitchCoordinator,
            temporaryThrottleRecovery: input.temporaryThrottleRecovery ?? null,
          });
        }
        return await handleConnectedServiceRuntimeAuthFailure({
          sessionId: input.sessionId,
          selection,
          classification,
          switchesThisTurn: input.switchesThisTurn,
          switchCoordinator: input.switchCoordinator,
          temporaryThrottleRecovery: input.temporaryThrottleRecovery ?? null,
        });
      }
      const groupSelection = selection;

      if (!input.switchCoordinator) {
        return {
          status: 'switch_coordinator_unavailable',
          blocker: 'CLI has no connected-service auth-group load/commit API in this branch.',
        } as const;
      }

      const switchCoordinator = input.switchCoordinator;
      const effectiveSwitchesThisTurn = input.switchAttemptTracker?.resolveSwitchesThisTurn({
        sessionId: input.sessionId,
        serviceId: groupSelection.serviceId,
        groupId: groupSelection.groupId,
        reportedSwitchesThisTurn: input.switchesThisTurn,
      }) ?? input.switchesThisTurn;
      const sessionSwitchesThisHour = input.switchAttemptTracker?.countRecordedSwitchesInWindow({
        sessionId: input.sessionId,
        serviceId: groupSelection.serviceId,
        groupId: groupSelection.groupId,
        windowMs: SESSION_SWITCH_LIMIT_WINDOW_MS,
      });

      return await handleConnectedServiceRuntimeAuthFailure({
        sessionId: input.sessionId,
        selection: {
          kind: 'group',
          serviceId: groupSelection.serviceId,
          groupId: groupSelection.groupId,
          activeProfileId: classification.profileId
            ?? groupSelection.activeProfileId
            ?? groupSelection.fallbackProfileId
            ?? '',
        },
        classification: {
          ...classification,
          groupId: classification.groupId ?? groupSelection.groupId,
          profileId: classification.profileId
            ?? groupSelection.activeProfileId
            ?? groupSelection.fallbackProfileId
            ?? null,
        },
        switchesThisTurn: effectiveSwitchesThisTurn,
        sessionSwitchesThisHour,
        switchCoordinator,
        temporaryThrottleRecovery: input.temporaryThrottleRecovery ?? null,
      });
    },
  });
  if (result.status === 'switch_attempted' && isGroupRuntimeRecoverySelection(selection)) {
    emitRuntimeGroupSwitchSessionEvent({
      emitSessionEvent: input.emitSessionEvent,
      sessionId: input.sessionId,
      selection,
      classification,
      result: result.result,
    });
    input.switchAttemptTracker?.recordSwitchResult({
      sessionId: input.sessionId,
      serviceId: selection.serviceId,
      groupId: selection.groupId,
      resultStatus: result.result.status,
    });
    await maybeRestartAfterRuntimeGroupSwitch({
      tracked,
      result: result.result,
      restartSession: input.restartSession ?? null,
    });
  }
  return result;
}
