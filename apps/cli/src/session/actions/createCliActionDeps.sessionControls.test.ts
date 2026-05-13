import { describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';
import { SESSION_RPC_METHODS } from '@happier-dev/protocol/rpc';

const mocks = vi.hoisted(() => ({
  callSessionRpc: vi.fn(async () => ({ ok: true })),
  resolveSessionTransportContext: vi.fn(async () => ({
    ok: true as const,
    sessionId: 'sess_1',
    rawSession: { active: true },
    ctx: {
      encryptionKey: new Uint8Array(32).fill(3),
      encryptionVariant: 'legacy' as const,
    },
    mode: 'plain' as const,
  })),
  sendSessionMessage: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock('@/session/transport/rpc/sessionRpc', () => ({ callSessionRpc: mocks.callSessionRpc }));
vi.mock('@/session/services/resolveSessionTransportContext', () => ({
  resolveSessionTransportContext: mocks.resolveSessionTransportContext,
}));
vi.mock('@/session/services/sendSessionMessage', () => ({ sendSessionMessage: mocks.sendSessionMessage }));

import { createCliActionDeps } from './createCliActionDeps';

function createCredentials(): Credentials {
  return {
    token: 'token',
    encryption: {
      type: 'legacy',
      secret: new Uint8Array(32).fill(9),
    },
  };
}

describe('createCliActionDeps session controls', () => {
  it('calls native session goal RPC instead of sending goal text', async () => {
    const deps = createCliActionDeps({
      token: 'token',
      credentials: createCredentials(),
      sessionId: 'sess_1',
      ctx: {
        encryptionKey: new Uint8Array(32).fill(1),
        encryptionVariant: 'legacy',
      },
      mode: 'plain',
      rawSession: { metadata: {} },
    });

    await expect(deps.sessionGoalSet?.({ sessionId: 'sess_1', objective: 'Ship native goals' })).resolves.toEqual({
      ok: true,
    });

    expect(mocks.callSessionRpc).toHaveBeenCalledWith(expect.objectContaining({
      token: 'token',
      sessionId: 'sess_1',
      mode: 'plain',
      method: `sess_1:${SESSION_RPC_METHODS.SESSION_GOAL_SET}`,
      request: { objective: 'Ship native goals' },
    }));
    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
  });

  it('calls native catalog RPCs for vendor plugins and skills', async () => {
    const deps = createCliActionDeps({
      token: 'token',
      credentials: createCredentials(),
      sessionId: 'sess_1',
      ctx: {
        encryptionKey: new Uint8Array(32).fill(1),
        encryptionVariant: 'legacy',
      },
      mode: 'plain',
      rawSession: { metadata: {} },
    });

    await deps.sessionVendorPluginCatalogList?.({ sessionId: 'sess_1' });
    await deps.sessionSkillCatalogList?.({ sessionId: 'sess_1' });

    expect(mocks.callSessionRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: `sess_1:${SESSION_RPC_METHODS.SESSION_VENDOR_PLUGIN_CATALOG_LIST}`,
      request: {},
    }));
    expect(mocks.callSessionRpc).toHaveBeenCalledWith(expect.objectContaining({
      method: `sess_1:${SESSION_RPC_METHODS.SESSION_SKILL_CATALOG_LIST}`,
      request: {},
    }));
    expect(mocks.sendSessionMessage).not.toHaveBeenCalled();
  });
});
