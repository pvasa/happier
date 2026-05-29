import { describe, expect, it, vi } from 'vitest';
import { buildConnectedServiceCredentialRecord, type ConnectedServiceBindingsV1 } from '@happier-dev/protocol';

import type { ApiClient } from '@/api/api';
import type { TrackedSession } from '@/daemon/types';
import type { Credentials } from '@/persistence';
import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import { materializeSessionConnectedServiceRuntimeAuthSelection } from './materializeSessionConnectedServiceRuntimeAuthSelection';

describe('materializeSessionConnectedServiceRuntimeAuthSelection', () => {
  it('preserves group fallback profile and generation from the current session selection env', async () => {
    const record = buildConnectedServiceCredentialRecord({
      now: 1_000,
      serviceId: 'anthropic',
      profileId: 'backup',
      kind: 'token',
      token: {
        token: 'sk-ant',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
    };
    const credentials: Credentials = {
      token: 'token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const previousBindings: ConnectedServiceBindingsV1 = {
      v: 1,
      bindingsByServiceId: {
        anthropic: { source: 'connected', selection: 'group', groupId: 'work', profileId: 'primary' },
      },
    };
    const tracked: TrackedSession = {
      startedBy: 'daemon',
      happySessionId: 'sess_1',
      pid: 123,
      spawnOptions: {
        directory: '/tmp/project',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        connectedServices: previousBindings,
        environmentVariables: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([
            {
              kind: 'group',
              serviceId: 'anthropic',
              groupId: 'work',
              activeProfileId: 'primary',
              fallbackProfileId: 'fallback',
              generation: 7,
            },
          ]),
        },
      },
    };

    const normalizedBindings = {
      v: 1,
      bindingsByServiceId: {
        anthropic: { source: 'connected', selection: 'group', groupId: 'work', profileId: 'backup' },
      },
    } as const;

    await expect(materializeSessionConnectedServiceRuntimeAuthSelection({
      credentials,
      api: api as unknown as ApiClient,
      input: {
        tracked,
        sessionId: 'sess_1',
        agentId: 'claude',
        serviceId: 'anthropic',
        previous: {
          source: 'connected',
          selection: 'group',
          serviceId: 'anthropic',
          profileId: 'primary',
          groupId: 'work',
        },
        next: {
          source: 'connected',
          selection: 'group',
          serviceId: 'anthropic',
          profileId: 'backup',
          groupId: 'work',
        },
        previousBindings,
        normalizedBindings,
      },
    })).resolves.toMatchObject({
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'work',
      activeProfileId: 'backup',
      fallbackProfileId: 'fallback',
      generation: 7,
      record,
    });
  });

  it('prefers authoritative group metadata over stale current session selection env', async () => {
    const record = buildConnectedServiceCredentialRecord({
      now: 1_000,
      serviceId: 'anthropic',
      profileId: 'backup',
      kind: 'token',
      token: {
        token: 'sk-ant',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: record } })),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
    };
    const credentials: Credentials = {
      token: 'token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(1) },
    };
    const previousBindings: ConnectedServiceBindingsV1 = {
      v: 1,
      bindingsByServiceId: {
        anthropic: { source: 'connected', selection: 'group', groupId: 'work', profileId: 'primary' },
      },
    };
    const tracked: TrackedSession = {
      startedBy: 'daemon',
      happySessionId: 'sess_1',
      pid: 123,
      spawnOptions: {
        directory: '/tmp/project',
        backendTarget: { kind: 'builtInAgent', agentId: 'claude' },
        connectedServices: previousBindings,
        environmentVariables: {
          [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([
            {
              kind: 'group',
              serviceId: 'anthropic',
              groupId: 'work',
              activeProfileId: 'primary',
              fallbackProfileId: 'stale-fallback',
              generation: 7,
            },
          ]),
        },
      },
    };
    const normalizedBindings = {
      v: 1,
      bindingsByServiceId: {
        anthropic: { source: 'connected', selection: 'group', groupId: 'work', profileId: 'backup' },
      },
    } as const;

    await expect(materializeSessionConnectedServiceRuntimeAuthSelection({
      credentials,
      api: api as unknown as ApiClient,
      input: {
        tracked,
        sessionId: 'sess_1',
        agentId: 'claude',
        serviceId: 'anthropic',
        previous: {
          source: 'connected',
          selection: 'group',
          serviceId: 'anthropic',
          profileId: 'primary',
          groupId: 'work',
        },
        next: {
          source: 'connected',
          selection: 'group',
          serviceId: 'anthropic',
          profileId: 'backup',
          groupId: 'work',
        },
        previousBindings,
        normalizedBindings,
        groupMetadata: {
          groupId: 'work',
          activeProfileId: 'backup',
          fallbackProfileId: 'fresh-fallback',
          generation: 8,
        },
      },
    })).resolves.toMatchObject({
      serviceId: 'anthropic',
      profileId: 'backup',
      groupId: 'work',
      activeProfileId: 'backup',
      fallbackProfileId: 'fresh-fallback',
      generation: 8,
      record,
    });
  });
});
