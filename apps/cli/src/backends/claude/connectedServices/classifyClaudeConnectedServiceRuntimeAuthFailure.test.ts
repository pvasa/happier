import { describe, expect, it } from 'vitest';

import { createClaudeConnectedServiceRuntimeAuthAdapter } from './createClaudeConnectedServiceRuntimeAuthAdapter';
import { classifyClaudeConnectedServiceRuntimeAuthFailure } from './classifyClaudeConnectedServiceRuntimeAuthFailure';
import { mapClaudeRateLimitEventToUsageDetails } from './mapClaudeRateLimitEventToUsageDetails';

const selection = {
  serviceId: 'claude-subscription',
  activeProfileId: 'work',
  groupId: 'claude',
};

describe('classifyClaudeConnectedServiceRuntimeAuthFailure', () => {
  it('classifies Claude 401 authentication errors as credential auth failures', () => {
    const classification = classifyClaudeConnectedServiceRuntimeAuthFailure({
      error: {
        type: 'assistant',
        isApiErrorMessage: true,
        api_error_status: 401,
        error: {
          type: 'authentication_error',
          message: 'Invalid authentication credentials',
        },
      },
      selection,
    });

    expect(classification).toMatchObject({
      kind: 'auth_expired',
      limitCategory: 'auth',
      serviceId: 'claude-subscription',
      profileId: 'work',
      groupId: 'claude',
      source: 'stable_provider_message',
    });
  });

  it('keeps auth failures out of the usage-limit mapper while the runtime adapter still classifies them', () => {
    const error = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      api_error_status: 401,
      error: {
        type: 'authentication_error',
        message: 'OAuth token has expired',
      },
    };

    expect(mapClaudeRateLimitEventToUsageDetails(error)).toBeNull();
    expect(
      createClaudeConnectedServiceRuntimeAuthAdapter().classifyRuntimeAuthFailure({
        target: { agentId: 'claude' },
        error,
        selection,
      }),
    ).toMatchObject({
      kind: 'auth_expired',
      limitCategory: 'auth',
      serviceId: 'claude-subscription',
      profileId: 'work',
    });
  });

  it('classifies auth evidence as credential failure even when retry headers are present', () => {
    const error = {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      api_error_status: 401,
      error: {
        type: 'authentication_error',
        message: 'Failed to authenticate',
      },
      response: {
        headers: {
          'retry-after': '30',
          'anthropic-ratelimit-requests-reset': '2030-01-01T00:00:00.000Z',
        },
      },
    };

    expect(
      createClaudeConnectedServiceRuntimeAuthAdapter().classifyRuntimeAuthFailure({
        target: { agentId: 'claude' },
        error,
        selection,
      }),
    ).toMatchObject({
      kind: 'auth_expired',
      limitCategory: 'auth',
      serviceId: 'claude-subscription',
      profileId: 'work',
      rateLimits: null,
    });
  });

  it('classifies auth evidence nested in Agent SDK result errors', () => {
    const error = {
      type: 'result',
      subtype: 'error_during_execution',
      errors: [
        {
          type: 'authentication_error',
          message: 'OAuth token has expired',
        },
      ],
    };

    expect(
      createClaudeConnectedServiceRuntimeAuthAdapter().classifyRuntimeAuthFailure({
        target: { agentId: 'claude' },
        error,
        selection,
      }),
    ).toMatchObject({
      kind: 'auth_expired',
      limitCategory: 'auth',
      serviceId: 'claude-subscription',
      profileId: 'work',
    });
  });
});
