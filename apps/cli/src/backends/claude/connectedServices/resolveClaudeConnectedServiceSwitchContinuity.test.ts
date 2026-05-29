import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { ConnectedServiceSwitchContinuityParams } from '@/backends/types';

import { resolveClaudeConnectedServiceSwitchContinuity } from './resolveClaudeConnectedServiceSwitchContinuity';

const CLAUDE_ROLLBACK_ENV = 'HAPPIER_CONNECTED_SERVICES_LEGACY_CLAUDE_RESTART_SAME_HOME';

const claudeEnvKeys = [
  CLAUDE_ROLLBACK_ENV,
  'CLAUDE_CONFIG_DIR',
  'HAPPIER_CLAUDE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
] as const;

const originalClaudeEnv = new Map<string, string | undefined>(
  claudeEnvKeys.map((key) => [key, process.env[key]]),
);

function restoreClaudeEnv(): void {
  for (const [key, value] of originalClaudeEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function createParams(
  overrides: Partial<ConnectedServiceSwitchContinuityParams> = {},
): ConnectedServiceSwitchContinuityParams {
  return {
    sessionId: 'session-1',
    agentId: 'claude',
    serviceId: 'anthropic',
    previousBinding: {
      source: 'connected',
      selection: 'profile',
      serviceId: 'anthropic',
      profileId: 'old',
      groupId: null,
    },
    nextBinding: {
      source: 'connected',
      selection: 'profile',
      serviceId: 'anthropic',
      profileId: 'new',
      groupId: null,
    },
    fromBindings: {
      v: 1,
      bindingsByServiceId: {
        anthropic: { source: 'connected', selection: 'profile', profileId: 'old' },
      },
    },
    toBindings: {
      v: 1,
      bindingsByServiceId: {
        anthropic: { source: 'connected', selection: 'profile', profileId: 'new' },
      },
    },
    ...overrides,
  };
}

describe('resolveClaudeConnectedServiceSwitchContinuity', () => {
  afterEach(() => {
    restoreClaudeEnv();
  });

  it('fails closed when exact restart context cannot be proven reachable', async () => {
    await expect(resolveClaudeConnectedServiceSwitchContinuity(createParams({
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'materialization-1',
        createdAtMs: 1,
      },
      vendorResumeId: 'vendor-session-1',
    }))).resolves.toEqual({
      mode: 'unsupported',
      reason: 'provider_session_state_unavailable_for_resume',
    });
  });

  it('returns restart_same_home when CLAUDE_CONFIG_DIR has the resume id in its native store', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-continuity-'));
    try {
      await mkdir(join(claudeConfigDir, 'projects', 'project-1'), { recursive: true });
      await writeFile(join(claudeConfigDir, 'projects', 'project-1', 'vendor-session-1.jsonl'), '{}\n');
      process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

      await expect(resolveClaudeConnectedServiceSwitchContinuity(createParams({
        connectedServiceMaterializationIdentityV1: {
          v: 1,
          id: 'materialization-1',
          createdAtMs: 1,
        },
        vendorResumeId: 'vendor-session-1',
      }))).resolves.toEqual({ mode: 'restart_same_home' });
    } finally {
      await rm(claudeConfigDir, { recursive: true, force: true });
    }
  });

  it('restores legacy optimistic restart behavior when rollback env is enabled', async () => {
    process.env[CLAUDE_ROLLBACK_ENV] = '1';
    await expect(resolveClaudeConnectedServiceSwitchContinuity(createParams({
      previousBinding: {
        source: 'native',
        selection: 'native',
        serviceId: 'anthropic',
        profileId: null,
        groupId: null,
      },
      fromBindings: {
        v: 1,
        bindingsByServiceId: {
          anthropic: { source: 'native' },
        },
      },
    }))).resolves.toEqual({ mode: 'restart_same_home' });
  });
});
