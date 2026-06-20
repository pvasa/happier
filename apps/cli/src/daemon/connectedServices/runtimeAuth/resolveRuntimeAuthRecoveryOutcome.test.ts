import { describe, expect, it } from 'vitest';

import {
  isProvenRuntimeAuthRecoverySuccess,
  resolveRuntimeAuthRecoveryProof,
} from './resolveRuntimeAuthRecoveryOutcome';

describe('resolveRuntimeAuthRecoveryProof', () => {
  it('accepts a switch with exact verified account adoption as deterministic proof', () => {
    const result = {
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
        verificationByServiceId: {
          'openai-codex': { status: 'verified' },
        },
      },
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBe('account_adoption_verified');
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(true);
  });

  it('accepts weakly_verified auth-surface proof without claiming exact account identity', () => {
    const result = {
      status: 'observed_generation',
      activeProfileId: 'backup',
      generation: 3,
      verificationByServiceId: {
        'openai-codex': { status: 'weakly_verified', reason: 'probe_partial' },
      },
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBe('account_adoption_verified');
  });

  it('rejects exact verified account adoption without identity material', () => {
    const result = {
      status: 'observed_generation',
      activeProfileId: 'backup',
      generation: 3,
      verificationByServiceId: {
        'openai-codex': {
          status: 'verified',
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      },
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBeNull();
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('does not let explicit account-adoption proof bypass malformed exact verification', () => {
    const result = {
      status: 'observed_generation',
      proofKind: 'account_adoption_verified',
      activeProfileId: 'backup',
      generation: 3,
      verificationByServiceId: {
        'openai-codex': {
          status: 'verified',
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      },
    };

    expect(resolveRuntimeAuthRecoveryProof(result)).toBeNull();
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('accepts exact verified account adoption when identity material is present', () => {
    const result = {
      status: 'observed_generation',
      activeProfileId: 'backup',
      generation: 3,
      verificationByServiceId: {
        'openai-codex': {
          status: 'verified',
          providerAccountId: 'acct_backup',
          proofStrength: 'exact',
          source: 'applied_credential',
        },
      },
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBe('account_adoption_verified');
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(true);
  });

  it('accepts explicit recovered proof kinds from provider-owned recovery results', () => {
    expect(resolveRuntimeAuthRecoveryProof({
      status: 'native_resume_accepted',
      proofKind: 'native_resume',
    })).toBe('native_resume');
    expect(isProvenRuntimeAuthRecoverySuccess({
      status: 'quota_probe_succeeded',
      proofKind: 'quota_probe_fresh',
    })).toBe(true);
  });

  it('returns explicit terminal proof kinds without treating them as recovered success', () => {
    const result = {
      status: 'recovery_action_required',
      proofKind: 'terminal_action_required',
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBe('terminal_action_required');
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('keeps a genuinely fresh candidate as intermediate evidence, not recovered success', () => {
    const result = {
      status: 'switch_attempted',
      result: {
        status: 'switched',
        fromProfileId: 'primary',
        activeProfileId: 'backup',
        generation: 2,
      },
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBe('fresh_candidate_selected');
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('rejects a same-account hot apply (from-profile equals active) as no proof', () => {
    const result = {
      status: 'switch_attempted',
      result: {
        status: 'switched',
        fromProfileId: 'primary',
        activeProfileId: 'primary',
        generation: 2,
      },
    };
    expect(resolveRuntimeAuthRecoveryProof(result)).toBeNull();
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('rejects a switch without verification and without a from-profile as no proof', () => {
    const result = {
      status: 'switch_attempted',
      result: {
        status: 'switched',
        activeProfileId: 'backup',
        generation: 2,
      },
    };
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('rejects a bare credential_refreshed result as no proof', () => {
    expect(isProvenRuntimeAuthRecoverySuccess({ status: 'credential_refreshed' })).toBe(false);
    expect(isProvenRuntimeAuthRecoverySuccess({ status: 'credential_refreshed', restartRequested: true })).toBe(false);
  });

  it('rejects a generic ok:true result as no proof', () => {
    const result = {
      status: 'switch_attempted',
      result: { ok: true, action: 'restart_requested' },
    };
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('rejects direct live auth metadata unless it carries an accepted proof taxonomy kind', () => {
    const result = {
      status: 'switch_attempted',
      result: {
        status: 'switched',
        appliedVia: 'direct_live_hot_auth',
        proofKind: 'direct_live_hot_auth',
        directLiveProof: {
          loginStarted: true,
          activeAccountId: 'acct_123',
        },
      },
    };

    expect(resolveRuntimeAuthRecoveryProof(result)).toBeNull();
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('ignores verification entries that are not verified/weakly_verified', () => {
    const result = {
      status: 'switched',
      activeProfileId: 'backup',
      verificationByServiceId: {
        'openai-codex': { status: 'unverified' },
      },
    };
    expect(isProvenRuntimeAuthRecoverySuccess(result)).toBe(false);
  });

  it('returns null for non-record inputs', () => {
    expect(resolveRuntimeAuthRecoveryProof(null)).toBeNull();
    expect(resolveRuntimeAuthRecoveryProof(undefined)).toBeNull();
    expect(resolveRuntimeAuthRecoveryProof('switched')).toBeNull();
  });
});
