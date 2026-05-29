import {
  selectConnectedServiceAuthGroupCandidate,
  type ConnectedServiceAuthGroupMember,
  type ConnectedServiceAuthGroupMemberRuntimeState,
  type ConnectedServiceAuthGroupPolicyV1,
} from '../selection/selectConnectedServiceAuthGroupCandidate';
import { resolveConnectedServiceAuthGroupPreTurnQuotaProbeProfileIds } from '../selection/resolveConnectedServiceAuthGroupPreTurnQuotaProbeProfileIds';

export type ConnectedServiceAuthGroupSwitchState = Readonly<{
  serviceId: string;
  groupId: string;
  activeProfileId: string | null;
  generation: number;
  policy: ConnectedServiceAuthGroupPolicyV1;
  members: ReadonlyArray<ConnectedServiceAuthGroupMember>;
  memberStatesByProfileId: ReadonlyMap<string, ConnectedServiceAuthGroupMemberRuntimeState>;
}>;

type LeaseCompletion = Readonly<{
  sessionId?: string;
  serviceId: string;
  groupId: string;
  activeProfileId: string | null;
  generation: number;
  reason?: string;
}>;
type ConnectedServiceAuthGroupSwitchApplyMode = 'hot_apply' | 'restart_resume' | 'spawn_next_turn';
type ConnectedServiceAuthGroupSwitchApplyGenerationResult = Readonly<{
  mode: ConnectedServiceAuthGroupSwitchApplyMode;
}>;

type LeaseOutcome =
  | Readonly<{ status: 'completed'; completion: LeaseCompletion }>
  | Readonly<{ status: 'failed'; error: unknown }>;

type LeaseAcquireResult =
  | Readonly<{
      kind: 'owner';
      complete(completion: LeaseCompletion): void;
      fail(error: unknown): void;
    }>
  | Readonly<{
      kind: 'loser';
      waitForOwner(): Promise<LeaseCompletion>;
    }>;

const DEFAULT_SWITCH_LEASE_TIMEOUT_MS = 30_000;
export const SESSION_SWITCH_LIMIT_WINDOW_MS = 60 * 60 * 1000;

function switchKey(serviceId: string, groupId: string): string {
  return `${serviceId}\0${groupId}`;
}

export class ConnectedServiceAuthGroupSwitchLeaseExpiredError extends Error {
  constructor() {
    super('connected_service_auth_group_switch_lease_expired');
  }
}

