import { afterEach, describe, expect, it, vi } from 'vitest';

import { RPC_ERROR_CODES, RPC_METHODS, SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

const sessionRpcWithServerScopeMock = vi.hoisted(() => vi.fn());
const machineRpcWithServerScopeMock = vi.hoisted(() => vi.fn());
const resolvePreferredServerIdForSessionIdMock = vi.hoisted(() => vi.fn());
const storageState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedSessionRpc', () => ({
    sessionRpcWithServerScope: (params: unknown) => sessionRpcWithServerScopeMock(params),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/serverScopedMachineRpc', () => ({
    machineRpcWithServerScope: (params: unknown) => machineRpcWithServerScopeMock(params),
}));

vi.mock('@/sync/runtime/orchestration/serverScopedRpc/resolvePreferredServerIdForSessionId', () => ({
    resolvePreferredServerIdForSessionId: (sessionId: string) => resolvePreferredServerIdForSessionIdMock(sessionId),
}));

vi.mock('@/sync/domains/state/storage', () => ({
    storage: {
        getState: () => storageState.current,
    },
}));

describe('sessionUsageLimitRecovery', () => {
    afterEach(() => {
        sessionRpcWithServerScopeMock.mockReset();
        machineRpcWithServerScopeMock.mockReset();
        resolvePreferredServerIdForSessionIdMock.mockReset();
        storageState.current = {};
    });

    it('enables wait-resume through the preferred session RPC scope', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        sessionRpcWithServerScopeMock
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true, status: 'ready' });

        const { sessionUsageLimitWaitResumeEnable } = await import('./sessionUsageLimitRecovery');
        const response = await sessionUsageLimitWaitResumeEnable('session-1', {
            issueFingerprint: 'usage-limit:codex:turn-1:1:no-reset',
            rememberPreference: true,
        });

        expect(resolvePreferredServerIdForSessionIdMock).toHaveBeenCalledWith('session-1');
        expect(sessionRpcWithServerScopeMock).toHaveBeenCalledWith({
            sessionId: 'session-1',
            serverId: 'server-owned',
            method: SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE,
            payload: {
                sessionId: 'session-1',
                issueFingerprint: 'usage-limit:codex:turn-1:1:no-reset',
                rememberPreference: true,
            },
        });
        expect(response).toEqual({ ok: true });
    });

    it('cancels wait-resume and checks current availability through usage-limit RPC methods', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        sessionRpcWithServerScopeMock
            .mockResolvedValueOnce({ ok: true })
            .mockResolvedValueOnce({ ok: true, status: 'ready' });

        const {
            sessionUsageLimitCheckNow,
            sessionUsageLimitWaitResumeCancel,
        } = await import('./sessionUsageLimitRecovery');

        await sessionUsageLimitWaitResumeCancel('session-1');
        await expect(sessionUsageLimitCheckNow('session-1')).resolves.toEqual({
            ok: true,
            status: 'ready',
        });

        expect(sessionRpcWithServerScopeMock).toHaveBeenNthCalledWith(1, {
            sessionId: 'session-1',
            serverId: 'server-owned',
            method: SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL,
            payload: { sessionId: 'session-1' },
        });
        expect(sessionRpcWithServerScopeMock).toHaveBeenNthCalledWith(2, {
            sessionId: 'session-1',
            serverId: 'server-owned',
            method: SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
            payload: { sessionId: 'session-1' },
        });
    });

    it('checks inactive sessions through the daemon-scoped usage-limit control', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: false,
                    metadata: {
                        machineId: 'machine-1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, status: 'ready' });

        const { sessionUsageLimitCheckNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitCheckNow('session-1')).resolves.toEqual({
            ok: true,
            status: 'ready',
        });

        expect(sessionRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-owned',
            method: RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW,
            payload: { sessionId: 'session-1' },
        });
    });

    it('switches usage-limit account recovery through the daemon-owned machine control', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: true,
                    metadata: {
                        machineId: 'machine-1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, status: 'waiting' });

        const { sessionUsageLimitSwitchAccountNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitSwitchAccountNow('session-1', { provider: ' codex ', serverId: 'server-route' })).resolves.toEqual({
            ok: true,
            status: 'waiting',
        });

        expect(sessionRpcWithServerScopeMock).not.toHaveBeenCalled();
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-route',
            method: RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW,
            payload: {
                sessionId: 'session-1',
                provider: 'codex',
                operation: 'switch_account_now',
            },
        });
    });

    it('preserves check-now rate-limit retry metadata from the daemon response', async () => {
        storageState.current = {
            sessions: {
                'session-1': {
                    active: false,
                    metadata: { machineId: 'machine-1', path: '/repo' },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        machineRpcWithServerScopeMock.mockResolvedValueOnce({
            ok: false,
            error: 'probe_rate_limited',
            errorCode: 'probe_rate_limited',
            retryAfterMs: 4_000,
        });

        const { sessionUsageLimitCheckNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitCheckNow('session-1')).resolves.toEqual({
            ok: false,
            error: 'probe_rate_limited',
            errorCode: 'probe_rate_limited',
            retryAfterMs: 4_000,
        });
    });

    it('checks a stale-inactive live session through session RPC when no daemon machine target is available', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: false,
                    metadata: {
                        path: '/repo',
                    },
                },
            },
            machines: {},
        };
        sessionRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, status: 'resumed' });

        const { sessionUsageLimitCheckNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitCheckNow('session-1')).resolves.toEqual({
            ok: true,
            status: 'resumed',
        });

        expect(sessionRpcWithServerScopeMock).toHaveBeenCalledWith({
            sessionId: 'session-1',
            serverId: 'server-owned',
            method: SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
            payload: { sessionId: 'session-1' },
        });
        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
    });

    it('forwards check-now provider hints to active session and daemon fallback RPCs', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: true,
                    metadata: {
                        machineId: 'machine-1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        sessionRpcWithServerScopeMock.mockRejectedValueOnce(
            Object.assign(new Error('Method not found'), { rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND }),
        );
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, status: 'ready' });

        const { sessionUsageLimitCheckNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitCheckNow('session-1', { provider: ' codex ' })).resolves.toEqual({
            ok: true,
            status: 'ready',
        });

        const payload = { sessionId: 'session-1', provider: 'codex' };
        expect(sessionRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({ payload }));
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith(expect.objectContaining({ payload }));
    });

    it('retries check-now through daemon machine RPC when stale active session RPC is method-not-found', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: true,
                    metadata: {
                        machineId: 'machine-1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        sessionRpcWithServerScopeMock.mockRejectedValueOnce(
            Object.assign(new Error('Method not found'), { rpcErrorCode: RPC_ERROR_CODES.METHOD_NOT_FOUND }),
        );
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, status: 'ready' });

        const { sessionUsageLimitCheckNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitCheckNow('session-1')).resolves.toEqual({
            ok: true,
            status: 'ready',
        });

        expect(sessionRpcWithServerScopeMock).toHaveBeenCalledWith({
            sessionId: 'session-1',
            serverId: 'server-owned',
            method: SESSION_RPC_METHODS.SESSION_USAGE_LIMIT_CHECK_NOW,
            payload: { sessionId: 'session-1' },
        });
        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-owned',
            method: RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_CHECK_NOW,
            payload: { sessionId: 'session-1' },
        });
    });

    it('keeps the live session check-now error when daemon fallback has no machine target', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: true,
                    metadata: {
                        path: '/repo',
                    },
                },
            },
            machines: {},
        };
        sessionRpcWithServerScopeMock.mockResolvedValueOnce({
            ok: false,
            error: 'unsupported_session_runtime_method:session.usageLimit.checkNow',
            errorCode: 'unsupported_session_runtime_method',
        });

        const { sessionUsageLimitCheckNow } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitCheckNow('session-1')).resolves.toEqual({
            ok: false,
            error: 'unsupported_session_runtime_method:session.usageLimit.checkNow',
            errorCode: 'unsupported_session_runtime_method',
        });

        expect(machineRpcWithServerScopeMock).not.toHaveBeenCalled();
    });

    it('retries enable through daemon machine RPC when stale active session RPC reports session-rpc-failed', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: true,
                    metadata: {
                        machineId: 'machine-1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        sessionRpcWithServerScopeMock.mockResolvedValueOnce({
            ok: false,
            error: 'session_rpc_failed',
            errorCode: 'session_rpc_failed',
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true, status: 'waiting' });

        const { sessionUsageLimitWaitResumeEnable } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitWaitResumeEnable('session-1', {
            issueFingerprint: 'usage-limit:codex:turn-1:1:no-reset',
            rememberPreference: true,
        })).resolves.toEqual({
            ok: true,
            status: 'waiting',
        });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-owned',
            method: RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_ENABLE,
            payload: {
                sessionId: 'session-1',
                issueFingerprint: 'usage-limit:codex:turn-1:1:no-reset',
                rememberPreference: true,
            },
        });
    });

    it('retries cancel through daemon machine RPC when stale active session RPC reports method-not-available', async () => {
        resolvePreferredServerIdForSessionIdMock.mockReturnValue('server-owned');
        storageState.current = {
            sessions: {
                'session-1': {
                    active: true,
                    metadata: {
                        machineId: 'machine-1',
                        path: '/repo',
                    },
                },
            },
            machines: {
                'machine-1': { id: 'machine-1', active: true },
            },
        };
        sessionRpcWithServerScopeMock.mockResolvedValueOnce({
            ok: false,
            error: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
            errorCode: RPC_ERROR_CODES.METHOD_NOT_AVAILABLE,
        });
        machineRpcWithServerScopeMock.mockResolvedValueOnce({ ok: true });

        const { sessionUsageLimitWaitResumeCancel } = await import('./sessionUsageLimitRecovery');
        await expect(sessionUsageLimitWaitResumeCancel('session-1')).resolves.toEqual({ ok: true });

        expect(machineRpcWithServerScopeMock).toHaveBeenCalledWith({
            machineId: 'machine-1',
            serverId: 'server-owned',
            method: RPC_METHODS.DAEMON_SESSION_USAGE_LIMIT_WAIT_RESUME_CANCEL,
            payload: { sessionId: 'session-1' },
        });
    });
});
