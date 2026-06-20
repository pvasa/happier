import { describe, expect, it } from 'vitest';

import {
  type AcceptedConnectedServiceAccountVerification,
  isExactAcceptedConnectedServiceAccountVerification,
  toAcceptedConnectedServiceAccountVerification,
} from './acceptedConnectedServiceAccountVerification';

describe('accepted connected-service account verification', () => {
  it('preserves exact shared-auth-surface identity material', () => {
    const verification = toAcceptedConnectedServiceAccountVerification({
      status: 'verified',
      sharedAuthSurfaceId: 'claude-team',
      proofStrength: 'exact',
      source: 'runtime_identity_probe',
    } satisfies AcceptedConnectedServiceAccountVerification);

    expect(verification).toEqual({
      status: 'verified',
      sharedAuthSurfaceId: 'claude-team',
      proofStrength: 'exact',
      source: 'runtime_identity_probe',
    });
    expect(isExactAcceptedConnectedServiceAccountVerification(verification)).toBe(true);
  });
});
