function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readNonEmptyString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatProfileSuffix(action: Record<string, unknown>): string {
  const profileId = readNonEmptyString(action.profileId);
  return profileId ? ` (${profileId})` : '';
}

export type ConnectedServiceRuntimeAuthFailureStatusNote = Readonly<{
  code: string;
  message: string;
}>;

function toStatusNote(code: string, message: string): ConnectedServiceRuntimeAuthFailureStatusNote {
  return { code, message };
}

export function resolveConnectedServiceRuntimeAuthFailureStatusMessage(
  value: unknown,
): ConnectedServiceRuntimeAuthFailureStatusNote | null {
  const envelope = readRecord(value);
  if (!envelope || envelope.ok !== true) return null;
  const outerResult = readRecord(envelope.result);
  if (outerResult?.status === 'credential_refreshed') {
    return outerResult.restartRequested === true
      ? toStatusNote(
        'credential_refreshed_restart_requested',
        'Connected-service credential refreshed; restarting session.',
      )
      : toStatusNote(
        'credential_refreshed_restart_maybe_required',
        'Connected-service credential refreshed; restart may be required.',
      );
  }
  if (outerResult?.status === 'recovery_action_required') {
    const action = readRecord(outerResult.action);
    if (action?.kind === 'reconnect_profile') {
      return toStatusNote(
        'recovery_action_reconnect_profile',
        `Connected-service profile${formatProfileSuffix(action)} needs reconnect before this session can continue.`,
      );
    }
    if (action?.kind === 'profile_action_required') {
      return toStatusNote(
        'recovery_action_profile_action_required',
        `Connected-service profile${formatProfileSuffix(action)} needs attention before this session can continue.`,
      );
    }
    if (action?.kind === 'provider_state_sharing_required') {
      return toStatusNote(
        'recovery_action_provider_state_sharing_required',
        'Connected-service recovery requires provider state sharing before this session can continue.',
      );
    }
    if (action?.kind === 'connected_service_required') {
      return toStatusNote(
        'recovery_action_connected_service_required',
        'Connected-service recovery is not available for this native session.',
      );
    }
    return null;
  }
  if (outerResult?.status === 'session_not_found') {
    return toStatusNote(
      'session_not_found',
      'Connected-service recovery could not find the active session.',
    );
  }
  if (outerResult?.status === 'selection_mismatch') {
    return toStatusNote(
      'selection_mismatch',
      'Connected-service recovery could not continue because the active account binding changed.',
    );
  }
  if (outerResult?.status === 'switch_coordinator_unavailable') {
    return toStatusNote(
      'switch_coordinator_unavailable',
      'Connected-service account switching is not available in this daemon.',
    );
  }
  if (outerResult?.status === 'recovery_handler_failed') {
    return toStatusNote(
      'recovery_handler_failed',
      'Connected-service recovery failed before account switching could complete.',
    );
  }
  if (outerResult?.status !== 'switch_attempted') return null;
  const switchResult = readRecord(outerResult.result);
  if (switchResult?.status === 'no_eligible_member') {
    return toStatusNote(
      'switch_attempted_no_eligible_member',
      'Connected-service account group has no eligible fallback account; waiting for group recovery.',
    );
  }
  if (switchResult?.status === 'switch_limit_reached') {
    return toStatusNote(
      'switch_attempted_switch_limit_reached',
      'Connected-service account switch limit reached; waiting before trying another account.',
    );
  }
  if (switchResult?.status === 'generation_apply_failed') {
    const activeProfileId = readNonEmptyString(switchResult.activeProfileId);
    const errorCode = readNonEmptyString(switchResult.errorCode) || 'unknown';
    return toStatusNote(
      'switch_attempted_generation_apply_failed',
      activeProfileId
        ? `Connected-service account switch to ${activeProfileId} could not be applied: ${errorCode}.`
        : `Connected-service account switch could not be applied: ${errorCode}.`,
    );
  }
  if (switchResult?.status !== 'switched') return null;
  const activeProfileId = readNonEmptyString(switchResult.activeProfileId);
  return toStatusNote(
    'switch_attempted_switched',
    activeProfileId
      ? `Connected-service account switched to ${activeProfileId}; restarting session.`
      : 'Connected-service account switched; restarting session.',
  );
}
