import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ConnectedServiceSwitchContinuityParams } from '@/backends/types';

import { resolveCodexConnectedServiceSwitchContinuity } from './resolveCodexConnectedServiceSwitchContinuity';

function createParams(
  overrides: Partial<ConnectedServiceSwitchContinuityParams> = {},
): ConnectedServiceSwitchContinuityParams {
  return {
    sessionId: 'session-1',
    agentId: 'codex',
    serviceId: 'openai-codex',
    previousBinding: {
      source: 'connected',
      selection: 'group',
      serviceId: 'openai-codex',
      profileId: 'old',
      groupId: 'team',
    },
    nextBinding: {
      source: 'connected',
      selection: 'group',
      serviceId: 'openai-codex',
      profileId: 'new',
      groupId: 'team',
    },
    fromBindings: {
      v: 1,
      bindingsByServiceId: {
        'openai-codex': { source: 'connected', selection: 'group', groupId: 'team', profileId: 'old' },
      },
    },
    toBindings: {
      v: 1,
      bindingsByServiceId: {
        'openai-codex': { source: 'connected', selection: 'group', groupId: 'team', profileId: 'new' },
      },
    },
    connectedServiceMaterializationIdentityV1: {
      v: 1,
      id: 'materialization-1',
      createdAtMs: 1,
    },
    vendorResumeId: 'vendor-session-1',
    targetMaterializedRoot: '/tmp/codex-materialized',
    targetMaterializedEnv: {
      CODEX_HOME: '/tmp/codex-materialized/codex-home',
      CODEX_SQLITE_HOME: '/tmp/codex-materialized/codex-home',
    },
    cwd: '/tmp/project',
    ...overrides,
  };
}

describe('resolveCodexConnectedServiceSwitchContinuity', () => {
  it('fails closed for same-group switches when exact resume reachability inputs are missing', async () => {
    await expect(resolveCodexConnectedServiceSwitchContinuity(createParams({
      targetMaterializedRoot: null,
    }))).resolves.toEqual({
      mode: 'unsupported',
      reason: 'provider_session_state_unavailable_for_resume',
    });
  });

  it('returns restart_same_home for same-group switches when codex session reachability is proven', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-codex-switch-continuity-'));
    try {
      const sessionsDir = join(root, 'codex-home', 'sessions', 'workspace');
      await mkdir(sessionsDir, { recursive: true });
      await writeFile(
        join(sessionsDir, 'rollout-2026-05-27-vendor-session-1.jsonl'),
        '{}\n',
      );

      await expect(resolveCodexConnectedServiceSwitchContinuity(createParams({
        targetMaterializedRoot: root,
        targetMaterializedEnv: {
          CODEX_HOME: join(root, 'codex-home'),
          CODEX_SQLITE_HOME: join(root, 'codex-home'),
        },
      }))).resolves.toEqual({
        mode: 'restart_same_home',
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