export class InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry {
  private readonly pendingByKey = new Map<string, {
    promise: Promise<LeaseOutcome>;
    resolve: (outcome: LeaseOutcome) => void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  constructor(private readonly options: Readonly<{ leaseTimeoutMs?: number }> = {}) {}

  acquire(input: Readonly<{ serviceId: string; groupId: string }>): LeaseAcquireResult {
    const key = switchKey(input.serviceId, input.groupId);
    const pending = this.pendingByKey.get(key);
    if (pending) {
      return {
        kind: 'loser',
        waitForOwner: async () => {
          const outcome = await pending.promise;
          if (outcome.status === 'failed') throw outcome.error;
          return outcome.completion;
        },
      };
    }

    let resolveCompletion: (outcome: LeaseOutcome) => void = () => {};
    const promise = new Promise<LeaseOutcome>((resolve) => {
      resolveCompletion = resolve;
    });
    const timer = setTimeout(() => {
      const current = this.pendingByKey.get(key);
      if (!current) return;
      this.pendingByKey.delete(key);
      current.resolve({ status: 'failed', error: new ConnectedServiceAuthGroupSwitchLeaseExpiredError() });
    }, this.options.leaseTimeoutMs ?? DEFAULT_SWITCH_LEASE_TIMEOUT_MS);
    this.pendingByKey.set(key, { promise, resolve: resolveCompletion, timer });
    return {
      kind: 'owner',
      complete: (completion) => {
        const current = this.pendingByKey.get(key);
        if (!current) return;
        this.pendingByKey.delete(key);
        clearTimeout(current.timer);
        current.resolve({ status: 'completed', completion });
      },
      fail: (error) => {
        const current = this.pendingByKey.get(key);
        if (!current) return;
        this.pendingByKey.delete(key);
        clearTimeout(current.timer);
        current.resolve({ status: 'failed', error });
      },
    };
  }
}

export type ConnectedServiceAuthGroupSwitchResult =
  | Readonly<{
      status: 'switched';
      activeProfileId: string;
      generation: number;
      mode?: ConnectedServiceAuthGroupSwitchApplyMode;
    }>
  | Readonly<{
      status: 'generation_apply_failed';
      activeProfileId: string | null;
      generation: number;
      errorCode: string;
    }>
  | Readonly<{ status: 'observed_generation'; activeProfileId: string | null; generation: number }>
  | Readonly<{
      status: 'no_eligible_member';
      generation: number;
      groupExhausted: true;
      retryAtMs: number | null;
      excluded: ReadonlyArray<Readonly<{
        profileId: string;
        reason: string;
        retryAtMs?: number | null;
      }>>;
    }>
  | Readonly<{ status: 'manual_strategy'; generation: number }>
  | Readonly<{ status: 'auto_switch_disabled'; generation: number }>
  | Readonly<{ status: 'switch_reason_disabled'; generation: number }>
  | Readonly<{ status: 'switch_limit_reached'; generation: number }>;

export type ConnectedServiceAuthGroupSwitchLimitAction = Readonly<{
  kind: 'open_url';
  url: string;
}>;

export type ConnectedServiceAuthGroupSwitchEvent = Readonly<{
  type: 'connected_service_auth_group_switch';
  serviceId: string;
  groupId: string;
  fromProfileId: string | null;
  toProfileId: string | null;
  reason: string;
  limitCategory?: string | null;
  retryAfterMs?: number | null;
  quotaScope?: string | null;
  providerLimitId?: string | null;
  action?: ConnectedServiceAuthGroupSwitchLimitAction | null;
  mode?: ConnectedServiceAuthGroupSwitchApplyMode;
  fromGeneration: number;
  toGeneration: number;
  resultStatus: ConnectedServiceAuthGroupSwitchResult['status'];
  success: boolean;
  latencyMs: number;
}>;

function isReasonEnabled(policy: ConnectedServiceAuthGroupPolicyV1, reason: string): boolean {
  switch (reason) {
    case 'usage_limit':
    case 'rate_limit':
    case 'soft_threshold':
      return policy.switchOn.usageLimit;
    case 'auth_expired':
    case 'account_disabled':
      return policy.switchOn.authExpired;
    case 'account_changed':
      return policy.switchOn.accountChanged;
    case 'refresh_failed':
      return policy.switchOn.refreshFailure || policy.switchOn.authExpired;
    default:
      return false;
  }
}

const GENERATION_APPLY_FAILED_PREFIX = 'connected_service_auth_generation_apply_failed:';

function readGenerationApplyFailureCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (!error.message.startsWith(GENERATION_APPLY_FAILED_PREFIX)) return null;
  const code = error.message.slice(GENERATION_APPLY_FAILED_PREFIX.length).trim();
  return code.length > 0 ? code : 'unknown';
}

function resolveEarliestRetryAtMs(excluded: ReadonlyArray<Readonly<{ retryAtMs?: number | null }>>): number | null {
  let earliest: number | null = null;
  for (const item of excluded) {
    if (typeof item.retryAtMs !== 'number' || !Number.isFinite(item.retryAtMs)) continue;
    earliest = earliest === null ? item.retryAtMs : Math.min(earliest, item.retryAtMs);
  }
  return earliest;
}

function resolvePolicyRecoveryWaitRetryAtMs(input: Readonly<{
  retryAtMs?: number | null;
  resetsAtMs?: number | null;
}>): number | null {
  const values = [input.retryAtMs, input.resetsAtMs]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
}

function normalizeProfileId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function buildLeaseCompletion(input: Readonly<{
  sessionId?: string;
  serviceId: string;
  groupId: string;
  activeProfileId: string | null;
  generation: number;
  reason?: string;
}>): LeaseCompletion {
  return {
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    serviceId: input.serviceId,
    groupId: input.groupId,
    activeProfileId: input.activeProfileId,
    generation: input.generation,
    ...(input.reason ? { reason: input.reason } : {}),
  };
}

type ObservedGenerationSwitchResult = Extract<ConnectedServiceAuthGroupSwitchResult, { status: 'observed_generation' }>;

