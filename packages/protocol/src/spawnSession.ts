export const SPAWN_SESSION_ERROR_CODES = {
  INVALID_REQUEST: 'INVALID_REQUEST',
  INVALID_ENVIRONMENT_VARIABLES: 'INVALID_ENVIRONMENT_VARIABLES',
  AUTH_ENV_UNEXPANDED: 'AUTH_ENV_UNEXPANDED',
  RESUME_NOT_SUPPORTED: 'RESUME_NOT_SUPPORTED',
  RESUME_MISSING_ENCRYPTION_KEY: 'RESUME_MISSING_ENCRYPTION_KEY',
  RESUME_UNSUPPORTED_ENCRYPTION_VARIANT: 'RESUME_UNSUPPORTED_ENCRYPTION_VARIANT',
  DIRECTORY_CREATE_FAILED: 'DIRECTORY_CREATE_FAILED',
  SPAWN_VALIDATION_FAILED: 'SPAWN_VALIDATION_FAILED',
  SPAWN_NO_PID: 'SPAWN_NO_PID',
  CHILD_EXITED_BEFORE_WEBHOOK: 'CHILD_EXITED_BEFORE_WEBHOOK',
  SESSION_WEBHOOK_TIMEOUT: 'SESSION_WEBHOOK_TIMEOUT',
  ACCOUNT_SCOPE_CHANGED: 'ACCOUNT_SCOPE_CHANGED',
  SPAWN_FAILED: 'SPAWN_FAILED',
  DAEMON_RPC_UNAVAILABLE: 'DAEMON_RPC_UNAVAILABLE',
  UNEXPECTED: 'UNEXPECTED',
} as const;

export type SpawnSessionErrorCode = (typeof SPAWN_SESSION_ERROR_CODES)[keyof typeof SPAWN_SESSION_ERROR_CODES];

/**
 * Structured, machine-recognizable detail attached to a spawn error so clients can react
 * programmatically instead of parsing the human-readable `errorMessage`.
 *
 * This is a discriminated union keyed by `kind`; it is ADDITIVE and OPTIONAL on the spawn error
 * result. Existing consumers that only read `errorCode`/`errorMessage` keep working unchanged.
 */
export const SPAWN_SESSION_ERROR_DETAIL_KINDS = {
  /**
   * A connected-service auth switch/resume fail-closed because the resumed session could not be
   * proven reachable in the materialized target before the vendor launched (K1 §2 gate). Surfaced
   * under `SPAWN_VALIDATION_FAILED` (the enum value is unchanged for back-compat); this detail
   * carries the structured continuity reason so the client can show the "switch unavailable"
   * explanation and offer "start fresh under the new account".
   */
  CONNECTED_SERVICE_RESUME_UNREACHABLE: 'connected_service_resume_unreachable',
} as const;

export type SpawnSessionErrorDetailKind =
  (typeof SPAWN_SESSION_ERROR_DETAIL_KINDS)[keyof typeof SPAWN_SESSION_ERROR_DETAIL_KINDS];

/**
 * The continuity failure code mirrored from the CLI switch-FSM / spawn re-verify taxonomy
 * (`ConnectedServiceSpawnResumeUnreachableError.errorCode`). It is the only code the spawn-path
 * reachability gate emits, so it is modeled as a literal rather than the broader connect-error enum.
 */
export type ConnectedServiceResumeUnreachableContinuityCode = 'provider_session_state_unavailable_for_resume';

export type ConnectedServiceResumeUnreachableSpawnErrorDetail = Readonly<{
  kind: typeof SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE;
  /** Mirrors `ConnectedServiceSpawnResumeUnreachableError.errorCode`. */
  continuityErrorCode: ConnectedServiceResumeUnreachableContinuityCode;
  /** Mirrors `ConnectedServiceSpawnResumeUnreachableError.failurePhase` (the switch-FSM phase). */
  failurePhase: 'continuity';
  /** The catalog agent id of the backend whose resume was unreachable (e.g. `pi`, `codex`). */
  agentId: string;
  /** The vendor `--resume` reference the spawn would have resumed from. */
  vendorResumeId: string;
  /** The working directory the session targets. */
  cwd: string;
  /** A concrete machine-readable reason from the reachability probe (e.g. why the file was missing). */
  reason: string;
  /** The materialized root the vendor would have read, when resolvable; `null` otherwise. */
  targetMaterializedRoot: string | null;
}>;

export type SpawnSessionErrorDetail = ConnectedServiceResumeUnreachableSpawnErrorDetail;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function isConnectedServiceResumeUnreachableSpawnErrorDetail(
  value: unknown,
): value is ConnectedServiceResumeUnreachableSpawnErrorDetail {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const detail = value as Record<string, unknown>;
  return detail.kind === SPAWN_SESSION_ERROR_DETAIL_KINDS.CONNECTED_SERVICE_RESUME_UNREACHABLE
    && detail.continuityErrorCode === 'provider_session_state_unavailable_for_resume'
    && detail.failurePhase === 'continuity'
    && isNonEmptyString(detail.agentId)
    && isNonEmptyString(detail.vendorResumeId)
    && isNonEmptyString(detail.cwd)
    && isNonEmptyString(detail.reason)
    && (detail.targetMaterializedRoot === null || isNonEmptyString(detail.targetMaterializedRoot));
}

export type SpawnSessionResult =
  | { type: 'success'; sessionId?: string }
  | { type: 'requestToApproveDirectoryCreation'; directory: string }
  | { type: 'error'; errorCode: SpawnSessionErrorCode; errorMessage: string; errorDetail?: SpawnSessionErrorDetail };
