import type { Session } from '@/sync/domains/state/storageTypes';
import { isVersionSupported, MINIMUM_CLI_PENDING_QUEUE_V2_VERSION } from '@/utils/system/versionUtils';
import { getSessionLocalControlState } from '@/sync/domains/session/control/sessionLocalControl';
import { deriveSessionRuntimePresentationState } from '@/sync/domains/session/attention/deriveSessionRuntimePresentationState';

export type MessageSendMode = 'agent_queue' | 'interrupt' | 'server_pending';

export type BusySteerSendPolicy = 'steer_immediately' | 'server_pending';

export const DEFAULT_BUSY_STEER_SEND_POLICY: BusySteerSendPolicy = 'steer_immediately';

export type SessionMessageDeliveryIntent =
    | 'default'
    | 'explicit_pending'
    | 'explicit_immediate'
    | 'interrupt';

export type PendingQueueSubmitSupportState =
    | 'supported'
    | 'unknown_session'
    | 'unknown_pending_version'
    | 'unsupported_cli_version';

export type SessionMessageDirectBypassReason =
    | 'selected_direct'
    | 'force_immediate'
    | 'interrupt'
    | 'subagent_control_command'
    | 'voice_turn_immediate'
    | 'voice_post_process'
    | 'server_scoped_rpc_active'
    | 'spawned_session_follow_up';

export type SessionMessageDeliveryDecision = Readonly<{
    mode: MessageSendMode;
    intent: SessionMessageDeliveryIntent;
    reason: string;
    pendingSupportState: PendingQueueSubmitSupportState;
    directBypassReason?: SessionMessageDirectBypassReason;
}>;

type SessionSubmitRuntimeState = Readonly<{
    localControlBlocksDirectSubmit: boolean;
    isBusy: boolean;
    isOnline: boolean;
    agentReady: boolean;
    inFlightSteerSupported: boolean | undefined;
    inFlightSteerAvailable: boolean | undefined;
}>;

function deriveSubmitRuntimeState(session: Session | null, nowMs: number): SessionSubmitRuntimeState {
    const localControl = getSessionLocalControlState(session);
    const localControlBlocksDirectSubmit = localControl?.attached === true && localControl.remoteWritable !== true;
    const runtimeStatus = deriveSessionRuntimePresentationState({
        active: session?.active,
        activeAt: session?.activeAt,
        presence: session?.presence,
        thinking: session?.thinking,
        thinkingAt: session?.thinkingAt,
        latestTurnStatus: session?.latestTurnStatus,
        latestTurnStatusObservedAt: session?.latestTurnStatusObservedAt,
        meaningfulActivityAt: session?.meaningfulActivityAt,
    }, nowMs);
    const capabilities = session?.agentState?.capabilities;
    return {
        localControlBlocksDirectSubmit,
        isBusy: runtimeStatus.working,
        isOnline: session?.presence === 'online',
        agentReady: Boolean(session && session.agentStateVersion > 0),
        inFlightSteerSupported: capabilities?.inFlightSteerSupported ?? capabilities?.inFlightSteer,
        inFlightSteerAvailable: capabilities?.inFlightSteerAvailable ?? capabilities?.inFlightSteer,
    };
}

export function canDirectSubmitUserMessageNow(opts: {
    session: Session | null;
    nowMs?: number;
}): boolean {
    if (!opts.session || opts.session.active === false) {
        return false;
    }

    const runtimeState = deriveSubmitRuntimeState(opts.session, opts.nowMs ?? Date.now());
    if (runtimeState.localControlBlocksDirectSubmit || !runtimeState.isOnline || !runtimeState.agentReady) {
        return false;
    }

    if (!runtimeState.isBusy) {
        return true;
    }

    return runtimeState.inFlightSteerSupported === true && runtimeState.inFlightSteerAvailable === true;
}

export function isPendingQueueSubmitKnownUnsupported(session: Session | null): boolean {
    return getPendingQueueSubmitSupportState(session) === 'unsupported_cli_version';
}

export function getPendingQueueSubmitSupportState(session: Session | null): PendingQueueSubmitSupportState {
    if (!session) {
        return 'unknown_session';
    }

    if (typeof session.pendingVersion !== 'number') {
        return 'unknown_pending_version';
    }

    const cliVersion = session?.metadata?.version;
    const trimmedCliVersion = typeof cliVersion === 'string' ? cliVersion.trim() : '';
    if (trimmedCliVersion && !isVersionSupported(trimmedCliVersion, MINIMUM_CLI_PENDING_QUEUE_V2_VERSION)) {
        return 'unsupported_cli_version';
    }

    return 'supported';
}

function getDeliveryIntent(opts: {
    configuredMode: MessageSendMode;
    explicitMode?: MessageSendMode;
    forceImmediate?: boolean;
}): SessionMessageDeliveryIntent {
    const requestedMode = opts.explicitMode ?? opts.configuredMode;
    if (requestedMode === 'interrupt') {
        return 'interrupt';
    }
    if (opts.forceImmediate === true) {
        return 'explicit_immediate';
    }
    if (opts.explicitMode === 'server_pending') {
        return 'explicit_pending';
    }
    return 'default';
}

function withDirectReason(
    decision: Omit<SessionMessageDeliveryDecision, 'directBypassReason'>,
): SessionMessageDeliveryDecision {
    if (decision.mode === 'interrupt') {
        return { ...decision, directBypassReason: 'interrupt' };
    }
    if (decision.mode === 'agent_queue') {
        return {
            ...decision,
            directBypassReason: decision.intent === 'explicit_immediate' ? 'force_immediate' : 'selected_direct',
        };
    }
    return decision;
}