type CommitSwitchOutcome =
  | Readonly<{ kind: 'committed'; state: ConnectedServiceAuthGroupSwitchState }>
  | Readonly<{ kind: 'observed_generation'; result: ObservedGenerationSwitchResult }>;

type GenerationConflictResolution =
  | Readonly<{ kind: 'observed_generation'; result: ObservedGenerationSwitchResult }>
  | Readonly<{ kind: 'retry'; state: ConnectedServiceAuthGroupSwitchState }>;

type RecordObservedFailureStateOutcome =
  | Readonly<{ kind: 'recorded'; state: ConnectedServiceAuthGroupSwitchState }>
  | Readonly<{ kind: 'observed_generation'; result: ObservedGenerationSwitchResult }>;

export class ConnectedServiceAuthGroupSwitchCoordinator {
  private readonly switchTimestampsBySessionKey = new Map<string, number[]>();

  constructor(private readonly deps: Readonly<{
    leases: InMemoryConnectedServiceAuthGroupSwitchLeaseRegistry;
    nowMs: () => number;
    quotaFreshnessMs: number;
    loadState(input: Readonly<{ serviceId: string; groupId: string }>): Promise<ConnectedServiceAuthGroupSwitchState>;
    commitSwitch(input: Readonly<{
      serviceId: string;
      groupId: string;
      fromProfileId: string | null;
      toProfileId: string;
      expectedGeneration: number;
      reason: string;
    }>): Promise<ConnectedServiceAuthGroupSwitchState>;
    applyGeneration(input: Readonly<{
      sessionId?: string;
      serviceId: string;
      groupId: string;
      activeProfileId: string | null;
      generation: number;
      reason?: string;
    }>): Promise<ConnectedServiceAuthGroupSwitchApplyGenerationResult | void>;
    recordObservedFailureState?(input: Readonly<{
      serviceId: string;
      groupId: string;
      loaded: ConnectedServiceAuthGroupSwitchState;
      reason: string;
      observedProfileId?: string | null;
      retryAtMs?: number | null;
      retryAfterMs?: number | null;
      resetsAtMs?: number | null;
      planType?: string | null;
    }>): Promise<void>;
    probeQuotaSnapshotsForGroup?(input: Readonly<{
      serviceId: string;
      groupId: string;
      profileIds: ReadonlyArray<string>;
      reason: string;
    }>): Promise<void>;
    resolveGenerationConflict?: (error: unknown) => number | null;
    emitEvent?: (event: ConnectedServiceAuthGroupSwitchEvent) => void;
  }>) {}

  private async probeQuotaSnapshotsBeforePreTurnSelection(input: Readonly<{
    request: Readonly<{
      serviceId: string;
      groupId: string;
      reason: string;
    }>;
    loaded: ConnectedServiceAuthGroupSwitchState;
    allowCurrentProfileRetry: boolean;
  }>): Promise<ConnectedServiceAuthGroupSwitchState> {
    if (!this.deps.probeQuotaSnapshotsForGroup) return input.loaded;
    const profileIds = resolveConnectedServiceAuthGroupPreTurnQuotaProbeProfileIds({
      activeProfileId: input.loaded.activeProfileId,
      members: input.loaded.members,
      memberStatesByProfileId: input.loaded.memberStatesByProfileId,
      policy: input.loaded.policy,
      nowMs: this.deps.nowMs(),
      quotaFreshnessMs: this.deps.quotaFreshnessMs,
      allowCurrentProfileRetry: input.allowCurrentProfileRetry,
    });
    if (profileIds.length === 0) return input.loaded;
    await this.deps.probeQuotaSnapshotsForGroup({
      serviceId: input.request.serviceId,
      groupId: input.request.groupId,
      profileIds,
      reason: input.request.reason,
    });
    return await this.deps.loadState({
      serviceId: input.request.serviceId,
      groupId: input.request.groupId,
    });
  }

  private resolveSessionSwitchKey(input: Readonly<{ sessionId?: string; serviceId: string; groupId: string }>): string | null {
    const sessionId = typeof input.sessionId === 'string' && input.sessionId.trim().length > 0 ? input.sessionId.trim() : null;
    if (!sessionId) return null;
    return `${sessionId}\0${input.serviceId}\0${input.groupId}`;
  }

