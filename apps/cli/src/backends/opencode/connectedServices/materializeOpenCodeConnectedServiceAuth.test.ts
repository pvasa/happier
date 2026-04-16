import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { materializeOpenCodeConnectedServiceAuth } from './materializeOpenCodeConnectedServiceAuth';

describe('materializeOpenCodeConnectedServiceAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('keeps OAuth auth materialization when refresh-token validation is unavailable due to transport failure', async () => {
    const now = Date.now();
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-opencode-connected-auth-'));
    const openaiCodex = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'default',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct_123',
        providerEmail: 'alice@example.com',
      },
    });

    const fetchMock = vi.fn(async () => {
      throw new TypeError('offline');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const result = await materializeOpenCodeConnectedServiceAuth({
      rootDir,
      openaiCodex,
      openai: null,
      anthropic: null,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.env).toMatchObject({
      XDG_DATA_HOME: join(rootDir, 'home', '.local', 'share'),
      XDG_CACHE_HOME: join(rootDir, 'xdg', 'cache'),
      XDG_CONFIG_HOME: join(rootDir, 'xdg', 'config'),
      XDG_STATE_HOME: join(rootDir, 'xdg', 'state'),
    });

    const authPath = join(result.env.XDG_DATA_HOME, 'opencode', 'auth.json');
    const authRaw = await readFile(authPath, 'utf8');
    expect(JSON.parse(authRaw)).toEqual({
      openai: {
        type: 'oauth',
        access: 'access-token',
        refresh: 'refresh-token',
        expires: now + 60_000,
        accountId: 'acct_123',
      },
    });
  });
});
