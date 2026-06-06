import { describe, expect, it } from 'vitest';

import {
  buildRuntimeAuthRecoveryKey,
  parseRuntimeAuthRecoveryKey,
} from './runtimeAuthRecoveryKey';

describe('runtimeAuthRecoveryKey', () => {
  it('round-trips a deterministic versioned key without delimiter collisions', () => {
    const parts = {
      sessionId: 'session:with/slashes',
      serviceId: 'openai-codex',
      profileId: 'profile:primary',
      groupId: null,
    };

    const key = buildRuntimeAuthRecoveryKey(parts);

    expect(key).toMatch(/^runtime-auth:v1:/);
    expect(key).not.toContain('session:with/slashes');
    expect(parseRuntimeAuthRecoveryKey(key)).toEqual(parts);
  });
});
