import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { normalizeMaterializationKeyForPath } from './normalizeMaterializationKeyForPath';

describe('materializeConnectedServicesForSpawn atomicity', () => {
  afterEach(() => {
    vi.doUnmock('@/backends/catalog');
    vi.resetModules();
  });

  it('cleans only the staging attempt root when provider materialization fails', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-atomicity-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-atomicity-server-'));
    const activeRoot = join(baseDir, normalizeMaterializationKeyForPath('session-live'), 'codex');
    await mkdir(activeRoot, { recursive: true });
    await writeFile(join(activeRoot, 'auth.json'), '{"access_token":"live"}\n');

    vi.doMock('@/backends/catalog', () => ({
      getConnectedServiceMaterializer: async () => async (params: { rootDir: string; cleanupRoot: () => void }) => {
        await mkdir(params.rootDir, { recursive: true });
        await writeFile(join(params.rootDir, 'auth.json'), '{"access_token":"attempt"}\n');
        params.cleanupRoot();
        throw new Error('materialization failed');
      },
    }));

    const { materializeConnectedServicesForSpawn } = await import('./materializeConnectedServicesForSpawn');
    const record = buildConnectedServiceCredentialRecord({
      now: 10,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'token',
      token: { token: 'sk-test', providerAccountId: null, providerEmail: null },
    });

    await expect(materializeConnectedServicesForSpawn({
      agentId: 'codex',
      materializationKey: 'session-live',
      activeServerDir,
      baseDir,
      recordsByServiceId: new Map([['openai-codex', record]]),
    })).rejects.toThrow('materialization failed');

    await expect(readFile(join(activeRoot, 'auth.json'), 'utf8')).resolves.toContain('live');
  });
});
