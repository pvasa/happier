import { RPC_ERROR_CODES, RPC_METHODS, SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';
import { readRpcErrorCode } from '@happier-dev/protocol/rpcErrors';

import { storage } from '@/sync/domains/state/storage';
import { resolvePreferredServerIdForSessionId } from '@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId';
import { machineRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc';
import { sessionRpcWithServerScope } from '@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc';
import { readMachineControlTargetForSession } from './sessionMachineTarget';

export type SessionUsageLimitRecoveryOperationResult =
    | Readonly<{
        ok: true;
        status?: SessionUsageLimitRecoveryOperationStatus;
    }>
    | Readonly<{ ok: false; error: string; errorCode?: string; retryAfterMs?: number }>;

type SessionUsageLimitRecoveryOperationStatus = 'ready' | 'waiting' | 'resumed' | 'exhausted' | 'inactive';

type UsageLimitRecoveryPayload = Readonly<{
    sessionId: string;
    issueFingerprint?: string | null;
    rememberPreference?: boolean;
}>;

const STALE_ACTIVE_SESSION_RPC_FALLBACK_ERRORS = new Set<string>([
    RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
    RPC_ERROR_CODES.METHOD_NOT_FOUND,
    'session_rpc_failed',
    'unsupported',
    'unsupported_session_runtime_method',
]);

function readOperationStatus(value: unknown): SessionUsageLimitRecoveryOperationStatus | undefined {
    if (
        value === 'ready'
        || value === 'waiting'
        || value === 'resumed'
        || value === 'exhausted'
        || value === 'inactive'
    ) {
        return value;
    }
    return undefined;
}

function readUsageLimitRecoveryOperationResult(response: unknown): SessionUsageLimitRecoveryOperationResult {
    if (!response || typeof response !== 'object') {
        return { ok: false, error: 'Unsupported response from session RPC' };
    }
    const raw = response as Record<string, unknown>;
    if (raw.ok === true) {
        const status = readOperationStatus(raw.status);
        return {
            ok: true,
            ...(status ? { status } : {}),
        };
    }
    if (typeof raw.error === 'string') {
        const retryAfterMs = typeof raw.retryAfterMs === 'number' && Number.isFinite(raw.retryAfterMs) && raw.retryAfterMs >= 0
            ? Math.trunc(raw.retryAfterMs)
            : null;
        return {
            ok: false,
            error: raw.error,
            ...(typeof raw.errorCode === 'string' ? { errorCode: raw.errorCode } : {}),
            ...(retryAfterMs !== null ? { retryAfterMs } : {}),
        };
    }
    return { ok: false, error: 'Unsupported response from session RPC' };
}

function readFallbackErrorTokens(value: unknown): ReadonlyArray<string> {
    const tokens: string[] = [];
    const rpcErrorCode = readRpcErrorCode(value);
    if (rpcErrorCode) tokens.push(rpcErrorCode);

    if (value && typeof value === 'object') {
        const raw = value as Record<string, unknown>;
        if (typeof raw.errorCode === 'string') tokens.push(raw.errorCode);
        if (typeof raw.error === 'string') tokens.push(raw.error);
        if (typeof raw.message === 'string') tokens.push(raw.message);
    } else if (typeof value === 'string') {
        tokens.push(value);
    }

    return tokens;
}

function shouldFallbackFromStaleActiveSessionRpcFailure(value: unknown): boolean {
    return readFallbackErrorTokens(value).some((token) => (
        STALE_ACTIVE_SESSION_RPC_FALLBACK_ERRORS.has(token)
        || token.startsWith('unsupported_session_runtime_method:')
    ));
}

function isInactiveSession(sessionId: string): boolean {
    return storage.getState().sessions?.[sessionId]?.active === false;
}

async function runUsageLimitRecoveryMachineRpc(
    sessionId: string,
    method: string,
    payload: UsageLimitRecoveryPayload,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    const target = readMachineControlTargetForSession(sessionId);
    if (!target) {
        return {
            ok: false,
            error: 'session_usage_limit_recovery_control_machine_unavailable',
            errorCode: 'session_usage_limit_recovery_control_machine_unavailable',
        };
    }

    try {
        const response = await machineRpcWithServerScope<SessionUsageLimitRecoveryOperationResult, UsageLimitRecoveryPayload>({
            machineId: target.machineId,
            serverId: opts?.serverId ?? resolvePreferredServerIdForSessionId(sessionId),
            method,
            payload,
        });
        return readUsageLimitRecoveryOperationResult(response);
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}

async function runUsageLimitRecoveryRpc(
    sessionId: string,
    method: string,
    payload: UsageLimitRecoveryPayload,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    try {
        const response = await sessionRpcWithServerScope<SessionUsageLimitRecoveryOperationResult, UsageLimitRecoveryPayload>({
            sessionId,
            serverId: opts?.serverId ?? resolvePreferredServerIdForSessionId(sessionId),
            method,
            payload,
        });
        return readUsageLimitRecoveryOperationResult(response);
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            errorCode: readRpcErrorCode(error),
        };
    }
}

async function runUsageLimitRecoveryRpcWithMachineFallback(
    sessionId: string,
    sessionMethod: string,
    machineMethod: string,
    payload: UsageLimitRecoveryPayload,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    const result = await runUsageLimitRecoveryRpc(sessionId, sessionMethod, payload, opts);
    if (result.ok === false && shouldFallbackFromStaleActiveSessionRpcFailure(result)) {
        if (!readMachineControlTargetForSession(sessionId)) {
            return result;
        }
        return await runUsageLimitRecoveryMachineRpc(sessionId, machineMethod, payload, opts);
    }
    return result;
}

export function sessionUsageLimitWaitResumeEnable(
    sessionId: string,
    request?: Readonly<{ issueFingerprint?: string | null; rememberPreference?: boolean }>,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    const payload = {
        sessionId,
        ...(typeof request?.issueFingerprint === 'string' && request.issueFingerprint.trim().length > 0
            ? { issueFingerprint: request.issueFingerprint.trim() }
            : request?.issueFingerprint === null
                ? { issueFingerprint: null }
                : {}),
        ...(request?.rememberPreference === true ? { rememberPreference: true } : {}),
    };
    if (isInactiveSession(sessionId)) {
        return runUsageLimitRecoveryMachineRpc(
            sessionId,
            RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE,
            payload,
            opts,
        );
    }
    return runUsageLimitRecoveryRpcWithMachineFallback(
        sessionId,
        SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE,
        RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE,
        payload,
        opts,
    );
}

export function sessionUsageLimitWaitResumeCancel(
    sessionId: string,
    opts?: Readonly<{ serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    const payload = { sessionId };
    if (isInactiveSession(sessionId)) {
        return runUsageLimitRecoveryMachineRpc(
            sessionId,
            RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL,
            payload,
            opts,
        );
    }
    return runUsageLimitRecoveryRpcWithMachineFallback(
        sessionId,
        SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL,
        RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL,
        payload,
        opts,
    );
}

export async function sessionUsageLimitCheckNow(
    sessionId: string,
    opts?: Readonly<{ provider?: string | null; serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    const provider = typeof opts?.provider === 'string' ? opts.provider.trim() : '';
    const payload = {
        sessionId,
        ...(provider.length > 0 ? { provider } : {}),
    };
    if (isInactiveSession(sessionId)) {
        if (!readMachineControlTargetForSession(sessionId)) {
            return await runUsageLimitRecoveryRpc(
                sessionId,
                SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
                payload,
                opts,
            );
        }
        return await runUsageLimitRecoveryMachineRpc(
            sessionId,
            RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW,
            payload,
            opts,
        );
    }
    return runUsageLimitRecoveryRpcWithMachineFallback(
        sessionId,
        SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
        RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW,
        payload,
        opts,
    );
}

export async function sessionUsageLimitSwitchAccountNow(
    sessionId: string,
    opts?: Readonly<{ provider?: string | null; serverId?: string | null }>,
): Promise<SessionUsageLimitRecoveryOperationResult> {
    const provider = typeof opts?.provider === 'string' ? opts.provider.trim() : '';
    const payload = {
        sessionId,
        ...(provider.length > 0 ? { provider } : {}),
        operation: 'switch_account_now' as const,
    };
    return await runUsageLimitRecoveryMachineRpc(
        sessionId,
        RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW,
        payload,
        opts,
    );
}
