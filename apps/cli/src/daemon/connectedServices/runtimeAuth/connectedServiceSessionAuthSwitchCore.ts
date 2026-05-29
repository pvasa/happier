export type ConnectedServiceSessionAuthSwitchReason =
  | 'automatic_runtime_failure'
  | 'manual'
  | 'pre_turn_group_policy';

type LockTail = Promise<void>;

export class ConnectedServiceSessionAuthSwitchLockRegistry {
  private readonly tailsBySessionId = new Map<string, LockTail>();

  async runExclusive<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.tailsBySessionId.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const nextTail = previous.then(() => current, () => current);
    this.tailsBySessionId.set(sessionId, nextTail);

    await previous.catch(() => {});
    try {
      return await operation();
    } finally {
      release();
      if (this.tailsBySessionId.get(sessionId) === nextTail) {
        this.tailsBySessionId.delete(sessionId);
      }
    }
  }

  clearSession(sessionId: string): void {
    this.tailsBySessionId.delete(sessionId);
  }
}

export type ConnectedServiceSessionAuthSwitchCore = Readonly<{
  run<T>(params: Readonly<{
    sessionId: string;
    reason: ConnectedServiceSessionAuthSwitchReason;
    execute: () => Promise<T>;
  }>): Promise<T>;
  clearSession(sessionId: string): void;
}>;

export function createConnectedServiceSessionAuthSwitchCore(params?: Readonly<{
  locks?: ConnectedServiceSessionAuthSwitchLockRegistry;
}>): ConnectedServiceSessionAuthSwitchCore {
  const locks = params?.locks ?? new ConnectedServiceSessionAuthSwitchLockRegistry();
  return {
    async run<T>(input: Readonly<{
      sessionId: string;
      reason: ConnectedServiceSessionAuthSwitchReason;
      execute: () => Promise<T>;
    }>): Promise<T> {
      void input.reason;
      return await locks.runExclusive(input.sessionId, input.execute);
    },
    clearSession(sessionId: string): void {
      locks.clearSession(sessionId);
    },
  };
}