export function decideSessionMessageDelivery(opts: {
    configuredMode: MessageSendMode;
    busySteerSendPolicy?: BusySteerSendPolicy;
    explicitMode?: MessageSendMode;
    session: Session | null;
    nowMs?: number;
    forceImmediate?: boolean;
}): SessionMessageDeliveryDecision {
    const configuredMode = opts.configuredMode;
    const requestedMode = opts.explicitMode ?? configuredMode;
    const intent = getDeliveryIntent(opts);
    const pendingSupportState = getPendingQueueSubmitSupportState(opts.session);
    if (requestedMode === 'interrupt') {
        return withDirectReason({
            mode: 'interrupt',
            intent,
            reason: 'interrupt',
            pendingSupportState,
        });
    }

    const session = opts.session;
    if (
        opts.forceImmediate === true
        && canDirectSubmitUserMessageNow({ session, nowMs: opts.nowMs })
    ) {
        return withDirectReason({
            mode: 'agent_queue',
            intent,
            reason: 'force_immediate_direct',
            pendingSupportState,
        });
    }

    // Server-side pending queue V2 support is negotiated via session summary fields.
    // Mixed-version safety: older servers won't include these fields.
    const supportsQueue = typeof session?.pendingVersion === 'number';
    if (!supportsQueue) {
        // Missing support metadata is an unknown state, not permission to bypass an
        // explicit queueing intent. Preserve server_pending so callers fail closed
        // through the queue path instead of steering directly.
        return withDirectReason({
            mode: requestedMode,
            intent,
            reason: requestedMode === 'server_pending' ? 'pending_support_unknown' : 'pending_support_unknown_preserve_request',
            pendingSupportState,
        });
    }

    // If we have an explicit CLI version published, gate server_pending on it to avoid
    // stranded pending messages when an older agent is attached.
    const cliVersion = session?.metadata?.version;
    const trimmedCliVersion = typeof cliVersion === 'string' ? cliVersion.trim() : '';
    if (trimmedCliVersion) {
        if (!isVersionSupported(trimmedCliVersion, MINIMUM_CLI_PENDING_QUEUE_V2_VERSION)) {
            return withDirectReason({
                mode: requestedMode === 'server_pending' ? 'agent_queue' : requestedMode,
                intent,
                reason: requestedMode === 'server_pending' ? 'pending_unsupported_cli_fallback' : 'pending_unsupported_cli_preserve_request',
                pendingSupportState,
            });
        }
    }

    if (opts.explicitMode === 'server_pending') {
        return {
            mode: 'server_pending',
            intent,
            reason: 'explicit_pending',
            pendingSupportState,
        };
    }

    if (session?.active === false) {
        return {
            mode: 'server_pending',
            intent,
            reason: 'inactive_session',
            pendingSupportState,
        };
    }

    const runtimeState = deriveSubmitRuntimeState(session, opts.nowMs ?? Date.now());
    const busySteerSendPolicy: BusySteerSendPolicy = opts.busySteerSendPolicy ?? DEFAULT_BUSY_STEER_SEND_POLICY;

    // Prefer the metadata-backed queue when:
    // - terminal has control (can't safely inject into local stdin),
    // - the agent is busy (user may want to edit/remove before processing),
    // - the agent is not ready yet (direct sends can be missed because the agent does not replay backlog), or
    // - the machine is offline (queue gives reliable eventual processing once it reconnects).
    //
    // Exception: if the agent supports in-flight steer and is online+ready, do NOT auto-enqueue while busy.
    // Steering preserves the current turn (Codex-style) and is the more intuitive default.
    if (
        runtimeState.isBusy
        && runtimeState.inFlightSteerSupported === true
        && runtimeState.inFlightSteerAvailable === true
        && !runtimeState.localControlBlocksDirectSubmit
        && runtimeState.isOnline
        && runtimeState.agentReady
        && busySteerSendPolicy === 'steer_immediately'
    ) {
        return withDirectReason({
            mode: 'agent_queue',
            intent,
            reason: 'busy_steer_immediate',
            pendingSupportState,
        });
    }

    if (runtimeState.localControlBlocksDirectSubmit) {
        return {
            mode: 'server_pending',
            intent,
            reason: 'local_control_pending',
            pendingSupportState,
        };
    }

    if (runtimeState.isBusy) {
        return {
            mode: 'server_pending',
            intent,
            reason: 'busy_policy_pending',
            pendingSupportState,
        };
    }

    if (!runtimeState.isOnline) {
        return {
            mode: 'server_pending',
            intent,
            reason: 'offline_pending',
            pendingSupportState,
        };
    }

    if (!runtimeState.agentReady) {
        return {
            mode: 'server_pending',
            intent,
            reason: 'agent_not_ready_pending',
            pendingSupportState,
        };
    }

    return withDirectReason({
        mode: configuredMode,
        intent,
        reason: 'configured_mode',
        pendingSupportState,
    });
}

export function chooseSubmitMode(opts: {
    configuredMode: MessageSendMode;
    busySteerSendPolicy?: BusySteerSendPolicy;
    explicitMode?: MessageSendMode;
    session: Session | null;
    nowMs?: number;
}): MessageSendMode {
    return decideSessionMessageDelivery(opts).mode;
}

export function chooseForceImmediateSubmitMode(opts: {
    configuredMode: MessageSendMode;
    busySteerSendPolicy?: BusySteerSendPolicy;
    explicitMode?: MessageSendMode;
    session: Session | null;
    nowMs?: number;
}): MessageSendMode {
    return decideSessionMessageDelivery({ ...opts, forceImmediate: true }).mode;
}
