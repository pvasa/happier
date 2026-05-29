import {
  ConnectedServiceIdSchema,
  type ConnectedServiceAuthGroupV1,
  type ConnectedServiceAuthGroupMemberStateV1,
  type ConnectedServiceCredentialHealthStatusV1,
  type ConnectedServiceId,
} from '@happier-dev/protocol';

import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '../accountGroups/quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';
import {
  ConnectedServiceAuthGroupSwitchCoordinator,
  InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry,
  type ConnectedServiceAuthGroupSwitchState,
  type ConnectedServiceAuthGroupSwitchEvent,
} from '../accountGroups/switching/ConnectedServiceAuthGroupSwitchCoordinator';
import { buildConnectedServiceAuthGroupSwitchState } from '../accountGroups/switching/buildConnectedServiceAuthGroupSwitchState';

type AuthGroupApi = Readonly<{
  getConnectedServiceAuthGroup(input: Readonly<{
    serviceId: ConnectedServiceId;
    groupId: string;
  }>): Promise<ConnectedServiceAuthGroupV1 | null>;
  updateConnectedServiceAuthGroupActiveProfile(input: Readonly<{
    serviceId: ConnectedServiceId;
    groupId: string;
    activeProfileId: string;
    expectedGeneration?: number;
  }>): Promise<ConnectedServiceAuthGroupV1>;
  updateConnectedServiceAuthGroupRuntimeState?(input: Readonly<{
    serviceId: ConnectedServiceId;
    groupId: string;
    expectedGeneration?: number;
    memberStates: ReadonlyArray<Readonly<{
      profileId: string;
      state: ConnectedServiceAuthGroupMemberStateV1;
    }>>;
  }>): Promise<ConnectedServiceAuthGroupV1>;
  listConnectedServiceProfiles?(input: Readonly<{ serviceId: ConnectedServiceId }>): Promise<Readonly<{
    serviceId: ConnectedServiceId;
    profiles: ReadonlyArray<Readonly<{
      profileId: string;
      status: ConnectedServiceCredentialHealthStatusV1;
    }>>;
  }>>;
}>;

function readNonNegativeNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  return Math.trunc(value);
}

function resolveUsageLimitRetryAtMs(input: Readonly<{
  loaded: ConnectedServiceAuthGroupSwitchState;
  retryAtMs: number | null;
  observedAtMs: number;
}>): number | null {
  if (input.retryAtMs !== null) return input.retryAtMs;
  const cooldownMs = readNonNegativeNumber(input.loaded.policy.cooldownMs);
  return cooldownMs === null ? null : input.observedAtMs + cooldownMs;
}

function buildObservedFailureMemberState(input: Readonly<{
  loaded: ConnectedServiceAuthGroupSwitchState;
  profileId: string;
  reason: string;
  retryAtMs: number | null;
  planType: string | null | undefined;
  observedAtMs: number;
}>): ConnectedServiceAuthGroupMemberStateV1 {
  const existing = input.loaded.memberStatesByProfileId.get(input.profileId) ?? {};
  const state: ConnectedServiceAuthGroupMemberStateV1 = {
    ...(existing.cooldownUntilMs === undefined ? {} : { cooldownUntilMs: existing.cooldownUntilMs }),
    ...(existing.exhaustedUntilMs === undefined ? {} : { exhaustedUntilMs: existing.exhaustedUntilMs }),
    ...(existing.quotaExhaustedUntilMs === undefined ? {} : { quotaExhaustedUntilMs: existing.quotaExhaustedUntilMs }),
    ...(existing.rateLimitedUntilMs === undefined ? {} : { rateLimitedUntilMs: existing.rateLimitedUntilMs }),
    ...(existing.capacityLimitedUntilMs === undefined ? {} : { capacityLimitedUntilMs: existing.capacityLimitedUntilMs }),
    ...(existing.authInvalidUntilMs === undefined ? {} : { authInvalidUntilMs: existing.authInvalidUntilMs }),
    ...(existing.planUnavailableUntilMs === undefined ? {} : { planUnavailableUntilMs: existing.planUnavailableUntilMs }),
    ...(existing.validationBlockedUntilMs === undefined ? {} : { validationBlockedUntilMs: existing.validationBlockedUntilMs }),
    lastFailureKind: input.reason,
    lastObservedAtMs: input.observedAtMs,
    ...(input.planType ? { lastObservedPlanType: input.planType } : {}),
  };
  switch (input.reason) {
    case 'usage_limit':
      return { ...state, quotaExhaustedUntilMs: resolveUsageLimitRetryAtMs(input) };
    case 'rate_limit':
      return { ...state, rateLimitedUntilMs: input.retryAtMs };
    case 'capacity':
      return { ...state, capacityLimitedUntilMs: input.retryAtMs };
    case 'auth_expired':
    case 'refresh_failed':
    case 'account_disabled':
      return { ...state, authInvalidUntilMs: input.retryAtMs };
    case 'plan':
      return { ...state, planUnavailableUntilMs: input.retryAtMs };
    case 'validation':
      return { ...state, validationBlockedUntilMs: input.retryAtMs };
    default:
      return state;
  }
}

