import {
  SPAWN_SESSION_ERROR_CODES,
  SPAWN_SESSION_ERROR_DETAIL_KINDS,
  type SpawnSessionResult,
} from '@happier-dev/protocol';

import type { ConnectedServiceSpawnResumeUnreachableError } from './resolveConnectedServiceAuthForSpawn';

/**
 * Map a fail-closed connected-service resume-reachability error (K1 §2) into a spawn-error result.
 *
 * D2 contract: this is purely ADDITIVE on top of the pre-existing mapping. The result still uses
 * `SPAWN_VALIDATION_FAILED` and a human-readable `errorMessage` (so legacy/copy-based consumers keep
 * working), and ALSO carries a structured `errorDetail` so the client can programmatically recognize
 * "resume unreachable" and surface the "switch unavailable" explanation + "start fresh under the new
 * account" affordance. The detail mirrors the error's continuity vocabulary verbatim — no provider
 * knowledge or display copy lives here.
 */
export function buildSpawnResumeUnreachableErrorResult(
  error: ConnectedServiceSpawnResumeUnreachableError,
): Extract<SpawnSessionResult, { type: 'error' }> {
  return {
    type: 'error',
    errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_VALIDATION_FAILED,
    errorMessage: `${error.errorCode} (failurePhase=${error.failurePhase}): ${error.message}`,
    errorDetail: {
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
      continuityErrorCode: error.errorCode,
      failurePhase: error.failurePhase,
      agentId: error.agentId,
      vendorResumeId: error.vendorResumeId,
      cwd: error.cwd,
      reason: error.reason,
      targetMaterializedRoot: error.targetMaterializedRoot,
    },
  };
}
