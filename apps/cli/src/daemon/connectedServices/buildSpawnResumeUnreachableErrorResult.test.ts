import { describe, expect, it } from 'vitest';

import {
  SPAWN_SESSION_ERROR_CODES,
  SPAWN_SESSION_ERROR_DETAIL_KINDS,
  isConnectedServiceResumeUnreachableSpawnErrorDetail,
} from '@happier-dev/protocol';

import { ConnectedServiceSpawnResumeUnreachableError } from './resolveConnectedServiceAuthForSpawn';
import { buildSpawnResumeUnreachableErrorResult } from './buildSpawnResumeUnreachableErrorResult';

function makeError() {
  return new ConnectedServiceSpawnResumeUnreachableError({
    agentId: 'pi',
    vendorResumeId: 'pi-session-missing',
    cwd: '/tmp/project',
    targetMaterializedRoot: '/tmp/materialized/pi-agent-dir',
    reason: 'no_resumable_session_file',
  });
}

describe('buildSpawnResumeUnreachableErrorResult', () => {
  it('preserves the SPAWN_VALIDATION_FAILED code and a verbatim message for legacy consumers', () => {
    const error = makeError();
    const result = buildSpawnResumeUnreachableErrorResult(error);

    expect(result.type).toBe('error');
    expect(result.errorCode).toBe(SPAWN_SESSION_ERROR_CODES.SPAWN_VALIDATION_FAILED);
    // The human-readable message still carries the continuity code + phase so existing
    // copy-based surfaces keep working.
    expect(result.errorMessage).toContain('provider_session_state_unavailable_for_resume');
    expect(result.errorMessage).toContain('continuity');
  });

  it('attaches a structured connected-service resume-unreachable detail mirrored from the error', () => {
    const error = makeError();
    const result = buildSpawnResumeUnreachableErrorResult(error);

    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail(result.errorDetail)).toBe(true);
    expect(result.errorDetail).toEqual({
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
      continuityErrorCode: 'provider_session_state_unavailable_for_resume',
      failurePhase: 'continuity',
      agentId: 'pi',
      vendorResumeId: 'pi-session-missing',
      cwd: '/tmp/project',
      reason: 'no_resumable_session_file',
      targetMaterializedRoot: '/tmp/materialized/pi-agent-dir',
    });
  });

  it('carries a null materialized root through to the detail when it is unresolved', () => {
    const error = new ConnectedServiceSpawnResumeUnreachableError({
      agentId: 'codex',
      vendorResumeId: 'rollout-123',
      cwd: '/work/repo',
      targetMaterializedRoot: null,
      reason: 'native_session_file_missing',
    });
    const result = buildSpawnResumeUnreachableErrorResult(error);

    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail(result.errorDetail)).toBe(true);
    if (!isConnectedServiceResumeUnreachableSpawnErrorDetail(result.errorDetail)) {
      throw new Error('expected resume-unreachable detail');
    }
    expect(result.errorDetail.targetMaterializedRoot).toBeNull();
    expect(result.errorDetail.agentId).toBe('codex');
  });
});
