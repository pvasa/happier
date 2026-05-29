import { describe, expect, it } from 'vitest';

function buildJwt(payload: Record<string, unknown>): string {
  return [
    'hdr',
    Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url'),
    'sig',
  ].join('.');
}

describe('connected account descriptors', () => {
  it('describes existing connected service credential families', async () => {
    const mod = await import('./connectedAccountDescriptors').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected connected account descriptor module');

    expect(mod.getConnectedAccountDescriptor('openai-codex')).toMatchObject({
      id: 'openai-codex',
      displayName: 'OpenAI Codex',
      credentialKind: 'oauth',
      oauth: {
        refreshTokenBody: 'form',
      },
    });
    expect(mod.getConnectedAccountDescriptor('openai')).toMatchObject({
      id: 'openai',
      credentialKind: 'token',
    });
    expect(mod.getConnectedAccountDescriptor('anthropic')).toMatchObject({
      id: 'anthropic',
      credentialKind: 'token',
    });
    expect(mod.getConnectedAccountDescriptor('claude-subscription')).toMatchObject({
      id: 'claude-subscription',
      credentialKind: 'oauth',
      oauth: {
        refreshTokenBody: 'json',
      },
    });
    expect(mod.getConnectedAccountDescriptor('gemini')).toMatchObject({
      id: 'gemini',
      credentialKind: 'oauth',
      oauth: {
        refreshTokenBody: 'form',
      },
    });
    expect(mod.getConnectedAccountDescriptor('github')).toMatchObject({
      id: 'github',
      displayName: 'GitHub',
      credentialKind: 'token',
      ui: {
        oauthAddActionModes: [],
      },
    });
  });

  it('resolves OAuth config from descriptor defaults and env overrides', async () => {
    const mod = await import('./connectedAccountDescriptors').catch(() => null);
    expect(mod).not.toBeNull();
    if (!mod) throw new Error('expected connected account descriptor module');

    const config = mod.resolveConnectedAccountOauthConfig('gemini', {
      HAPPIER_CONNECTED_SERVICES_GEMINI_OAUTH_CLIENT_ID: 'env-client',
      HAPPIER_CONNECTED_SERVICES_GEMINI_OAUTH_CLIENT_SECRET: 'env-secret',
      HAPPIER_CONNECTED_SERVICES_GEMINI_OAUTH_TOKEN_URL: 'https://example.test/token',
    });

    expect(config).toEqual({
      clientId: 'env-client',
      clientSecret: 'env-secret',
      tokenUrl: 'https://example.test/token',
      refreshTokenBody: 'form',
      scopes: expect.any(Array),
    });
  });

  it('maps OpenAI Codex OAuth id_token claims to friendly account identity', async () => {
    const mod = await import('./connectedAccountDescriptors');
    const descriptor = mod.requireConnectedAccountDescriptor('openai-codex');
    const mapped = descriptor.oauth?.mapCredentialPayload({
      now: 1_000,
      payload: {
        access_token: 'access',
        refresh_token: 'refresh',
        id_token: buildJwt({
          chatgpt_account_id: 'acct-from-token',
          email: 'codex-user@example.test',
        }),
        expires_in: 60,
      },
    });

    expect(mapped).toMatchObject({
      providerAccountId: 'acct-from-token',
      providerEmail: 'codex-user@example.test',
    });
  });

  it('resolves provider-facing display names from the descriptor catalog', async () => {
    const mod = await import('./connectedAccountDescriptors');

    expect(mod.resolveConnectedServiceProviderDisplayName('openai-codex')).toBe('OpenAI');
    expect(mod.resolveConnectedServiceProviderDisplayName('claude-subscription')).toBe('Claude');
    expect(mod.resolveConnectedServiceProviderDisplayName('claude-subscription', 'Claude subscription')).toBe('Claude');
    expect(mod.resolveConnectedServiceProviderDisplayName('unknown-service')).toBe('Provider');
  });
});
