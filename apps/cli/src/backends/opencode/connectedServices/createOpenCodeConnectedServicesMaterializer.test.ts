import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { describe, expect, it } from 'vitest';

import { createOpenCodeConnectedServicesMaterializer } from './createOpenCodeConnectedServicesMaterializer';

describe('createOpenCodeConnectedServicesMaterializer', () => {
  it('uses selected Claude subscription group records in the identity-scoped home', async () => {
    const now = Date.now();
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-opencode-active-server-'));
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-opencode-base-'));
    const rootDir = join(baseDir, 'launch', 'opencode');
    const defaultProfile = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'default-profile',
      kind: 'token',
      token: {
        token: 'sk-ant-oat01-default',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const selectedProfile = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'selected-profile',
      kind: 'token',
      token: {
        token: 'sk-ant-oat01-selected',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const materializer = createOpenCodeConnectedServicesMaterializer();

    const result = await materializer({
      agentId: 'opencode',
      activeServerDir,
      rootDir,
      recordsByServiceId: new Map([['claude-subscription', defaultProfile]]),
      selectionsByServiceId: new Map([[
        'claude-subscription',
        {
          kind: 'group',
          serviceId: 'claude-subscription',
          groupId: 'team-claude',
          activeProfileId: 'selected-profile',
          fallbackProfileId: 'fallback-profile',
          generation: 3,
          record: selectedProfile,
          policy: { v: 1, strategy: 'priority' },
        },
      ]]),
      cleanupRoot: async () => {},
    });

    expect(result?.env.OPENCODE_AUTH_CONTENT).toBe(JSON.stringify({
      anthropic: {
        type: 'api',
        key: 'sk-ant-oat01-selected',
      },
    }));
    expect(result?.env.XDG_DATA_HOME).toBeUndefined();
  });

  it('materializes Claude subscription setup tokens as Anthropic API auth', async () => {
    const now = Date.now();
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-opencode-active-server-'));
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-opencode-base-'));
    const rootDir = join(baseDir, 'launch', 'opencode');
    const claudeSubscription = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'claude-pro',
      kind: 'token',
      token: {
        token: 'sk-ant-oat01-pro',
        providerAccountId: null,
        providerEmail: null,
      },
    });
    const materializer = createOpenCodeConnectedServicesMaterializer();

    const result = await materializer({
      agentId: 'opencode',
      activeServerDir,
      rootDir,
      recordsByServiceId: new Map([['claude-subscription', claudeSubscription]]),
      selectionsByServiceId: new Map(),
      cleanupRoot: async () => {},
    });

    expect(result?.env.OPENCODE_AUTH_CONTENT).toBe(JSON.stringify({
      anthropic: {
        type: 'api',
        key: 'sk-ant-oat01-pro',
      },
    }));
    expect(result?.env.XDG_DATA_HOME).toBeUndefined();
  });

  it('rejects Claude subscription OAuth because OpenCode only supports setup-token materialization', async () => {
    const now = Date.now();
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-opencode-active-server-'));
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-opencode-base-'));
    const rootDir = join(baseDir, 'launch', 'opencode');
    const claudeSubscription = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'claude-oauth',
      kind: 'oauth',
      expiresAt: now + 60_000,
      oauth: {
        accessToken: 'claude-access',
        refreshToken: 'claude-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'claude-account',
        providerEmail: 'claude@example.com',
      },
    });
    const materializer = createOpenCodeConnectedServicesMaterializer();

    await expect(materializer({
      agentId: 'opencode',
      activeServerDir,
      rootDir,
      recordsByServiceId: new Map([['claude-subscription', claudeSubscription]]),
      selectionsByServiceId: new Map(),
      cleanupRoot: async () => {},
    })).rejects.toThrow(/Claude subscription OAuth credentials.*setup-token/);
  });
});