function resolveRetryAtMs(input: Readonly<{
  retryAtMs?: number | null;
  retryAfterMs?: number | null;
  resetsAtMs?: number | null;
  nowMs: number;
}>): number | null {
  const resetsAtMs = readNonNegativeNumber(input.resetsAtMs);
  if (resetsAtMs !== null) return resetsAtMs;
  const retryAfterMs = readNonNegativeNumber(input.retryAfterMs);
  if (retryAfterMs !== null) return input.nowMs + retryAfterMs;
  return readNonNegativeNumber(input.retryAtMs);
}

function resolveApiAuthGroupGenerationConflict(error: unknown): number | null {
  if (!(error instanceof Error)) return null;
  if (error.message !== 'connected_service_auth_group_generation_conflict') return null;
  return readNonNegativeNumber((error as Readonly<{ generation?: unknown }>).generation);
}

export function createDaemonConnectedServiceAuthGroupSwitchCoordinator(params: Readonly<{
  api: AuthGroupApi;
  runtimeQuotaSnapshots: ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore;
  leases?: InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry;
  quotaFreshnessMs: number;
  nowMs: () => number;
  restartSession: (input: Readonly<{
    sessionId?: string;
    serviceId: ConnectedServiceId;
    groupId: string;
    activeProfileId: string | null;
    generation: number;
    reason?: string;
  }>) => Promise<void>;
  applyConnectedServiceAuthGeneration?: (input: Readonly<{
    sessionId: string;
    serviceId: ConnectedServiceId;
    groupId: string;
    activeProfileId: string | null;
    generation: number;
    reason: string;
  }>) => Promise<Readonly<{ ok: boolean; action?: string; errorCode?: string }>>;
  hydratePersistedQuotaSnapshotsForGroup?: (input: Readonly<{
    serviceId: ConnectedServiceId;
    groupId: string;
    profileIds: ReadonlyArray<string>;
  }>) => Promise<void>;
  probeQuotaSnapshotsForGroup?: (input: Readonly<{
    serviceId: ConnectedServiceId;
    groupId: string;
    profileIds: ReadonlyArray<string>;
    reason: string;
  }>) => Promise<void>;
  emitEvent?: (event: ConnectedServiceAuthGroupSwitchEvent) => void;
}>): ConnectedServiceAuthGroupSwitchCoordinator {
  return new ConnectedServiceAuthGroupSwitchCoordinator({
    leases: params.leases ?? new InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry(),
    nowMs: params.nowMs,
    quotaFreshnessMs: params.quotaFreshnessMs,
    loadState: async (input) => {
      const serviceId = ConnectedServiceIdSchema.parse(input.serviceId);
      const group = await params.api.getConnectedServiceAuthGroup({ serviceId, groupId: input.groupId });
      if (!group) throw new Error(`Connected service auth group not found (${input.serviceId}/${input.groupId})`);
      await params.hydratePersistedQuotaSnapshotsForGroup?.({
        serviceId,
        groupId: input.groupId,
        profileIds: group.members.map((member) => member.profileId),
      });
      const state = buildConnectedServiceAuthGroupSwitchState({
        group,
        runtimeQuotaSnapshots: params.runtimeQuotaSnapshots,
        nowMs: params.nowMs(),
      });
      if (typeof params.api.listConnectedServiceProfiles !== 'function') return state;
      const profiles = await params.api.listConnectedServiceProfiles({ serviceId }).catch(() => null);
      if (!profiles) return state;
      const healthByProfileId = new Map(profiles.profiles.map((profile) => [profile.profileId, profile.status]));
      const memberStatesByProfileId = new Map(state.memberStatesByProfileId);
      for (const member of state.members) {
        const healthStatus = healthByProfileId.get(member.profileId);
        if (!healthStatus) continue;
        memberStatesByProfileId.set(member.profileId, {
          ...(memberStatesByProfileId.get(member.profileId) ?? {}),
          credentialHealthStatus: healthStatus,
        });
      }
      return {
        ...state,
        memberStatesByProfileId,
      };
    },
    commitSwitch: async (input) => {
      const serviceId = ConnectedServiceIdSchema.parse(input.serviceId);
      const group = await params.api.updateConnectedServiceAuthGroupActiveProfile({
        serviceId,
        groupId: input.groupId,
        activeProfileId: input.toProfileId,
        expectedGeneration: input.expectedGeneration,
      });
      return buildConnectedServiceAuthGroupSwitchState({
        group,
        runtimeQuotaSnapshots: params.runtimeQuotaSnapshots,
        nowMs: params.nowMs(),
      });
    },
    ...(params.probeQuotaSnapshotsForGroup ? {
      probeQuotaSnapshotsForGroup: async (input) => {
        const serviceId = ConnectedServiceIdSchema.parse(input.serviceId);
        await params.probeQuotaSnapshotsForGroup?.({
          serviceId,
          groupId: input.groupId,
          profileIds: input.profileIds,
          reason: input.reason,
        });
      },
    } : {}),
    resolveGenerationConflict: resolveApiAuthGroupGenerationConflict,
    applyGeneration: async (input) => {
      if (input.sessionId && params.applyConnectedServiceAuthGeneration) {
        const applied = await params.applyConnectedServiceAuthGeneration({
          sessionId: input.sessionId,
          serviceId: input.serviceId as ConnectedServiceId,
          groupId: input.groupId,
          activeProfileId: input.activeProfileId,
          generation: input.generation,
          reason: input.reason ?? 'unknown',
        });
        if (applied.ok) {
          switch (applied.action) {
            case 'hot_applied':
              return { mode: 'hot_apply' as const };
            case 'metadata_updated':
              return { mode: 'spawn_next_turn' as const };
            default:
              return { mode: 'restart_resume' as const };
          }
        }
        throw new Error(`connected_service_auth_generation_apply_failed:${applied.errorCode ?? 'unknown'}`);
      }
      await params.restartSession({
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        serviceId: input.serviceId as ConnectedServiceId,
        groupId: input.groupId,
        activeProfileId: input.activeProfileId,
        generation: input.generation,
        ...(input.reason ? { reason: input.reason } : {}),
      });
      return { mode: 'restart_resume' as const };
    },
    recordObservedFailureState: async (input) => {
      if (!params.api.updateConnectedServiceAuthGroupRuntimeState) return;
      const observedProfileId = typeof input.observedProfileId === 'string' && input.observedProfileId.trim().length > 0
        ? input.observedProfileId.trim()
        : input.loaded.activeProfileId;
      if (!observedProfileId) return;
      const serviceId = ConnectedServiceIdSchema.parse(input.serviceId);
      await params.api.updateConnectedServiceAuthGroupRuntimeState({
        serviceId,
        groupId: input.groupId,
        expectedGeneration: input.loaded.generation,
        memberStates: [{
          profileId: observedProfileId,
          state: buildObservedFailureMemberState({
            loaded: input.loaded,
            profileId: observedProfileId,
            reason: input.reason,
            retryAtMs: resolveRetryAtMs({
              retryAtMs: input.retryAtMs,
              retryAfterMs: input.retryAfterMs,
              resetsAtMs: input.resetsAtMs,
              nowMs: params.nowMs(),
            }),
            planType: input.planType,
            observedAtMs: params.nowMs(),
          }),
        }],
      });
    },
    ...(params.emitEvent ? { emitEvent: params.emitEvent } : {}),
  });
}
