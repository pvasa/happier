export type RuntimeAuthRecoveryKeyParts = Readonly<{
  sessionId: string;
  serviceId: string;
  profileId: string | null;
  groupId: string | null;
}>;

const RUNTIME_AUTH_RECOVERY_KEY_PREFIX = 'runtime-auth:v1:';

function encodeKeyPayload(parts: RuntimeAuthRecoveryKeyParts): string {
  return Buffer.from(JSON.stringify([
    parts.sessionId,
    parts.serviceId,
    parts.profileId,
    parts.groupId,
  ]), 'utf8').toString('base64url');
}

function decodeKeyPayload(payload: string): unknown {
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as unknown;
  } catch {
    return null;
  }
}

function readKeyString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : null;
}

export function buildRuntimeAuthRecoveryKey(parts: RuntimeAuthRecoveryKeyParts): string {
  return `${RUNTIME_AUTH_RECOVERY_KEY_PREFIX}${encodeKeyPayload(parts)}`;
}

export function parseRuntimeAuthRecoveryKey(key: string): RuntimeAuthRecoveryKeyParts | null {
  if (!key.startsWith(RUNTIME_AUTH_RECOVERY_KEY_PREFIX)) return null;
  const decoded = decodeKeyPayload(key.slice(RUNTIME_AUTH_RECOVERY_KEY_PREFIX.length));
  if (!Array.isArray(decoded) || decoded.length !== 4) return null;
  const sessionId = readKeyString(decoded[0]);
  const serviceId = readKeyString(decoded[1]);
  const profileId = decoded[2] === null ? null : readKeyString(decoded[2]);
  const groupId = decoded[3] === null ? null : readKeyString(decoded[3]);
  if (!sessionId || !serviceId) return null;
  if (decoded[2] !== null && !profileId) return null;
  if (decoded[3] !== null && !groupId) return null;
  return {
    sessionId,
    serviceId,
    profileId,
    groupId,
  };
}
