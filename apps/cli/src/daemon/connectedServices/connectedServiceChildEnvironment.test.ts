import { describe, expect, it } from 'vitest';

import {
  HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY,
  HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY,
  readConnectedServiceMaterializedEnvKeysFromEnv,
  resolveConnectedServiceRuntimeAuthContextFromEnv,
  resolveConnectedServiceRuntimeAuthContextFromSelection,
  serializeConnectedServiceMaterializedEnvKeys,
} from './connectedServiceChildEnvironment';

describe('connectedServiceChildEnvironment runtime auth context', () => {
  it('resolves group selections to the active profile and group id', () => {
    expect(resolveConnectedServiceRuntimeAuthContextFromSelection({
      kind: 'group',
      serviceId: 'openai-codex',
      groupId: 'happier',
      activeProfileId: 'bot',
      fallbackProfileId: 'leeroy',
      generation: 3,
    }, 'openai-codex')).toEqual({
      serviceId: 'openai-codex',
      profileId: 'bot',
      groupId: 'happier',
    });
  });

  it('resolves profile selections without a group id', () => {
    expect(resolveConnectedServiceRuntimeAuthContextFromSelection({
      kind: 'profile',
      serviceId: 'openai-codex',
      profileId: 'leeroy',
    }, 'openai-codex')).toEqual({
      serviceId: 'openai-codex',
      profileId: 'leeroy',
      groupId: null,
    });
  });

  it('resolves selections from child process env', () => {
    expect(resolveConnectedServiceRuntimeAuthContextFromEnv({
      [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'happier',
        activeProfileId: 'bot',
        fallbackProfileId: 'leeroy',
        generation: 3,
      }]),
    }, 'openai-codex')).toEqual({
      serviceId: 'openai-codex',
      profileId: 'bot',
      groupId: 'happier',
    });
  });

  it('serializes materialized env keys without values', () => {
    const serialized = serializeConnectedServiceMaterializedEnvKeys({
      CLAUDE_CODE_OAUTH_TOKEN: 'secret-token',
      CLAUDE_CONFIG_DIR: '/tmp/connected-claude',
    });

    expect(serialized).not.toContain('secret-token');
    expect(readConnectedServiceMaterializedEnvKeysFromEnv({
      [HAPPIER_CONNECTED_SERVICE_MATERIALIZED_ENV_KEYS_ENV_KEY]: serialized ?? undefined,
    })).toEqual(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR']);
  });
});
