import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildCodexAgentRuntimeDescriptor } from '@happier-dev/agents';

import { logger } from '@/utils/logger';

import { forkCodexAppServerConversationNative } from './nativeFork';
import { codexAppServerProviderNativeForkHandler } from './providerNativeForkHandler';

vi.mock('@/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
  },
}));

vi.mock('./nativeFork', () => ({
  forkCodexAppServerConversationNative: vi.fn(async () => ({ vendorSessionId: 'forked-thread' })),
}));

describe('codexAppServerProviderNativeForkHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(forkCodexAppServerConversationNative).mockResolvedValue({ vendorSessionId: 'forked-thread' });
  });
  it('preserves connected-service group affinity in fork metadata', async () => {
    const parentMetadata = {
      agentRuntimeDescriptorV1: buildCodexAgentRuntimeDescriptor({
        backendMode: 'appServer',
        vendorSessionId: 'parent-thread',
        home: 'connectedService',
        connectedServiceId: 'openai-codex',
        connectedServiceGroupId: 'main',
        homePath: '/tmp/connected-codex-home',
      }),
    };

    const result = await codexAppServerProviderNativeForkHandler({
      credentials: {} as never,
      agentId: 'codex',
      parentSessionId: 'session-parent',
      parentRawSession: { metadata: parentMetadata },
      parentMetadata,
      directory: '/repo',
      forkPoint: { type: 'latest' },
      targetSeqInclusive: 10,
    });

    expect(forkCodexAppServerConversationNative).toHaveBeenCalledWith({
      directory: '/repo',
      parentCodexSessionId: 'parent-thread',
      processEnv: expect.objectContaining({ CODEX_HOME: '/tmp/connected-codex-home' }),
    });
    expect(logger.debug).toHaveBeenCalledWith(
      '[CodexAppServerFork] attempting native latest fork',
      expect.objectContaining({
        agentId: 'codex',
        parentSessionId: 'session-parent',
        backendMode: 'appServer',
        forkPointType: 'latest',
        hasRuntimeDescriptor: true,
        hasVendorSessionId: true,
        hasRuntimeHomePath: true,
      }),
    );
        expect(logger.debug).toHaveBeenCalledWith(
      '[CodexAppServerFork] native latest fork succeeded',
      expect.objectContaining({
        agentId: 'codex',
        parentSessionId: 'session-parent',
        hasForkedVendorSessionId: true,
        fallbackResult: 'native_fork_succeeded',
      }),
    );
    expect(result?.metadata.agentRuntimeDescriptorV1).toMatchObject({
      providerId: 'codex',
      provider: {
        vendorSessionId: 'forked-thread',
        home: 'connectedService',
        connectedServiceId: 'openai-codex',
        connectedServiceGroupId: 'main',
        providerExtra: {
          runtimeAffinity: {
            vendorSessionId: 'forked-thread',
            home: 'connectedService',
            connectedServiceId: 'openai-codex',
            connectedServiceGroupId: 'main',
          },
        },
      },
    });
    expect(JSON.stringify(result?.metadata.agentRuntimeDescriptorV1)).not.toContain('/tmp/connected-codex-home');
  });

  it('logs an explicit skip reason for non-latest fork points', async () => {
    const parentMetadata = {
      agentRuntimeDescriptorV1: buildCodexAgentRuntimeDescriptor({
        backendMode: 'appServer',
        vendorSessionId: 'parent-thread',
        home: 'connectedService',
        connectedServiceId: 'openai-codex',
        connectedServiceGroupId: 'main',
        homePath: '/tmp/connected-codex-home',
      }),
    };

    const result = await codexAppServerProviderNativeForkHandler({
      credentials: {} as never,
      agentId: 'codex',
      parentSessionId: 'session-parent',
      parentRawSession: { metadata: parentMetadata },
      parentMetadata,
      directory: '/repo',
      forkPoint: { type: 'seq', upToSeqInclusive: 10 },
      targetSeqInclusive: 10,
    });

    expect(result).toBeNull();
    expect(forkCodexAppServerConversationNative).not.toHaveBeenCalled();
        expect(logger.debug).toHaveBeenCalledWith(
      '[CodexAppServerFork] skipping native fork',
      expect.objectContaining({
        agentId: 'codex',
        parentSessionId: 'session-parent',
        backendMode: 'appServer',
        forkPointType: 'seq',
        skipReason: 'fork_point_not_latest',
        hasVendorSessionId: true,
        fallbackResult: 'fallback_to_replay',
      }),
    );
  });

  it('logs native helper failures before falling back', async () => {
    vi.mocked(forkCodexAppServerConversationNative).mockRejectedValueOnce(new Error('app server launch failed'));
    const parentMetadata = {
      codexBackendMode: 'appServer',
      codexSessionId: 'parent-thread',
    };

    const result = await codexAppServerProviderNativeForkHandler({
      credentials: {} as never,
      agentId: 'codex',
      parentSessionId: 'session-parent',
      parentRawSession: { metadata: parentMetadata },
      parentMetadata,
      directory: '/repo',
      forkPoint: { type: 'latest' },
      targetSeqInclusive: 10,
    });

    expect(result).toBeNull();
        expect(logger.debug).toHaveBeenCalledWith(
      '[CodexAppServerFork] native latest fork failed',
      expect.objectContaining({
        agentId: 'codex',
        parentSessionId: 'session-parent',
        errorMessage: 'app server launch failed',
        fallbackResult: 'fallback_to_replay',
      }),
    );
  });

  it('redacts sensitive values from provider-level native fork failure diagnostics', async () => {
    const parentVendorSessionId = '019d94f3-0a6f-7c41-bb18-d26425384658';
    const bearerToken = 'sk-proj-provider-wrapper-secret-token-1234567890';
    const accessToken = 'access-token-provider-wrapper-secret-abcdef';
    const authHeaderToken = 'auth-header-provider-wrapper-secret-uvwxyz';
    const threadId = 'thread_provider_wrapper_secret_abcdef';
    const failure = Object.assign(
      new Error(`failed parent ${parentVendorSessionId}; Authorization: Bearer ${bearerToken}; accessToken=${accessToken}; authHeader=Bearer ${authHeaderToken}; CODEX_THREAD_ID=${threadId}`),
      { code: 'E_PROVIDER_FORK' },
    );
    vi.mocked(forkCodexAppServerConversationNative).mockRejectedValueOnce(failure);
    const parentMetadata = {
      codexBackendMode: 'appServer',
      codexSessionId: parentVendorSessionId,
    };

    const result = await codexAppServerProviderNativeForkHandler({
      credentials: {} as never,
      agentId: 'codex',
      parentSessionId: 'session-parent',
      parentRawSession: { metadata: parentMetadata },
      parentMetadata,
      directory: '/repo',
      forkPoint: { type: 'latest' },
      targetSeqInclusive: 10,
    });

    expect(result).toBeNull();
    const serializedDiagnostics = JSON.stringify(vi.mocked(logger.debug).mock.calls);
    expect(serializedDiagnostics).not.toContain(parentVendorSessionId);
    expect(serializedDiagnostics).not.toContain(bearerToken);
    expect(serializedDiagnostics).not.toContain(accessToken);
    expect(serializedDiagnostics).not.toContain(authHeaderToken);
    expect(serializedDiagnostics).not.toContain(threadId);

    expect(logger.debug).toHaveBeenCalledWith(
      '[CodexAppServerFork] native latest fork failed',
      expect.objectContaining({
        agentId: 'codex',
        parentSessionId: 'session-parent',
        errorName: 'Error',
        errorCode: 'E_PROVIDER_FORK',
        fallbackResult: 'fallback_to_replay',
      }),
    );
    const failedCall = vi.mocked(logger.debug).mock.calls.find(([message]) => message === '[CodexAppServerFork] native latest fork failed');
    const errorMessage = String((failedCall?.[1] as { errorMessage?: unknown } | undefined)?.errorMessage ?? '');
    expect(errorMessage).toContain('failed parent');
    expect(errorMessage).toContain('[REDACTED]');
  });

  it('does not include raw vendor resume ids in provider-level fork diagnostics', async () => {
    vi.mocked(forkCodexAppServerConversationNative).mockResolvedValueOnce(null);
    const parentMetadata = {
      codexBackendMode: 'appServer',
      codexSessionId: 'raw-parent-provider-thread-id',
    };

    await expect(codexAppServerProviderNativeForkHandler({
      credentials: {} as never,
      agentId: 'codex',
      parentSessionId: 'session-parent',
      parentRawSession: { metadata: parentMetadata },
      parentMetadata,
      directory: '/repo',
      forkPoint: { type: 'latest' },
      targetSeqInclusive: 10,
    })).resolves.toBeNull();

    expect(JSON.stringify(vi.mocked(logger.debug).mock.calls)).not.toContain('raw-parent-provider-thread-id');
  });
});