  private countRecentSessionSwitches(key: string, nowMs: number): number {
    const cutoffMs = nowMs - SESSION_SWITCH_LIMIT_WINDOW_MS;
    const recent = (this.switchTimestampsBySessionKey.get(key) ?? []).filter((timestamp) => timestamp >= cutoffMs);
    this.switchTimestampsBySessionKey.set(key, recent);
    return recent.length;
  }

  private recordSessionSwitch(key: string | null, nowMs: number): void {
    if (!key) return;
    const cutoffMs = nowMs - SESSION_SWITCH_LIMIT_WINDOW_MS;
    const recent = (this.switchTimestampsBySessionKey.get(key) ?? []).filter((timestamp) => timestamp >= cutoffMs);
    recent.push(nowMs);
    this.switchTimestampsBySessionKey.set(key, recent);
  }

  private async resolveStateAfterGenerationConflict(input: Readonly<{
    error: unknown;
    sessionId?: string;
    serviceId: string;
    groupId: string;
    loaded: ConnectedServiceAuthGroupSwitchState;
    reason?: string;
    lease: Extract<LeaseAcquireResult, { kind: 'owner' }>;
  }>): Promise<GenerationConflictResolution | null> {
    const conflictGeneration = this.deps.resolveGenerationConflict?.(input.error);
    if (typeof conflictGeneration !== 'number' || !Number.isFinite(conflictGeneration)) return null;
    const observed = await this.deps.loadState({
      serviceId: input.serviceId,
      groupId: input.groupId,
    });
    if (observed.generation <= input.loaded.generation) return null;
    if (normalizeProfileId(observed.activeProfileId) === normalizeProfileId(input.loaded.activeProfileId)) {
      return { kind: 'retry', state: observed };
    }
    const completion = buildLeaseCompletion({
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      serviceId: input.serviceId,
      groupId: input.groupId,
      activeProfileId: observed.activeProfileId,
      generation: observed.generation,
      ...(input.reason ? { reason: input.reason } : {}),
    });
    await this.deps.applyGeneration(completion);
    input.lease.complete(completion);
    return {
      kind: 'observed_generation',
      result: {
        status: 'observed_generation',
        activeProfileId: observed.activeProfileId,
        generation: observed.generation,
      },
    };
  }

  private async recordObservedFailureStateWithConflictRecovery(input: Readonly<{
    sessionId?: string;
    serviceId: string;
    groupId: string;
    loaded: ConnectedServiceAuthGroupSwitchState;
    reason: string;
    observedProfileId?: string | null;
    retryAtMs?: number | null;
    retryAfterMs?: number | null;
    resetsAtMs?: number | null;
    planType?: string | null;
    lease: Extract<LeaseAcquireResult, { kind: 'owner' }>;
  }>): Promise<RecordObservedFailureStateOutcome> {
    if (!this.deps.recordObservedFailureState) {
      return { kind: 'recorded', state: input.loaded };
    }

    let loaded = input.loaded;
    for (;;) {
      try {
        await this.deps.recordObservedFailureState({
          serviceId: input.serviceId,
          groupId: input.groupId,
          loaded,
          reason: input.reason,
          observedProfileId: input.observedProfileId,
          retryAtMs: input.retryAtMs,
          retryAfterMs: input.retryAfterMs,
          resetsAtMs: input.resetsAtMs,
          planType: input.planType,
        });
        return {
          kind: 'recorded',
          state: await this.deps.loadState({
            serviceId: input.serviceId,
            groupId: input.groupId,
          }),
        };
      } catch (error) {
        const resolvedConflict = await this.resolveStateAfterGenerationConflict({
          error,
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          loaded,
          reason: input.reason,
          lease: input.lease,
        });
        if (!resolvedConflict) throw error;
        if (resolvedConflict.kind === 'observed_generation') {
          return resolvedConflict;
        }
        loaded = resolvedConflict.state;
      }
    }
  }

