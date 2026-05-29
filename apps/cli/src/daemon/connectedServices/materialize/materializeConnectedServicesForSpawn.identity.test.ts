import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { materializeConnectedServicesForSpawn } from './materializeConnectedServicesForSpawn';

describe('materializeConnectedServicesForSpawn materialization identity', () => {
  it('uses the stable materialization identity instead of the transient spawn key for provider-local auth homes', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-identity-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-identity-'));
    const record = buildConnectedServiceCredentialRecord({
      now: 10,
      serviceId: 'anthropic',
      profileId: 'work',
      kind: 'token',
      token: {
        token: 'sk-ant-test',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const identity = {
      v: 1,
      id: 'csm_stable_pi_1',
      createdAtMs: 123,
    } as const;
    const params = {
      agentId: 'pi',
      materializationKey: 'spawn-transient-1',
      connectedServiceMaterializationIdentityV1: identity,
      activeServerDir,
      baseDir,
      recordsByServiceId: new Map([['anthropic', record]]),
    } satisfies Parameters<typeof materializeConnectedServicesForSpawn>[0] & {
      connectedServiceMaterializationIdentityV1: typeof identity;
    };

    const result = await materializeConnectedServicesForSpawn(params);

    expect(result).not.toBeNull();
    expect(result!.env.PI_CODING_AGENT_DIR).toBe(
      join(baseDir, identity.id, 'pi', 'pi-agent-dir'),
    );
    await expect(readFile(join(result!.env.PI_CODING_AGENT_DIR, 'auth.json'), 'utf8')).resolves.toContain('sk-ant-test');
  });
});
