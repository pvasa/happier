import { describe, expect, it, vi } from 'vitest';

import type { Credentials } from '@/persistence';
import { resolveInactiveConnectedServiceSessionForAuthSwitch } from './resolveInactiveConnectedServiceSessionForAuthSwitch';

const connectedServices = {
  v: 1,
  bindingsByServiceId: {
    anthropic: {
      source: 'connected',
      selection: 'profile',
      profileId: 'old-profile',
    },
  },
} as const;

const materializationIdentity = {
  v: 1,
  id: 'csm_inactive_e2ee_1',
  createdAtMs: 123,
} as const;

function credentials(): Credentials {
  return {
    token: 'token-1',
    encryption: { type: 'legacy', secret: new Uint8Array(32) },
  };
}

describe('resolveInactiveConnectedServiceSessionForAuthSwitch', () => {
  it('resolves decrypted E2EE metadata through the canonical attach context', async () => {
    const resolveAttachContext = vi.fn(async () => ({
      ok: true as const,
      attachPayload: {
        v: 2 as const,
        encryptionMode: 'e2ee' as const,
        encryptionKeyBase64: 'a2V5',
        encryptionVariant: 'legacy' as const,
      },
      vendorResumeId: 'vendor-1',
      sessionPath: '/tmp/repo',
      metadata: {
        agentId: 'claude',
        connectedServices,
        connectedServiceMaterializationIdentityV1: materializationIdentity,
      },
    }));

    await expect(resolveInactiveConnectedServiceSessionForAuthSwitch({
      credentials: credentials(),
      sessionId: 'sess_inactive',
      agentId: 'claude',
      resolveAttachContext,
    })).resolves.toEqual({
      agentId: 'claude',
      connectedServices,
      connectedServiceMaterializationIdentityV1: materializationIdentity,
      vendorResumeId: 'vendor-1',
    });

    expect(resolveAttachContext).toHaveBeenCalledWith(expect.objectContaining({
      token: 'token-1',
      sessionId: 'sess_inactive',
      agent: 'claude',
    }));
  });

  it('falls back to the requested agent when decrypted metadata has no agent marker', async () => {
    const resolveAttachContext = vi.fn(async () => ({
      ok: true as const,
      attachPayload: {
        v: 2 as const,
        encryptionMode: 'e2ee' as const,
        encryptionKeyBase64: 'a2V5',
        encryptionVariant: 'legacy' as const,
      },
      vendorResumeId: 'vendor-1',
      sessionPath: '/tmp/repo',
      metadata: {
        connectedServices,
        connectedServiceMaterializationIdentityV1: materializationIdentity,
      },
    }));

    await expect(resolveInactiveConnectedServiceSessionForAuthSwitch({
      credentials: credentials(),
      sessionId: 'sess_inactive_codex',
      agentId: 'codex',
      resolveAttachContext,
    })).resolves.toMatchObject({
      agentId: 'codex',
      connectedServices,
      vendorResumeId: 'vendor-1',
    });
  });
});
