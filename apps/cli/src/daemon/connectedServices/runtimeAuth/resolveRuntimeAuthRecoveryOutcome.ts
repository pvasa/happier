// Provider-outcome proof gate for runtime-auth recovery success.
//
// Local recovery substeps (a switch event, an auth-store adoption, a credential
// refresh, a process restart request) are NOT proof that the recovered provider
// can actually authenticate. Treating them as terminal recovery success is the
// root cause behind the live Codex/Pi/Claude recovery loops: recovery was cleared
// while the provider session was still broken.
//
// This helper accepts only DETERMINISTIC evidence at this stage of the work:
//   - accepted post-switch verification (exact `verified` account proof or
//     `weakly_verified` auth-surface/provenance proof surfaced as `verificationByServiceId`); or
//   - a genuinely fresh candidate was selected (the adopted profile differs from
//     the exhausted/failed profile).
//
// A bare `credential_refreshed`, a generic `ok: true`, or an `observed_generation`
// with no verification and no candidate change is INTERMEDIATE: the local step
// completed, but no provider-outcome proof exists yet. We must not clear the
// recovery as recovered in that case; the existing scheduler lifecycle keeps it
// pending/waiting (and ultimately moves it toward action-required/exhausted),
// instead of fabricating a stuck "succeeded" state.
//
// WAVE-3 SEAM: bounded provider-activity proof (assistant delta / tool call /
// accepted in-flight steer after the recovery boundary, with a timeout -> terminal)
// is the second proof class. It is modeled in the shared
// `recovery/providerOutcomeProof.ts` contract as `provider_activity` but is
// intentionally NOT produced here so we do not create "wait forever" states;
// until it lands, refresh-without-deterministic-proof simply stays pending under
// the scheduler's normal backoff/exhaustion lifecycle.
//
// This resolver MAPS the runtime-auth switch result onto the shared, provider-agnostic
// `ProviderOutcomeProofKind` contract. The mapping is thin and behavior-preserving:
// the deterministic evidence it can establish is `account_adoption_verified` and
// `fresh_candidate_selected`. Only accepted post-switch verification is a recovered proof today;
// fresh-candidate selection intentionally stays intermediate until later provider
// activity/native resume/quota proof arrives. All other local completions
// (credential_refreshed, generic ok:true, unverified switch/observed_generation)
// map to `null` (no proof).

import {
  type ProviderOutcomeProofKind,
  isProviderOutcomeProofKind,
  isRecoveredProviderOutcomeProof,
} from '../recovery/providerOutcomeProof';

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function hasExactVerificationIdentityMaterial(verification: Readonly<Record<string, unknown>>): boolean {
  return readString(verification.providerAccountId) !== null
    || readString(verification.activeAccountId) !== null
    || readString(verification.sharedAuthSurfaceId) !== null;
}

function hasAcceptedVerificationProof(verification: unknown): boolean {
  if (!isRecord(verification)) return false;
  if (verification.status === 'weakly_verified') return true;
  if (verification.status !== 'verified') return false;
  return verification.proofStrength === 'exact'
    ? hasExactVerificationIdentityMaterial(verification)
    : true;
}

/**
 * Unwrap the `{ status: 'switch_attempted', result }` envelope to the inner
 * connected-service auth-group switch result, mirroring the runtime-auth
 * recovery callback contract.
 */
export function readRuntimeAuthRecoverySwitchResult(
  result: unknown,
): Readonly<Record<string, unknown>> | null {
  if (!isRecord(result)) return null;
  if (result.status === 'switch_attempted' && isRecord(result.result)) return result.result;
  return result;
}

function hasAcceptedPostSwitchVerification(switchResult: Readonly<Record<string, unknown>>): boolean {
  const verificationByServiceId = switchResult.verificationByServiceId;
  if (!isRecord(verificationByServiceId)) return false;
  return Object.values(verificationByServiceId).some(hasAcceptedVerificationProof);
}

function hasFreshCandidateSelected(switchResult: Readonly<Record<string, unknown>>): boolean {
  const activeProfileId = readString(switchResult.activeProfileId);
  if (!activeProfileId) return false;
  // `fromProfileId` is only present when the switch actually moved off a known
  // failed profile. When it is absent we cannot prove freshness deterministically.
  const fromProfileId = readString(switchResult.fromProfileId);
  if (!fromProfileId) return false;
  return fromProfileId !== activeProfileId;
}

// Runtime-auth recovery can derive accepted post-switch verification and fresh-candidate
// evidence from switch results. Provider/runtime owners may also pass through an explicit
// `proofKind` from the shared provider-outcome contract when they own stronger
// evidence such as native resume, quota probe, provider activity, or terminal proof.
// Account-adoption proof is deliberately derived from verificationByServiceId so
// malformed exact verification cannot bypass the identity-material gate by setting
// proofKind directly.
export type RuntimeAuthRecoveryProofKind = ProviderOutcomeProofKind;

/**
 * Resolve whether a runtime-auth recovery result carries provider-outcome proof,
 * mapped onto the shared `ProviderOutcomeProofKind` contract. Returns the proof
 * kind when proven, otherwise `null`.
 */
export function resolveRuntimeAuthRecoveryProof(result: unknown): RuntimeAuthRecoveryProofKind | null {
  const switchResult = readRuntimeAuthRecoverySwitchResult(result);
  if (!switchResult) return null;
  if (
    isProviderOutcomeProofKind(switchResult.proofKind)
    && switchResult.proofKind !== 'account_adoption_verified'
  ) return switchResult.proofKind;
  if (hasAcceptedPostSwitchVerification(switchResult)) return 'account_adoption_verified';
  if (hasFreshCandidateSelected(switchResult)) return 'fresh_candidate_selected';
  return null;
}

/**
 * True only when the runtime-auth recovery result proves the provider outcome
 * deterministically (a recovered proof class). Local-only completions
 * (credential_refreshed, generic ok:true, unverified switch/observed_generation)
 * are intentionally NOT success.
 */
export function isProvenRuntimeAuthRecoverySuccess(result: unknown): boolean {
  return isRecoveredProviderOutcomeProof(resolveRuntimeAuthRecoveryProof(result));
}
