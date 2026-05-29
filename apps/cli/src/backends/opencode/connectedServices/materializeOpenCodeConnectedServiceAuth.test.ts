import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { materializeOpenCodeConnectedServiceAuth } from './materializeOpenCodeConnectedServiceAuth';

describe('materializeOpenCodeConnectedServiceAuth', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('materializes OAuth auth content without probing the refresh token', async () => {
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
      claudeSubscription: null,
      anthropic: null,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.parse(result.env.OPENCODE_AUTH_CONTENT ?? '{}')).toEqual({
      openai: {
        type: 'oauth',
        access: 'access-token',
        refresh: 'refresh-token',
        expires: now + 60_000,
        accountId: 'acct_123',
      },
    });
    expect(result.env).not.toHaveProperty('XDG_DATA_HOME');
    expect(result.env).not.toHaveProperty('XDG_CACHE_HOME');
    expect(result.env).not.toHaveProperty('XDG_CONFIG_HOME');
    expect(result.env).not.toHaveProperty('XDG_STATE_HOME');
  });

  it('materializes API key credentials into legacy OPENCODE_AUTH_CONTENT without writing disk auth', async () => {
    const now = Date.now();
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-opencode-connected-auth-'));
    const openai = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai',
      profileId: 'openai-key',
      kind: 'token',
      token: { token: 'sk-openai-test', providerAccountId: null, providerEmail: null },
    });
    const anthropic = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'anthropic',
      profileId: 'anthropic-key',
      kind: 'token',
      token: { token: 'sk-anthropic-test', providerAccountId: null, providerEmail: null },
    });

    const result = await materializeOpenCodeConnectedServiceAuth({
      rootDir,
      openaiCodex: null,
      openai,
      claudeSubscription: null,
      anthropic,
    });

    expect(JSON.parse(result.env.OPENCODE_AUTH_CONTENT ?? '{}')).toEqual({
      openai: {
        type: 'api',
        key: 'sk-openai-test',
      },
      anthropic: {
        type: 'api',
        key: 'sk-anthropic-test',
      },
    });
    expect(result.env.XDG_DATA_HOME).toBeUndefined();
  });

  it('materializes Claude subscription setup tokens as Anthropic API auth for OpenCode', async () => {
    const now = Date.now();
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-opencode-connected-auth-'));
    const claudeSubscription = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'claude-subscription',
      profileId: 'claude-pro',
      kind: 'token',
      token: { token: 'sk-ant-oat01-pro', providerAccountId: null, providerEmail: null },
    });

    const result = await materializeOpenCodeConnectedServiceAuth({
      rootDir,
      openaiCodex: null,
      openai: null,
      claudeSubscription,
      anthropic: null,
    });

    expect(JSON.parse(result.env.OPENCODE_AUTH_CONTENT ?? '{}')).toEqual({
      anthropic: {
        type: 'api',
        key: 'sk-ant-oat01-pro',
      },
    });
  });

  it('rejects Claude subscription OAuth because OpenCode only supports setup-token materialization', async () => {
    const now = Date.now();
    const rootDir = await mkdtemp(join(tmpdir(), 'happier-opencode-connected-auth-'));
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

    await expect(materializeOpenCodeConnectedServiceAuth({
      rootDir,
      openaiCodex: null,
      openai: null,
      claudeSubscription,
      anthropic: null,
    })).rejects.toThrow(/Claude subscription OAuth credentials.*setup-token/);
  });
});
