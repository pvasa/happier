import { describe, expect, it } from 'vitest';

import { agent } from './index';

describe('Claude connected-service credential lifecycle descriptor', () => {
  it('enables predictive soft switching for live sessions while relying on hot-apply guards', async () => {
    await expect(agent.getConnectedServiceCredentialLifecycleDescriptor()).resolves.toMatchObject({
      providerId: 'claude',
      serviceIds: expect.arrayContaining(['claude-subscription', 'anthropic']),
      spawnPreflightOauthRefresh: { mode: 'force' },
      refreshedCredentialApplication: { mode: 'restart_required' },
      predictiveSoftSwitch: { mode: 'supported' },
    });
  });
});
