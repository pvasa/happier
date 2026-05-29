import { describe, expect, it, vi } from 'vitest';

import { buildCodexAgentRuntimeDescriptor } from '@happier-dev/agents';

import { forkCodexAppServerConversationNative } from './nativeFork';
import { codexAppServerProviderNativeForkHandler } from './providerNativeForkHandler';

vi.mock('./nativeFork', () => ({
  forkCodexAppServerConversationNative: vi.fn(async () => ({ vendorSessionId: 'forked-thread' })),
}));

describe('codexAppServerProviderNativeForkHandler', () => {
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
  });
});