  private emitSwitchResult(input: Readonly<{
    request: Readonly<{
      serviceId: string;
      groupId: string;
      reason: string;
      observedProfileId?: string | null;
      limitCategory?: string | null;
      retryAtMs?: number | null;
      retryAfterMs?: number | null;
      quotaScope?: string | null;
      providerLimitId?: string | null;
      action?: ConnectedServiceAuthGroupSwitchLimitAction | null;
    }>;
    loaded: ConnectedServiceAuthGroupSwitchState;
    resultStatus: ConnectedServiceAuthGroupSwitchResult['status'];
    toProfileId: string | null;
    toGeneration: number;
    mode?: ConnectedServiceAuthGroupSwitchApplyMode;
    success: boolean;
    startedAtMs: number;
  }>): void {
    this.deps.emitEvent?.({
      type: 'connected_service_auth_group_switch',
      serviceId: input.request.serviceId,
      groupId: input.request.groupId,
      fromProfileId: normalizeProfileId(input.request.observedProfileId) ?? input.loaded.activeProfileId,
      toProfileId: input.toProfileId,
      reason: input.request.reason,
      ...(input.request.limitCategory === undefined ? {} : { limitCategory: input.request.limitCategory }),
      ...(input.request.retryAfterMs === undefined && input.request.retryAtMs === undefined
        ? {}
        : { retryAfterMs: input.request.retryAfterMs ?? input.request.retryAtMs ?? null }),
      ...(input.request.quotaScope === undefined ? {} : { quotaScope: input.request.quotaScope }),
      ...(input.request.providerLimitId === undefined ? {} : { providerLimitId: input.request.providerLimitId }),
      ...(input.request.action === undefined ? {} : { action: input.request.action }),
      ...(input.mode === undefined ? {} : { mode: input.mode }),
      fromGeneration: input.loaded.generation,
      toGeneration: input.toGeneration,
      resultStatus: input.resultStatus,
      success: input.success,
      latencyMs: Math.max(0, this.deps.nowMs() - input.startedAtMs),
    });
  }

