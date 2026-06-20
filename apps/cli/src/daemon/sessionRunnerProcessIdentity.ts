import { classifyProcessByPid } from './doctor';
import { hashProcessCommand } from './sessionRegistry';

export type SessionRunnerProcessIdentity =
  | Readonly<{ kind: 'happy'; processCommandHash: string }>
  | Readonly<{ kind: 'not_happy' }>
  | Readonly<{ kind: 'unknown' }>;

/**
 * Test/adapter hook for process identity checks.
 *
 * Return a valid hash only when the PID is known to be a Happy runner process, return
 * null when the PID was inspected and is not Happy, and throw when identity is unknown.
 */
export type SessionRunnerProcessCommandHashReader = (pid: number) => Promise<string | null>;

export function isValidProcessCommandHash(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

async function readInjectedProcessIdentity(
  pid: number,
  getProcessCommandHash: SessionRunnerProcessCommandHashReader,
): Promise<SessionRunnerProcessIdentity> {
  try {
    const processCommandHash = await getProcessCommandHash(pid);
    if (isValidProcessCommandHash(processCommandHash)) {
      return { kind: 'happy', processCommandHash };
    }
    return processCommandHash === null ? { kind: 'not_happy' } : { kind: 'unknown' };
  } catch {
    return { kind: 'unknown' };
  }
}

export async function readSessionRunnerProcessIdentity(params: Readonly<{
  pid: number;
  getProcessCommandHash?: SessionRunnerProcessCommandHashReader;
}>): Promise<SessionRunnerProcessIdentity> {
  if (params.getProcessCommandHash) {
    return await readInjectedProcessIdentity(params.pid, params.getProcessCommandHash);
  }

  const classified = await classifyProcessByPid(params.pid).catch(() => ({ kind: 'unknown' as const }));
  if (classified.kind === 'happy') {
    return {
      kind: 'happy',
      processCommandHash: hashProcessCommand(classified.process.command),
    };
  }
  if (classified.kind === 'not_happy') return { kind: 'not_happy' };
  return { kind: 'unknown' };
}

export function storedProcessHashProvesPidReuse(params: Readonly<{
  storedProcessCommandHash: string | null | undefined;
  currentIdentity: SessionRunnerProcessIdentity;
}>): boolean {
  if (!isValidProcessCommandHash(params.storedProcessCommandHash)) return false;
  if (params.currentIdentity.kind === 'not_happy') return true;
  return params.currentIdentity.kind === 'happy'
    && params.currentIdentity.processCommandHash !== params.storedProcessCommandHash;
}

export function storedProcessHashMatchesCurrentIdentity(params: Readonly<{
  storedProcessCommandHash: string | null | undefined;
  currentIdentity: SessionRunnerProcessIdentity;
}>): boolean {
  return isValidProcessCommandHash(params.storedProcessCommandHash)
    && params.currentIdentity.kind === 'happy'
    && params.currentIdentity.processCommandHash === params.storedProcessCommandHash;
}
