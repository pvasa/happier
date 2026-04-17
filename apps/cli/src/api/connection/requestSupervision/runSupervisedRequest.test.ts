import { describe, expect, it, vi } from 'vitest';

import type { ManagedConnectionSupervisor, ManagedConnectionState, ReadinessProbeResult } from '@happier-dev/connection-supervisor';

import { HttpStatusError, readHttpStatus } from '@/api/client/httpStatusError';

import { assertManagedConnectionReadyForRequest } from './assertManagedConnectionReadyForRequest';
import { reportRequestOutcomeToSupervisor } from './reportRequestOutcomeToSupervisor';
import { runSupervisedRequest } from './runSupervisedRequest';

function createState(overrides: Partial<ManagedConnectionState> = {}): ManagedConnectionState {
  return {
    phase: 'online',
    reason: null,
    attempt: 0,
    nextRetryAt: null,
    lastConnectedAt: Date.now(),
    lastDisconnectedAt: null,
    lastErrorMessage: null,
    ...overrides,
  };
}

function createSupervisor(state: ManagedConnectionState = createState()): ManagedConnectionSupervisor {
  return {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    getState: vi.fn(() => state),
    reportProbeResult: vi.fn(),
  };
}

describe('request supervision', () => {
  it('fails fast when the managed connection is already auth_failed', async () => {
    const supervisor = createSupervisor(createState({ phase: 'auth_failed', reason: 'auth_invalid' }));

    expect(() => assertManagedConnectionReadyForRequest(supervisor.getState(), { requireAuth: true })).toThrowError(
      expect.objectContaining({
        name: 'HttpStatusError',
        message: 'Authentication required',
        code: 'not_authenticated',
      }),
    );
    expect(() => assertManagedConnectionReadyForRequest(createState({ phase: 'offline', reason: 'server_unreachable' }))).toThrowError(
      expect.objectContaining({
        name: 'HttpStatusError',
        message: 'Server is currently unreachable',
      }),
    );
    try {
      assertManagedConnectionReadyForRequest(supervisor.getState(), { requireAuth: true });
    } catch (error) {
      expect(readHttpStatus(error)).toBe(401);
    }

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        request: async () => 'ok',
      }),
    ).rejects.toMatchObject({
      name: 'HttpStatusError',
      message: 'Authentication required',
    });
  });

  it('allows requests to proceed while offline when online gating is disabled', async () => {
    const supervisor = createSupervisor(createState({ phase: 'offline', reason: 'server_unreachable' }));

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        requireOnline: false,
        request: async () => 'ok',
      }),
    ).resolves.toBe('ok');
  });

  it('reports terminal auth errors back into the supervisor', async () => {
    const supervisor = createSupervisor();

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        request: async () => {
          throw new HttpStatusError(401, 'expired token');
        },
      }),
    ).rejects.toThrow(/expired token/i);

    expect(supervisor.reportProbeResult).toHaveBeenCalledWith({
      status: 'auth_failed',
      statusCode: 401,
      errorMessage: 'expired token',
    } satisfies ReadinessProbeResult);
  });

  it('reports socket connect auth errors back into the supervisor', async () => {
    const supervisor = createSupervisor();
    const socketAuthError = Object.assign(new Error('invalid token'), {
      data: {
        statusCode: 401,
        error: 'invalid-token',
      },
    });

    await expect(
      runSupervisedRequest({
        supervisor,
        requireAuth: true,
        request: async () => {
          throw socketAuthError;
        },
      }),
    ).rejects.toBe(socketAuthError);

    expect(supervisor.reportProbeResult).toHaveBeenCalledWith({
      status: 'auth_failed',
      statusCode: 401,
      errorMessage: 'invalid token',
    } satisfies ReadinessProbeResult);
  });

  it('reports retryable response and transport failures without inventing domain semantics', () => {
    const supervisor = createSupervisor();
    const connectionError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), {
      code: 'ECONNREFUSED',
    });

    reportRequestOutcomeToSupervisor({
      supervisor,
      statusCode: 503,
      error: new HttpStatusError(503, 'busy'),
      hadAuth: true,
    });

    reportRequestOutcomeToSupervisor({
      supervisor,
      error: connectionError,
      hadAuth: true,
    });

    reportRequestOutcomeToSupervisor({
      supervisor,
      error: new Error('domain validation failed'),
      hadAuth: true,
    });

    expect(supervisor.reportProbeResult).toHaveBeenNthCalledWith(1, {
      status: 'retry_later',
      errorMessage: 'busy',
    } satisfies ReadinessProbeResult);
    expect(supervisor.reportProbeResult).toHaveBeenNthCalledWith(2, {
      status: 'server_unreachable',
      errorMessage: 'connect ECONNREFUSED 127.0.0.1:443',
    } satisfies ReadinessProbeResult);
    expect(supervisor.reportProbeResult).toHaveBeenCalledTimes(2);
  });
});