  async switchAfterClassifiedFailure(input: Readonly<{
    sessionId?: string;
    serviceId: string;
    groupId: string;
    reason: string;
    observedProfileId?: string | null;
    retryAtMs?: number | null;
    retryAfterMs?: number | null;
    resetsAtMs?: number | null;
    limitCategory?: string | null;
    quotaScope?: string | null;
    providerLimitId?: string | null;
    action?: ConnectedServiceAuthGroupSwitchLimitAction | null;
    planType?: string | null;
    switchesThisTurn?: number;
    sessionSwitchesThisHour?: number;
  }>): Promise<ConnectedServiceAuthGroupSwitchResult> {
    const startedAtMs = this.deps.nowMs();
    const lease = this.deps.leases.acquire(input);
    if (lease.kind === 'loser') {
      const observed = await lease.waitForOwner();
      await this.deps.applyGeneration(observed);
      return {
        status: 'observed_generation',
        activeProfileId: observed.activeProfileId,
        generation: observed.generation,
      };
    }

    try {
      let loaded = await this.deps.loadState(input);
      const observedFailureOutcome = await this.recordObservedFailureStateWithConflictRecovery({
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        serviceId: input.serviceId,
        groupId: input.groupId,
        loaded,
        reason: input.reason,
        observedProfileId: input.observedProfileId,
        retryAtMs: input.retryAtMs,
        retryAfterMs: input.retryAfterMs,
        resetsAtMs: input.resetsAtMs,
        planType: input.planType,
        lease,
      });
      if (observedFailureOutcome.kind === 'observed_generation') {
        return observedFailureOutcome.result;
      }
      loaded = observedFailureOutcome.state;
      const observedProfileId = normalizeProfileId(input.observedProfileId);
      const loadedActiveProfileId = normalizeProfileId(loaded.activeProfileId);
      if (observedProfileId && loadedActiveProfileId && loadedActiveProfileId !== observedProfileId) {
        const completion = buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        });
        await this.deps.applyGeneration(completion);
        lease.complete(completion);
        return {
          status: 'observed_generation',
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
        };
      }
      loaded = await this.probeQuotaSnapshotsBeforePreTurnSelection({
        request: input,
        loaded,
        allowCurrentProfileRetry: false,
      });
      if (!loaded.policy.autoSwitch) {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'auto_switch_disabled', generation: loaded.generation };
      }
      if (loaded.policy.recoveryMode === 'off') {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'auto_switch_disabled', generation: loaded.generation };
      }
      if (!isReasonEnabled(loaded.policy, input.reason)) {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'switch_reason_disabled', generation: loaded.generation };
      }
      if (loaded.policy.recoveryMode === 'wait_until_reset') {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return {
          status: 'no_eligible_member',
          generation: loaded.generation,
          groupExhausted: true,
          retryAtMs: resolvePolicyRecoveryWaitRetryAtMs(input),
          excluded: [],
        };
      }
      const switchesThisTurn = typeof input.switchesThisTurn === 'number' && Number.isFinite(input.switchesThisTurn)
        ? Math.max(0, Math.trunc(input.switchesThisTurn))
        : 0;
      const sessionSwitchKey = this.resolveSessionSwitchKey(input);
      const hourlySwitchCount = typeof input.sessionSwitchesThisHour === 'number' && Number.isFinite(input.sessionSwitchesThisHour)
        ? Math.max(0, Math.trunc(input.sessionSwitchesThisHour))
        : sessionSwitchKey
          ? this.countRecentSessionSwitches(sessionSwitchKey, this.deps.nowMs())
          : 0;
      if (
        switchesThisTurn >= loaded.policy.maxSwitchesPerTurn
        || hourlySwitchCount >= loaded.policy.maxSwitchesPerSessionHour
      ) {
        this.emitSwitchResult({
          request: input,
          loaded,
          resultStatus: 'switch_limit_reached',
          toProfileId: null,
          toGeneration: loaded.generation,
          success: false,
          startedAtMs,
        });
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'switch_limit_reached', generation: loaded.generation };
      }
      const selected = selectConnectedServiceAuthGroupCandidate({
        nowMs: this.deps.nowMs(),
        quotaFreshnessMs: this.deps.quotaFreshnessMs,
        activeProfileId: loaded.activeProfileId,
        policy: loaded.policy,
        members: loaded.members,
        memberStatesByProfileId: loaded.memberStatesByProfileId,
      });
      if (!selected.selected) {
        const completion = buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        });
        lease.complete(completion);
        if (selected.reason === 'manual_strategy') {
          return { status: 'manual_strategy', generation: loaded.generation };
        }
        return {
          status: 'no_eligible_member',
          generation: loaded.generation,
          groupExhausted: true,
          retryAtMs: resolveEarliestRetryAtMs(selected.excluded),
          excluded: selected.excluded,
        };
      }
      const selectedProfileId = selected.selected.profileId;

      const commitOutcome: CommitSwitchOutcome = await (async () => {
        try {
          const state = await this.deps.commitSwitch({
            serviceId: input.serviceId,
            groupId: input.groupId,
            fromProfileId: loaded.activeProfileId,
            toProfileId: selectedProfileId,
            expectedGeneration: loaded.generation,
            reason: input.reason,
          });
          return { kind: 'committed', state };
        } catch (error) {
          const resolvedConflict = await this.resolveStateAfterGenerationConflict({
            error,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            serviceId: input.serviceId,
            groupId: input.groupId,
            loaded,
            reason: input.reason,
            lease,
          });
          if (resolvedConflict?.kind === 'observed_generation') return resolvedConflict;
          if (resolvedConflict?.kind === 'retry') {
            const state = await this.deps.commitSwitch({
              serviceId: input.serviceId,
              groupId: input.groupId,
              fromProfileId: resolvedConflict.state.activeProfileId,
              toProfileId: selectedProfileId,
              expectedGeneration: resolvedConflict.state.generation,
              reason: input.reason,
            });
            return { kind: 'committed', state };
          }
          throw error;
        }
      })();
      if (commitOutcome.kind === 'observed_generation') return commitOutcome.result;
      const committed = commitOutcome.state;
      const completion = buildLeaseCompletion({
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        serviceId: input.serviceId,
        groupId: input.groupId,
        activeProfileId: committed.activeProfileId,
        generation: committed.generation,
        reason: input.reason,
      });
      let applyResult: ConnectedServiceAuthGroupSwitchApplyGenerationResult | void;
      try {
        applyResult = await this.deps.applyGeneration(completion);
      } catch (error) {
        const errorCode = readGenerationApplyFailureCode(error);
        if (!errorCode) throw error;
        lease.complete(completion);
        this.emitSwitchResult({
          request: input,
          loaded,
          resultStatus: 'generation_apply_failed',
          toProfileId: committed.activeProfileId ?? selectedProfileId,
          toGeneration: committed.generation,
          success: false,
          startedAtMs,
        });
        return {
          status: 'generation_apply_failed',
          activeProfileId: committed.activeProfileId ?? selectedProfileId,
          generation: committed.generation,
          errorCode,
        };
      }
      lease.complete(completion);
      this.recordSessionSwitch(sessionSwitchKey, this.deps.nowMs());
      this.emitSwitchResult({
        request: input,
        loaded,
        resultStatus: 'switched',
        toProfileId: committed.activeProfileId ?? selectedProfileId,
        toGeneration: committed.generation,
        ...(applyResult?.mode ? { mode: applyResult.mode } : {}),
        success: true,
        startedAtMs,
      });
      return {
        status: 'switched',
        activeProfileId: committed.activeProfileId ?? selectedProfileId,
        generation: committed.generation,
        ...(applyResult?.mode ? { mode: applyResult.mode } : {}),
      };
    } catch (error) {
      lease.fail(error);
      throw error;
    }
  }

  async switchBeforeTurn(input: Readonly<{
    sessionId?: string;
    serviceId: string;
    groupId: string;
    reason: 'usage_limit' | 'soft_threshold' | 'auth_expired' | 'account_changed' | 'refresh_failed';
    switchesThisTurn?: number;
    sessionSwitchesThisHour?: number;
  }>): Promise<ConnectedServiceAuthGroupSwitchResult> {
    const startedAtMs = this.deps.nowMs();
    const lease = this.deps.leases.acquire(input);
    if (lease.kind === 'loser') {
      const observed = await lease.waitForOwner();
      await this.deps.applyGeneration(observed);
      return {
        status: 'observed_generation',
        activeProfileId: observed.activeProfileId,
        generation: observed.generation,
      };
    }

    try {
      let loaded = await this.deps.loadState(input);
      if (!loaded.policy.autoSwitch) {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'auto_switch_disabled', generation: loaded.generation };
      }
      if (loaded.policy.recoveryMode === 'off') {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'auto_switch_disabled', generation: loaded.generation };
      }
      if (!isReasonEnabled(loaded.policy, input.reason)) {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'switch_reason_disabled', generation: loaded.generation };
      }
      if (loaded.policy.recoveryMode === 'wait_until_reset') {
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return {
          status: 'no_eligible_member',
          generation: loaded.generation,
          groupExhausted: true,
          retryAtMs: null,
          excluded: [],
        };
      }

      const switchesThisTurn = typeof input.switchesThisTurn === 'number' && Number.isFinite(input.switchesThisTurn)
        ? Math.max(0, Math.trunc(input.switchesThisTurn))
        : 0;
      const sessionSwitchKey = this.resolveSessionSwitchKey(input);
      const hourlySwitchCount = typeof input.sessionSwitchesThisHour === 'number' && Number.isFinite(input.sessionSwitchesThisHour)
        ? Math.max(0, Math.trunc(input.sessionSwitchesThisHour))
        : sessionSwitchKey
          ? this.countRecentSessionSwitches(sessionSwitchKey, this.deps.nowMs())
          : 0;
      if (
        switchesThisTurn >= loaded.policy.maxSwitchesPerTurn
        || hourlySwitchCount >= loaded.policy.maxSwitchesPerSessionHour
      ) {
        this.emitSwitchResult({
          request: input,
          loaded,
          resultStatus: 'switch_limit_reached',
          toProfileId: null,
          toGeneration: loaded.generation,
          success: false,
          startedAtMs,
        });
        lease.complete(buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        }));
        return { status: 'switch_limit_reached', generation: loaded.generation };
      }

      loaded = await this.probeQuotaSnapshotsBeforePreTurnSelection({
        request: input,
        loaded,
        allowCurrentProfileRetry: true,
      });

      const selected = selectConnectedServiceAuthGroupCandidate({
        nowMs: this.deps.nowMs(),
        quotaFreshnessMs: this.deps.quotaFreshnessMs,
        activeProfileId: loaded.activeProfileId,
        policy: loaded.policy,
        members: loaded.members,
        memberStatesByProfileId: loaded.memberStatesByProfileId,
        allowCurrentProfileRetry: true,
      });
      if (!selected.selected) {
        const completion = buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        });
        lease.complete(completion);
        if (selected.reason === 'manual_strategy') {
          return { status: 'manual_strategy', generation: loaded.generation };
        }
        return {
          status: 'no_eligible_member',
          generation: loaded.generation,
          groupExhausted: true,
          retryAtMs: resolveEarliestRetryAtMs(selected.excluded),
          excluded: selected.excluded,
        };
      }
      const selectedProfileId = selected.selected.profileId;
      if (selectedProfileId === loaded.activeProfileId) {
        const completion = buildLeaseCompletion({
          ...(input.sessionId ? { sessionId: input.sessionId } : {}),
          serviceId: input.serviceId,
          groupId: input.groupId,
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
          reason: input.reason,
        });
        lease.complete(completion);
        return {
          status: 'observed_generation',
          activeProfileId: loaded.activeProfileId,
          generation: loaded.generation,
        };
      }

      const commitOutcome: CommitSwitchOutcome = await (async () => {
        try {
          const state = await this.deps.commitSwitch({
            serviceId: input.serviceId,
            groupId: input.groupId,
            fromProfileId: loaded.activeProfileId,
            toProfileId: selectedProfileId,
            expectedGeneration: loaded.generation,
            reason: input.reason,
          });
          return { kind: 'committed', state };
        } catch (error) {
          const resolvedConflict = await this.resolveStateAfterGenerationConflict({
            error,
            ...(input.sessionId ? { sessionId: input.sessionId } : {}),
            serviceId: input.serviceId,
            groupId: input.groupId,
            loaded,
            reason: input.reason,
            lease,
          });
          if (resolvedConflict?.kind === 'observed_generation') return resolvedConflict;
          if (resolvedConflict?.kind === 'retry') {
            const state = await this.deps.commitSwitch({
              serviceId: input.serviceId,
              groupId: input.groupId,
              fromProfileId: resolvedConflict.state.activeProfileId,
              toProfileId: selectedProfileId,
              expectedGeneration: resolvedConflict.state.generation,
              reason: input.reason,
            });
            return { kind: 'committed', state };
          }
          throw error;
        }
      })();
      if (commitOutcome.kind === 'observed_generation') return commitOutcome.result;
      const committed = commitOutcome.state;
      const completion = buildLeaseCompletion({
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
        serviceId: input.serviceId,
        groupId: input.groupId,
        activeProfileId: committed.activeProfileId,
        generation: committed.generation,
        reason: input.reason,
      });
      let applyResult: ConnectedServiceAuthGroupSwitchApplyGenerationResult | void;
      try {
        applyResult = await this.deps.applyGeneration(completion);
      } catch (error) {
        // K2 fail-closed: a proactive switch whose apply path cannot resume the
        // target (e.g. the spawn-time reachability gate fired) surfaces a
        // structured generation_apply_failed result instead of throwing, so the
        // quota loop does not spin and the caller can present an actionable error.
        const errorCode = readGenerationApplyFailureCode(error);
        if (!errorCode) throw error;
        lease.complete(completion);
        this.emitSwitchResult({
          request: input,
          loaded,
          resultStatus: 'generation_apply_failed',
          toProfileId: committed.activeProfileId ?? selectedProfileId,
          toGeneration: committed.generation,
          success: false,
          startedAtMs,
        });
        return {
          status: 'generation_apply_failed',
          activeProfileId: committed.activeProfileId ?? selectedProfileId,
          generation: committed.generation,
          errorCode,
        };
      }
      lease.complete(completion);
      this.recordSessionSwitch(sessionSwitchKey, this.deps.nowMs());
      this.emitSwitchResult({
        request: input,
        loaded,
        resultStatus: 'switched',
        toProfileId: committed.activeProfileId ?? selectedProfileId,
        toGeneration: committed.generation,
        ...(applyResult?.mode ? { mode: applyResult.mode } : {}),
        success: true,
        startedAtMs,
      });
      return {
        status: 'switched',
        activeProfileId: committed.activeProfileId ?? selectedProfileId,
        generation: committed.generation,
        ...(applyResult?.mode ? { mode: applyResult.mode } : {}),
      };
    } catch (error) {
      lease.fail(error);
      throw error;
    }
  }
}
