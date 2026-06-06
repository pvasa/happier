import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceSwitchTargetMaterializedContext } from './resolveConnectedServiceSwitchTargetMaterializedContext';

const IDENTITY = { v: 1 as const, id: 'csm_abc', createdAtMs: 123 };
const BASE = '/base/materialized';
// A real native env: multiple absolute paths with DISTINCT parents → no single derivable root and no
// explicit materialized-root key. This is what a tracked native session carries at switch time.
const NATIVE_ENV = { PATH: '/usr/bin', HOME: '/Users/leeroy', TMPDIR: '/var/tmp' } as const;

describe('resolveConnectedServiceSwitchTargetMaterializedContext', () => {
  it('reconstructs the deterministic target root for a TRACKED NATIVE session switched to connected', () => {
    // Regression for the native→connected switch fail-close (provider_session_state_unavailable_for_resume):
    // a tracked native session has an env but no materialized-root key, so the root must be reconstructed.
    const result = resolveConnectedServiceSwitchTargetMaterializedContext({
      agentId: 'pi',
      baseDir: BASE,
      inheritedEnv: NATIVE_ENV,
      effectiveIdentity: IDENTITY,
    });

    const expectedRoot = join(BASE, 'csm_abc', 'pi');
    expect(result.targetMaterializedRoot).toBe(expectedRoot);
    expect(result.targetMaterializedEnv?.[HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]).toBe(expectedRoot);
    // The inherited native env values are preserved (only the root key is added).
    expect(result.targetMaterializedEnv?.HOME).toBe('/Users/leeroy');
  });

  it('reconstructs the target root for an INACTIVE switch (no inherited env)', () => {
    const result = resolveConnectedServiceSwitchTargetMaterializedContext({
      agentId: 'pi',
      baseDir: BASE,
      inheritedEnv: null,
      effectiveIdentity: IDENTITY,
    });

    expect(result.targetMaterializedRoot).toBe(join(BASE, 'csm_abc', 'pi'));
    expect(result.targetMaterializedEnv?.[HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]).toBe(join(BASE, 'csm_abc', 'pi'));
  });

  it('keeps a tracked CONNECTED session env/root unchanged (already materialized)', () => {
    const existingRoot = join(BASE, 'csm_existing', 'pi');
    const inheritedEnv = {
      [HAPPIER_CONNECTED_SERVICE_TARGET_MATERIALIZED_ROOT_ENV_KEY]: existingRoot,
      PI_CODING_AGENT_DIR: join(existingRoot, 'pi-agent-dir'),
    };
    const result = resolveConnectedServiceSwitchTargetMaterializedContext({
      agentId: 'pi',
      baseDir: BASE,
      inheritedEnv,
      effectiveIdentity: IDENTITY,
    });

    // The existing materialized root wins; the env is returned untouched (no reconstruction).
    expect(result.targetMaterializedRoot).toBe(existingRoot);
    expect(result.targetMaterializedEnv).toBe(inheritedEnv);
  });

  it('fails closed (null root) for a native env with no identity to reconstruct from', () => {
    const result = resolveConnectedServiceSwitchTargetMaterializedContext({
      agentId: 'pi',
      baseDir: BASE,
      inheritedEnv: NATIVE_ENV,
      effectiveIdentity: null,
    });

    expect(result.targetMaterializedRoot).toBeNull();
  });
});
