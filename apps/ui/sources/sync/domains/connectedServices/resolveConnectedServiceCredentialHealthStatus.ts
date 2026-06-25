import type { ConnectedServiceCredentialHealthStatusV1 } from '@happier-dev/protocol';

/**
 * Map a raw connected-service profile status onto the canonical credential
 * health enum. Unknown/missing values fall back to `needs_reauth` so callers
 * never treat an unrecognized status as healthy. This is the single owner used
 * by every connected-services view so the index, detail, and profile screens
 * can never diverge on how a raw status maps to health.
 */
export function resolveConnectedServiceCredentialHealthStatus(
    raw: unknown,
): ConnectedServiceCredentialHealthStatusV1 {
    if (raw === 'connected') return 'connected';
    if (raw === 'refreshing') return 'refreshing';
    if (raw === 'refresh_failed_retryable') return 'refresh_failed_retryable';
    return 'needs_reauth';
}
