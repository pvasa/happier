import { getPendingQueueWakeResumeOptions } from '@/sync/domains/pending/pendingQueueWake';
import { chooseSubmitMode, type MessageSendMode } from '@/sync/domains/session/control/submitMode';

import type {
    DirectMessageSubmitResult,
    PendingMessageSubmitResult,
    SessionSubmitPort,
    SubmitSessionUserMessageOptions,
    SubmitSessionUserMessageResult,
} from './types';

function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
}

function readLocalId(result: PendingMessageSubmitResult | DirectMessageSubmitResult): string | undefined {
    return result && typeof result === 'object' && typeof result.localId === 'string'
        ? result.localId
        : undefined;
}

function resolveSubmitMode(opts: SubmitSessionUserMessageOptions): MessageSendMode {
    const selected = chooseSubmitMode({
        configuredMode: opts.configuredMode,
        busySteerSendPolicy: opts.busySteerSendPolicy,
        explicitMode: opts.explicitMode,
        session: opts.session,
        nowMs: opts.nowMs,
    });

    if (opts.forceImmediate === true && selected === 'server_pending') {
        return 'agent_queue';
    }

    return selected;
}

async function switchRemoteAfterPendingEnqueueIfNeeded(
    port: SessionSubmitPort,
    opts: SubmitSessionUserMessageOptions,
): Promise<void> {
    if (opts.requestRemoteControlAfterPendingEnqueue !== true || !port.switchSessionControlToRemote) {
        return;
    }

    try {
        await port.switchSessionControlToRemote(opts.sessionId);
    } catch {
        // Non-fatal: the message is already persisted in the pending queue.
    }
}

async function directSend(
    port: SessionSubmitPort,
    opts: SubmitSessionUserMessageOptions,
): Promise<SubmitSessionUserMessageResult> {
    try {
        let didMarkOutboundHandoff = false;
        let handoffLocalId: string | undefined;
        const markOutboundHandoff = (localId?: string) => {
            if (didMarkOutboundHandoff) {
                return;
            }
            didMarkOutboundHandoff = true;
            handoffLocalId = localId;
            opts.onOutboundHandoff?.({
                persistence: 'transcript_committed',
                ...(localId ? { localId } : {}),
            });
        };
        const sendOptions = opts.profileId || opts.localId || opts.onOutboundHandoff
            ? {
                profileId: opts.profileId ?? undefined,
                localId: opts.localId ?? undefined,
                onLocalPendingProjectionCreated: opts.onOutboundHandoff
                    ? ({ localId }: { localId: string }) => markOutboundHandoff(localId)
                    : undefined,
            }
            : undefined;
        const sendResult = await port.sendMessage(
            opts.sessionId,
            opts.text,
            opts.displayText,
            opts.metaOverrides,
            sendOptions,
        );
        const localId = readLocalId(sendResult) ?? handoffLocalId ?? opts.localId ?? undefined;
        if (!didMarkOutboundHandoff) {
            markOutboundHandoff(localId);
        }
        return {
            type: 'success',
            persistence: 'transcript_committed',
            wake: { attempted: false, state: 'not_needed' },
            localId,
        };
    } catch (error) {
        return {
            type: 'send_failed',
            persistence: 'none',
            wake: { attempted: false, state: 'not_needed' },
            errorMessage: getErrorMessage(error, 'Failed to send message'),
        };
    }
}

async function enqueuePending(
    port: SessionSubmitPort,
    opts: SubmitSessionUserMessageOptions,
): Promise<SubmitSessionUserMessageResult> {
    const wakeOpts = getPendingQueueWakeResumeOptions({
        sessionId: opts.sessionId,
        session: opts.session,
        resumeCapabilityOptions: opts.resumeCapabilityOptions,
        resumeTargetOverride: opts.resumeTargetOverride,
        permissionOverride: opts.permissionOverride,
        nowMs: opts.nowMs,
        canWakeMachineId: port.canWakeMachineId,
    });

    let enqueueResult: PendingMessageSubmitResult;
    try {
        enqueueResult = await port.enqueuePendingMessage(
            opts.sessionId,
            opts.text,
            opts.displayText,
            opts.metaOverrides,
        );
    } catch (error) {
        return {
            type: 'send_failed',
            persistence: 'none',
            wake: { attempted: false, state: 'not_needed' },
            errorMessage: getErrorMessage(error, 'Failed to enqueue message'),
        };
    }

    const localId = readLocalId(enqueueResult);
    opts.onOutboundHandoff?.({
        persistence: 'pending',
        ...(localId ? { localId } : {}),
    });
    if (!wakeOpts) {
        return {
            type: 'wake_pending',
            persistence: 'pending',
            wake: { attempted: false, state: 'not_needed' },
            localId,
        };
    }

    const resumeOptions = {
        ...wakeOpts,
        ...(opts.serverId ? { serverId: opts.serverId } : {}),
    };

    try {
        const wakeResult = await port.resumeSession(resumeOptions);
        if (wakeResult.type === 'error') {
            await switchRemoteAfterPendingEnqueueIfNeeded(port, opts);
            return {
                type: 'wake_failed',
                persistence: 'pending',
                wake: {
                    attempted: true,
                    state: 'failed',
                    errorMessage: wakeResult.errorMessage,
                },
                errorCode: wakeResult.errorCode,
                errorMessage: wakeResult.errorMessage,
                localId,
            };
        }
    } catch (error) {
        const errorMessage = getErrorMessage(error, 'Failed to resume session');
        await switchRemoteAfterPendingEnqueueIfNeeded(port, opts);
        return {
            type: 'wake_failed',
            persistence: 'pending',
            wake: {
                attempted: true,
                state: 'failed',
                errorMessage,
            },
            errorMessage,
            localId,
        };
    }

    await switchRemoteAfterPendingEnqueueIfNeeded(port, opts);
    return {
        type: 'success',
        persistence: 'pending',
        wake: { attempted: true, state: 'started' },
        localId,
    };
}

export async function submitSessionUserMessage(
    port: SessionSubmitPort,
    opts: SubmitSessionUserMessageOptions,
): Promise<SubmitSessionUserMessageResult> {
    const mode = resolveSubmitMode(opts);

    if (mode === 'server_pending') {
        return enqueuePending(port, opts);
    }

    if (mode === 'interrupt') {
        try {
            await port.abortSession?.(opts.sessionId);
        } catch {
            // Best effort only; sending the user message still proceeds.
        }
    }

    return directSend(port, opts);
}
