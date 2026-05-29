import { describe, expect, it } from 'vitest';

import type { ConnectedServiceSwitchContinuityParams } from '@/backends/types';

import { resolveGeminiConnectedServiceSwitchContinuity } from './resolveGeminiConnectedServiceSwitchContinuity';

function createParams(
  overrides: Partial<ConnectedServiceSwitchContinuityParams> = {},
): ConnectedServiceSwitchContinuityParams {
  return {
    sessionId: 'session-1',
    agentId: 'gemini',
    serviceId: 'gemini',
    previousBinding: {
      source: 'connected',
      selection: 'profile',
      serviceId: 'gemini',
      profileId: 'old',
      groupId: null,
    },
    nextBinding: {
      source: 'connected',
      selection: 'profile',
      serviceId: 'gemini',
      profileId: 'new',
      groupId: null,
    },
    fromBindings: {
      v: 1,
      bindingsByServiceId: {
        gemini: { source: 'connected', selection: 'profile', profileId: 'old' },
      },
    },
    toBindings: {
      v: 1,
      bindingsByServiceId: {
        gemini: { source: 'connected', selection: 'profile', profileId: 'new' },
      },
    },
    ...overrides,
  };
}

describe('resolveGeminiConnectedServiceSwitchContinuity', () => {
  it('returns restart_shared_state_required for connected profile switches because shared state is not supported', async () => {
    await expect(resolveGeminiConnectedServiceSwitchContinuity(createParams({
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'materialization-1',
        createdAtMs: 1,
      },
      vendorResumeId: 'vendor-session-1',
    }))).resolves.toEqual({
      mode: 'restart_shared_state_required',
      reason: 'gemini_state_sharing_required',
    });
  });

  it('fails closed for exact connected-selection continuity when resume reachability is not proven', async () => {
    await expect(resolveGeminiConnectedServiceSwitchContinuity(createParams({
      previousBinding: {
        source: 'connected',
        selection: 'profile',
        serviceId: 'gemini',
        profileId: 'same',
        groupId: null,
      },
      nextBinding: {
        source: 'connected',
        selection: 'profile',
        serviceId: 'gemini',
        profileId: 'same',
        groupId: null,
      },
      fromBindings: {
        v: 1,
        bindingsByServiceId: {
          gemini: { source: 'connected', selection: 'profile', profileId: 'same' },
        },
      },
      toBindings: {
        v: 1,
        bindingsByServiceId: {
          gemini: { source: 'connected', selection: 'profile', profileId: 'same' },
        },
      },
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

  it('returns restart_shared_state_required for native to connected switches', async () => {
    await expect(resolveGeminiConnectedServiceSwitchContinuity(createParams({
      previousBinding: {
        source: 'native',
        selection: 'native',
        serviceId: 'gemini',
        profileId: null,
        groupId: null,
      },
      fromBindings: {
        v: 1,
        bindingsByServiceId: {
          gemini: { source: 'native' },
        },
      },
      connectedServiceMaterializationIdentityV1: {
        v: 1,
        id: 'materialization-1',
        createdAtMs: 1,
      },
      vendorResumeId: 'vendor-session-1',
    }))).resolves.toEqual({
      mode: 'restart_shared_state_required',
      reason: 'gemini_state_sharing_required',
    });
  });
});
