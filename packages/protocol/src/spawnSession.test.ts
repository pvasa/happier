import { describe, expect, it } from 'vitest';

import {
  SPAWN_SESSION_ERROR_CODES,
  SPAWN_SESSION_ERROR_DETAIL_KINDS,
  isConnectedServiceResumeUnreachableSpawnErrorDetail,
  type SpawnSessionErrorDetail,
  type SpawnSessionResult,
} from './spawnSession.js';

describe('spawn-session error detail contract (D2 structured continuity)', () => {
  it('keeps the existing error result shape valid without an errorDetail (backward compatibility)', () => {
    // A pre-existing SPAWN_VALIDATION_FAILED consumer must still type-check and be usable with no
    // errorDetail field present. errorDetail is purely additive/optional.
    const legacy: SpawnSessionResult = {
      type: 'error',
      errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_VALIDATION_FAILED,
      errorMessage: 'Claude CLI override is invalid',
    };

    expect(legacy.type).toBe('error');
    if (legacy.type !== 'error') throw new Error('expected error result');
    expect(legacy.errorCode).toBe(SPAWN_SESSION_ERROR_CODES.SPAWN_VALIDATION_FAILED);
    expect('errorDetail' in legacy).toBe(false);
  });

  it('carries a structured connected-service resume-unreachable detail alongside SPAWN_VALIDATION_FAILED', () => {
    const detail: SpawnSessionErrorDetail = {
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
      continuityErrorCode: 'provider_session_state_unavailable_for_resume',
      failurePhase: 'continuity',
      agentId: 'pi',
      vendorResumeId: 'pi-session-missing',
      cwd: '/tmp/project',
      reason: 'no_resumable_session_file',
      targetMaterializedRoot: '/tmp/materialized/pi-agent-dir',
    };

    const result: SpawnSessionResult = {
      type: 'error',
      errorCode: SPAWN_SESSION_ERROR_CODES.SPAWN_VALIDATION_FAILED,
      errorMessage: 'provider_session_state_unavailable_for_resume (failurePhase=continuity): ...',
      errorDetail: detail,
    };

    expect(result.type).toBe('error');
    if (result.type !== 'error') throw new Error('expected error result');
    // The existing fields are unchanged: code stays SPAWN_VALIDATION_FAILED so legacy consumers work.
    expect(result.errorCode).toBe(SPAWN_SESSION_ERROR_CODES.SPAWN_VALIDATION_FAILED);
    expect(result.errorDetail).toBe(detail);
  });

  it('recognizes the connected-service resume-unreachable detail via the type guard', () => {
    const detail: SpawnSessionErrorDetail = {
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
      continuityErrorCode: 'provider_session_state_unavailable_for_resume',
      failurePhase: 'continuity',
      agentId: 'codex',
      vendorResumeId: 'rollout-123',
      cwd: '/work/repo',
      reason: 'native_session_file_missing',
      targetMaterializedRoot: null,
    };

    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail(detail)).toBe(true);
  });

  it('does not recognize unrelated values as a resume-unreachable detail', () => {
    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail(null)).toBe(false);
    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail(undefined)).toBe(false);
    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail({ kind: 'something_else' })).toBe(false);
    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail('provider_session_state_unavailable_for_resume')).toBe(false);
  });

  it('rejects resume-unreachable details with missing or malformed required fields', () => {
    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail({
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
    })).toBe(false);

    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail({
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
      continuityErrorCode: 'some_other_reason',
      failurePhase: 'continuity',
      agentId: 'codex',
      vendorResumeId: 'rollout-123',
      cwd: '/work/repo',
      reason: 'native_session_file_missing',
      targetMaterializedRoot: null,
    })).toBe(false);

    expect(isConnectedServiceResumeUnreachableSpawnErrorDetail({
      kind: SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE,
      continuityErrorCode: 'provider_session_state_unavailable_for_resume',
      failurePhase: 'continuity',
      agentId: 'codex',
      vendorResumeId: 'rollout-123',
      cwd: '/work/repo',
      reason: 'native_session_file_missing',
      targetMaterializedRoot: 42,
    })).toBe(false);
  });
});
