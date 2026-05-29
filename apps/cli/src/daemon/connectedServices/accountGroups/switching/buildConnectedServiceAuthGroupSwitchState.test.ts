import { describe, expect, it } from 'vitest';
import { ConnectedServiceAuthGroupPolicyV1Schema, type ConnectedServiceAuthGroupV1 } from '@happier-dev/protocol';

import { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '../quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';
import { buildConnectedServiceAuthGroupSwitchState } from './buildConnectedServiceAuthGroupSwitchState';

function groupWithPersistedState(state: ConnectedServiceAuthGroupV1['members'][number]['state']): ConnectedServiceAuthGroupV1 {
  return {
    v: 1,
    serviceId: 'openai-codex',
    groupId: 'main',
    displayName: 'Main',
    policy: ConnectedServiceAuthGroupPolicyV1Schema.parse({ autoSwitch: true }),
    activeProfileId: 'primary',
    generation: 7,
    state: { v: 1 },
    members: [
      {
        v: 1,
        serviceId: 'openai-codex',
        groupId: 'main',
        profileId: 'primary',
        priority: 1,
        enabled: true,
        state,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('buildConnectedServiceAuthGroupSwitchState', () => {
  it('preserves recognized persisted member runtime state used by candidate selection', () => {
    const switchState = buildConnectedServiceAuthGroupSwitchState({
      group: groupWithPersistedState({
        credentialHealthStatus: 'connected',
        cooldownUntilMs: 2_000,
        lastFailureKind: 'usage_limit',
        lastObservedAtMs: 1_500,
        providerResetsAtMs: 3_000,
      }),
      runtimeQuotaSnapshots: new ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore(),
      nowMs: 1_750,
    });

    expect(switchState.memberStatesByProfileId.get('primary')).toMatchObject({
      credentialHealthStatus: 'connected',
      cooldownUntilMs: 2_000,
      lastFailureKind: 'usage_limit',
      lastObservedAtMs: 1_500,
      providerResetsAtMs: 3_000,
    });
  });
});
