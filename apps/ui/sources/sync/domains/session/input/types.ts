import type { ResumeCapabilityOptions } from '@/agents/runtime/resumeCapabilities';
import type { PermissionModeOverrideForSpawn } from '@/sync/domains/permissions/permissionModeOverride';
import type { BusySteerSendPolicy, MessageSendMode } from '@/sync/domains/session/control/submitMode';
import type { Session } from '@/sync/domains/state/storageTypes';
import type { ResumeSessionOptions, ResumeSessionResult } from '@/sync/ops/sessions';

export type SubmitResultType =
    | 'success'
    | 'wake_pending'
    | 'wake_failed'
    | 'send_failed'
    | 'rejected';

export type SubmitPersistence =
    | 'pending'
    | 'transcript_committed'
    | 'provider_direct'
    | 'none';

export type SubmitWakeState =
    | 'not_needed'
    | 'started'
    | 'already_active'
    | 'failed';

export type SubmitSessionUserMessageResult = Readonly<{
    type: SubmitResultType;
    persistence: SubmitPersistence;
    wake: Readonly<{
        attempted: boolean;
        state: SubmitWakeState;
        errorMessage?: string;
    }>;
    errorCode?: string;
    errorMessage?: string;
    localId?: string;
}>;

export type SubmitSessionOutboundHandoff = Readonly<{
    persistence: Extract<SubmitPersistence, 'pending' | 'transcript_committed' | 'provider_direct'>;
    localId?: string;
}>;

export type SessionSubmitWakeTargetOverride = Readonly<{
    machineId?: string | null;
    directory?: string | null;
}>;

export type SubmitSessionUserMessageOptions = Readonly<{
    sessionId: string;
    session: Session;
    text: string;
    displayText?: string;
    metaOverrides?: Record<string, unknown>;
    configuredMode: MessageSendMode;
    busySteerSendPolicy?: BusySteerSendPolicy;
    explicitMode?: MessageSendMode;
    forceImmediate?: boolean;
    profileId?: string | null;
    localId?: string | null;
    resumeCapabilityOptions: ResumeCapabilityOptions;
    resumeTargetOverride?: SessionSubmitWakeTargetOverride | null;
    permissionOverride?: PermissionModeOverrideForSpawn | null;
    serverId?: string | null;
    requestRemoteControlAfterPendingEnqueue?: boolean;
    onOutboundHandoff?: (handoff: SubmitSessionOutboundHandoff) => void;
    nowMs?: number;
}>;

export type PendingMessageSubmitResult = Readonly<{
    localId?: string;
}> | void;

export type DirectMessageSubmitResult = Readonly<{
    localId?: string;
    seq?: number;
}> | void;

export type DirectMessageLocalPendingProjection = Readonly<{
    localId: string;
}>;

export interface SessionSubmitPort {
    enqueuePendingMessage(
        sessionId: string,
        text: string,
        displayText?: string,
        metaOverrides?: Record<string, unknown>,
    ): Promise<PendingMessageSubmitResult>;
    sendMessage(
        sessionId: string,
        text: string,
        displayText?: string,
        metaOverrides?: Record<string, unknown>,
        options?: Readonly<{
            profileId?: string | null;
            localId?: string | null;
            onLocalPendingProjectionCreated?: (event: DirectMessageLocalPendingProjection) => void;
        }>,
    ): Promise<DirectMessageSubmitResult>;
    resumeSession(options: ResumeSessionOptions): Promise<ResumeSessionResult>;
    abortSession?(sessionId: string): Promise<void>;
    switchSessionControlToRemote?(sessionId: string): Promise<void>;
    canWakeMachineId?(machineId: string): boolean;
}
