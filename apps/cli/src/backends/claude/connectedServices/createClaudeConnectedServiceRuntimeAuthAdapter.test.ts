import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';

import { createClaudeConnectedServiceRuntimeAuthAdapter } from './createClaudeConnectedServiceRuntimeAuthAdapter';
import { CLAUDE_RUNTIME_AUTH_HOT_APPLY_METADATA_KEY } from './claudeRuntimeAuthHotApplyMetadata';
import { CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE } from './nativeAuth/claudeCodeCredentialScopes';
import { writeClaudeCodeCredentialsFile } from './nativeAuth/claudeCodeCredentialFile';

const FUTURE_EXPIRES_AT_MS = Date.now() + 60 * 60 * 1000;
const ORIGINAL_PLATFORM_DESCRIPTOR = Object.getOwnPropertyDescriptor(process, 'platform');

describe('createClaudeConnectedServiceRuntimeAuthAdapter', () => {
  beforeEach(() => {
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, 'platform', { ...ORIGINAL_PLATFORM_DESCRIPTOR, value: 'linux' });
    }
  });

  afterEach(() => {
    if (ORIGINAL_PLATFORM_DESCRIPTOR) {
      Object.defineProperty(process, 'platform', ORIGINAL_PLATFORM_DESCRIPTOR);
    }
  });

  it('does not treat healthy Claude subscription native credentials as runtime account adoption proof', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-native-auth-test-'));
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'claude-subscription',
      profileId: 'oauth',
      kind: 'oauth',
      expiresAt: FUTURE_EXPIRES_AT_MS,
      oauth: {
        accessToken: 'access-placeholder',
        refreshToken: 'refresh-placeholder',
        idToken: null,
        scope: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE,
        tokenType: 'Bearer',
        providerAccountId: 'provider-account',
        providerEmail: null,
      },
    });
    await writeClaudeCodeCredentialsFile({
      claudeConfigDir,
      payload: {
        claudeAiOauth: {
          accessToken: 'access-placeholder',
          refreshToken: 'refresh-placeholder',
          expiresAt: FUTURE_EXPIRES_AT_MS,
          scopes: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE.split(' '),
        },
      },
    });

    const result = await createClaudeConnectedServiceRuntimeAuthAdapter().verifyActiveAccount?.({
      target: { agentId: 'claude' },
      selection: {
        record,
        targetMaterializedEnv: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      },
    });

    expect(result).toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'claude_code_runtime_account_adoption_unproven',
      errorClassification: {
        missingScopes: [],
      },
    });
  });

  it('fails closed when the materialized Claude native credential file is already expired', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-native-auth-test-'));
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'claude-subscription',
      profileId: 'oauth',
      kind: 'oauth',
      expiresAt: FUTURE_EXPIRES_AT_MS,
      oauth: {
        accessToken: 'access-placeholder',
        refreshToken: 'refresh-placeholder',
        idToken: null,
        scope: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE,
        tokenType: 'Bearer',
        providerAccountId: 'provider-account',
        providerEmail: null,
      },
    });
    await writeClaudeCodeCredentialsFile({
      claudeConfigDir,
      payload: {
        claudeAiOauth: {
          accessToken: 'access-placeholder',
          refreshToken: 'refresh-placeholder',
          expiresAt: Date.now() - 60 * 60 * 1000,
          scopes: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE.split(' '),
        },
      },
    });

    const result = await createClaudeConnectedServiceRuntimeAuthAdapter().verifyActiveAccount?.({
      target: { agentId: 'claude' },
      selection: {
        record,
        targetMaterializedEnv: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      },
    });

    expect(result).toEqual({
      status: 'unavailable',
      retryable: true,
      reason: 'expired',
      errorClassification: {
        missingScopes: [],
      },
    });
  });

  it('fails closed when the materialized Claude native credential file is missing', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-native-auth-test-'));
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'claude-subscription',
      profileId: 'oauth',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access-placeholder',
        refreshToken: 'refresh-placeholder',
        idToken: null,
        scope: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE,
        tokenType: 'Bearer',
        providerAccountId: 'provider-account',
        providerEmail: null,
      },
    });

    const result = await createClaudeConnectedServiceRuntimeAuthAdapter().verifyActiveAccount?.({
      target: { agentId: 'claude' },
      selection: {
        record,
        targetMaterializedEnv: { CLAUDE_CONFIG_DIR: claudeConfigDir },
      },
    });

    expect(result).toEqual({
      status: 'unavailable',
      retryable: false,
      reason: 'missing_credentials_file',
      errorClassification: {
        missingScopes: [],
      },
    });
  });

  it('fails closed when the selected Claude subscription OAuth record cannot materialize native auth', async () => {
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'claude-subscription',
      profileId: 'oauth',
      kind: 'oauth',
      expiresAt: 2000,
      oauth: {
        accessToken: 'access-placeholder',
        refreshToken: 'refresh-placeholder',
        idToken: null,
        scope: 'user:profile user:inference',
        tokenType: 'Bearer',
        providerAccountId: 'provider-account',
        providerEmail: null,
      },
    });

    const result = await createClaudeConnectedServiceRuntimeAuthAdapter().verifyActiveAccount?.({
      target: { agentId: 'claude' },
      selection: { record },
    });

    expect(result).toEqual({
      status: 'unavailable',
      retryable: false,
      reason: 'missing_required_scope',
      errorClassification: {
        missingScopes: ['user:sessions:claude_code'],
      },
    });
  });

  it('hot-applies Claude subscription credentials into the shared group runtime config dir', async () => {
    const sourceClaudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-hot-source-'));
    const runtimeClaudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-hot-group-config-'));
    await writeFile(join(sourceClaudeConfigDir, 'settings.json'), '{"theme":"source"}\n');
    await writeClaudeCodeCredentialsFile({
      claudeConfigDir: runtimeClaudeConfigDir,
      payload: {
        claudeAiOauth: {
          accessToken: 'old-access-placeholder',
          refreshToken: 'old-refresh-placeholder',
          expiresAt: FUTURE_EXPIRES_AT_MS,
          scopes: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE.split(' '),
        },
      },
    });
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'claude-subscription',
      profileId: 'oauth',
      kind: 'oauth',
      expiresAt: FUTURE_EXPIRES_AT_MS,
      oauth: {
        accessToken: 'new-access-placeholder',
        refreshToken: 'new-refresh-placeholder',
        idToken: null,
        scope: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE,
        tokenType: 'Bearer',
        providerAccountId: 'provider-account',
        providerEmail: null,
      },
    });
    const selection = {
      record,
      targetMaterializedEnv: { CLAUDE_CONFIG_DIR: runtimeClaudeConfigDir },
      targetMaterializedRoot: runtimeClaudeConfigDir,
      [CLAUDE_RUNTIME_AUTH_HOT_APPLY_METADATA_KEY]: {
        mode: 'group_runtime_config_rewrite',
        runtimeClaudeConfigDir,
        runtimeMaterializedRoot: runtimeClaudeConfigDir,
        sourceClaudeConfigDir,
      },
    };

    const adapter = createClaudeConnectedServiceRuntimeAuthAdapter();
    expect(adapter.canHotApply({ target: { agentId: 'claude' }, selection })).toMatchObject({
      supported: true,
      mode: 'claude_subscription_group_runtime_config_rewrite',
    });
    await expect(adapter.hotApply({ target: { agentId: 'claude' }, selection })).resolves.toMatchObject({
      applied: true,
      reason: 'claude_runtime_config_rewritten',
    });

    const credential = JSON.parse(await readFile(join(runtimeClaudeConfigDir, '.credentials.json'), 'utf8'));
    expect(credential.claudeAiOauth.accessToken).toBe('new-access-placeholder');
    await expect(readFile(join(runtimeClaudeConfigDir, 'settings.json'), 'utf8')).resolves.toBe('{"theme":"source"}\n');
  });

  it('weakly verifies probe-backed Claude group runtime config hot-apply without treating ordinary native auth health as exact account proof', async () => {
    const sourceClaudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-hot-source-'));
    const runtimeClaudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-hot-group-config-'));
    const record = buildConnectedServiceCredentialRecord({
      now: 1000,
      serviceId: 'claude-subscription',
      profileId: 'oauth',
      kind: 'oauth',
      expiresAt: FUTURE_EXPIRES_AT_MS,
      oauth: {
        accessToken: 'access-placeholder',
        refreshToken: 'refresh-placeholder',
        idToken: null,
        scope: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE,
        tokenType: 'Bearer',
        providerAccountId: 'provider-account',
        providerEmail: null,
      },
    });
    await writeClaudeCodeCredentialsFile({
      claudeConfigDir: runtimeClaudeConfigDir,
      payload: {
        claudeAiOauth: {
          accessToken: 'access-placeholder',
          refreshToken: 'refresh-placeholder',
          expiresAt: FUTURE_EXPIRES_AT_MS,
          scopes: CLAUDE_CODE_RECOMMENDED_OAUTH_SCOPE.split(' '),
        },
      },
    });

    await expect(createClaudeConnectedServiceRuntimeAuthAdapter().verifyActiveAccount?.({
      target: { agentId: 'claude' },
      selection: {
        record,
        targetMaterializedEnv: { CLAUDE_CONFIG_DIR: runtimeClaudeConfigDir },
        targetMaterializedRoot: runtimeClaudeConfigDir,
        [CLAUDE_RUNTIME_AUTH_HOT_APPLY_METADATA_KEY]: {
          mode: 'group_runtime_config_rewrite',
          runtimeClaudeConfigDir,
          runtimeMaterializedRoot: runtimeClaudeConfigDir,
          sourceClaudeConfigDir,
        },
      },
    })).resolves.toEqual({
      status: 'weakly_verified',
      providerAccountId: 'provider-account',
      reason: 'claude_runtime_config_rewrite_probe_supported',
    });
  });
});
