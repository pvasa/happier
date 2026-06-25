import { describe, expect, it, vi } from 'vitest';

import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from './connectedServices/connectedServiceChildEnvironment';
import { registerConnectedServiceTrackedSessionTargetsForDaemon } from './startDaemon';
import type { TrackedSession } from './types';

describe('registerConnectedServiceTrackedSessionTargetsForDaemon', () => {
  it('registers a reattached connected-service session with refresh and quota coordinators', () => {
    const connectedServiceSelectionsEnv = {
      [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'team',
        activeProfileId: 'codex1',
        fallbackProfileId: 'codex2',
        generation: 7,
      }]),
    };
    const tracked: TrackedSession = {
      pid: 6510,
      startedBy: 'daemon',
      happySessionId: 'sess-reattached-connected-service',
      reattachedFromDiskMarker: true,
      spawnOptions: {
        directory: '/tmp/reattached-workspace',
        backendTarget: { kind: 'builtInAgent', agentId: 'codex' },
        connectedServiceMaterializationIdentityV1: {
          v: 1,
          id: 'csm_reattached_connected_service',
          createdAtMs: 1_000,
        },
        connectedServices: {
          v: 1,
          bindingsByServiceId: {
            'openai-codex': {
              source: 'connected',
              selection: 'group',
              groupId: 'team',
              profileId: 'codex1',
            },
          },
        },
        environmentVariables: connectedServiceSelectionsEnv,
      },
    };
    const connectedServiceRefreshCoordinator = {
      registerSpawnTarget: vi.fn(),
    };
    const connectedServiceQuotasCoordinator = {
      registerSpawnTarget: vi.fn(),
      updateSpawnTargetSessionId: vi.fn(),
    };

    registerConnectedServiceTrackedSessionTargetsForDaemon({
      tracked,
      connectedServiceRefreshCoordinator,
      connectedServiceQuotasCoordinator,
    });

    expect(connectedServiceQuotasCoordinator.updateSpawnTargetSessionId).toHaveBeenCalledWith({
      pid: 6510,
      sessionId: 'sess-reattached-connected-service',
    });
    expect(connectedServiceRefreshCoordinator.registerSpawnTarget).toHaveBeenCalledWith({
      pid: 6510,
      agentId: 'codex',
      sessionId: 'sess-reattached-connected-service',
      materializationKey: 'csm_reattached_connected_service',
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'csm_reattached_connected_service',
        createdAtMs: 1_000,
      },
      sessionDirectory: '/tmp/reattached-workspace',
      connectedServicesBindingsRaw: tracked.spawnOptions?.connectedServices,
      connectedServiceSelectionsEnv,
    });
    expect(connectedServiceQuotasCoordinator.registerSpawnTarget).toHaveBeenCalledWith({
      pid: 6510,
      sessionId: 'sess-reattached-connected-service',
      connectedServicesBindingsRaw: tracked.spawnOptions?.connectedServices,
      connectedServiceSelectionsEnv,
    });
  });
});
