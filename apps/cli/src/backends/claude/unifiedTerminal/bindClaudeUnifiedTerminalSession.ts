import type { ReadyNotificationTurnContext } from '@/agent/runtime/runPermissionModePromptLoop';
import type { SessionClientPort } from '@/api/session/sessionClientPort';
import { logger } from '@/ui/logger';

import type { EnhancedMode } from '../loop';
import type { RawJSONLines } from '../types';
import type { ClaudeUnifiedTerminalSessionOptions } from './runClaudeUnifiedTerminalSession';
import {
  createClaudeUnifiedPromptEchoSuppressor,
  type ClaudeUnifiedPromptEchoSuppressor,
} from './promptEchoSuppression';
import { seedClaudeUnifiedPersistedPromptEchoes } from './promptEchoSeed';

type ClaudeUnifiedSessionBindingClient = Pick<
  SessionClientPort,
  | 'beginTurnAssistantTextSnapshot'
  | 'fetchRecentTranscriptTextItemsForAcpImport'
  | 'getLastObservedMessageSeq'
  | 'recordClaudeJsonlMessageConsumed'
> & Readonly<{
  sessionTurnLifecycle?: Pick<
    NonNullable<SessionClientPort['sessionTurnLifecycle']>,
    'beginTurn' | 'cancelTurn' | 'completeTurn'
  > | undefined;
}>;

type ClaudeUnifiedTerminalSessionBindingOptions<Mode extends EnhancedMode = EnhancedMode> = Readonly<{
  session: ClaudeUnifiedSessionBindingClient;
  logPrefix: string;
  acceptedPromptEchoWindowMs: number;
  nowMs?: (() => number) | undefined;
  onMessage: (message: RawJSONLines) => void;
  onReady: (context?: ReadyNotificationTurnContext) => void | Promise<void>;
  onTurnInterruptChanged?: ((handler: (() => Promise<void>) | null) => void) | undefined;
  onPromptTurnStarted?: (() => void | Promise<void>) | undefined;
  suppressor?: ClaudeUnifiedPromptEchoSuppressor | undefined;
}>;

export type ClaudeUnifiedTerminalSessionBinding<Mode extends EnhancedMode = EnhancedMode> = Readonly<{
  sessionOptions: Pick<
    ClaudeUnifiedTerminalSessionOptions<Mode>,
    | 'allowFirstInputBeforeSessionStart'
    | 'onMessage'
    | 'onProviderPromptStarted'
    | 'onReady'
    | 'onTerminalPromptInjected'
    | 'setTurnInterrupt'
  >;
  seedPersistedPromptEchoes(opts?: Readonly<{ nowMs?: number | undefined }>): Promise<void>;
  noteNextInjectedPromptShouldSuppressEcho(): void;
  noteNextInjectedPromptShouldImportEcho(): void;
  shouldSuppressTranscriptMessage(message: RawJSONLines): boolean;
  beginReadyNotificationTurn(): void;
  recordPromptTurnStarted(): Promise<void>;
  recordPromptTurnCompleted(): Promise<void>;
  recordPromptTurnCancelled(): Promise<void>;
  notePromptTurnTerminal(): void;
}>;

export function bindClaudeUnifiedTerminalSession<Mode extends EnhancedMode = EnhancedMode>(
  opts: ClaudeUnifiedTerminalSessionBindingOptions<Mode>,
): ClaudeUnifiedTerminalSessionBinding<Mode> {
  const promptEchoSuppressor = opts.suppressor ?? createClaudeUnifiedPromptEchoSuppressor({
    acceptedPromptEchoWindowMs: opts.acceptedPromptEchoWindowMs,
    nowMs: opts.nowMs,
  });
  const acceptedPromptEchoSuppressionDecisions: boolean[] = [];
  let readyTurnContext: ReadyNotificationTurnContext | undefined;
  let canonicalTurnOpen = false;
  let canonicalTurnStartPromise: Promise<void> | null = null;

  function beginReadyNotificationTurn(): void {
    if (typeof opts.session.beginTurnAssistantTextSnapshot !== 'function') return;
    const startSeqExclusive = typeof opts.session.getLastObservedMessageSeq === 'function'
      ? opts.session.getLastObservedMessageSeq()
      : null;
    const turnToken = opts.session.beginTurnAssistantTextSnapshot({ startSeqExclusive });
    readyTurnContext = { turnToken, startSeqExclusive };
  }

  async function recordPromptTurnStarted(): Promise<void> {
    if (canonicalTurnOpen) {
      await canonicalTurnStartPromise;
      return;
    }
    canonicalTurnOpen = true;
    const lifecycle = opts.session.sessionTurnLifecycle;
    if (!lifecycle?.beginTurn) return;
    const startPromise = Promise.resolve(lifecycle.beginTurn({ provider: 'claude' }))
      .then(() => undefined)
      .catch((error) => {
        canonicalTurnOpen = false;
        logger.debug(`${opts.logPrefix}: Failed to record Claude unified turn start (non-fatal)`, error);
      })
      .finally(() => {
        if (canonicalTurnStartPromise === startPromise) {
          canonicalTurnStartPromise = null;
        }
      });
    canonicalTurnStartPromise = startPromise;
    await startPromise;
  }

  async function recordPromptTurnCompleted(): Promise<void> {
    await canonicalTurnStartPromise;
    if (!canonicalTurnOpen) return;
    try {
      await opts.session.sessionTurnLifecycle?.completeTurn?.({ provider: 'claude' });
    } catch (error) {
      logger.debug(`${opts.logPrefix}: Failed to record Claude unified turn completion (non-fatal)`, error);
    } finally {
      canonicalTurnOpen = false;
    }
  }

  async function recordPromptTurnCancelled(): Promise<void> {
    await canonicalTurnStartPromise;
    if (!canonicalTurnOpen) return;
    try {
      await opts.session.sessionTurnLifecycle?.cancelTurn?.({ provider: 'claude' });
    } catch (error) {
      logger.debug(`${opts.logPrefix}: Failed to record Claude unified turn cancellation (non-fatal)`, error);
    } finally {
      canonicalTurnOpen = false;
    }
  }

  function notePromptTurnTerminal(): void {
    canonicalTurnOpen = false;
  }

  function noteNextInjectedPromptShouldSuppressEcho(): void {
    acceptedPromptEchoSuppressionDecisions.push(true);
  }

  function noteNextInjectedPromptShouldImportEcho(): void {
    acceptedPromptEchoSuppressionDecisions.push(false);
  }

  function shouldSuppressAcceptedPromptEcho(): boolean {
    return acceptedPromptEchoSuppressionDecisions.shift() ?? true;
  }

  function shouldSuppressTranscriptMessage(message: RawJSONLines): boolean {
    if (!promptEchoSuppressor.shouldSuppressTranscriptMessage(message)) return false;
    opts.session.recordClaudeJsonlMessageConsumed?.(message);
    return true;
  }

  async function seedPersistedPromptEchoes(seedOpts: Readonly<{ nowMs?: number | undefined }> = {}): Promise<void> {
    await seedClaudeUnifiedPersistedPromptEchoes({
      session: opts.session,
      suppressor: promptEchoSuppressor,
      logPrefix: opts.logPrefix,
      nowMs: seedOpts.nowMs,
    });
  }

  return {
    sessionOptions: {
      allowFirstInputBeforeSessionStart: true,
      onMessage: (message) => {
        if (shouldSuppressTranscriptMessage(message)) return;
        opts.onMessage(message);
      },
      onReady: async () => {
        await recordPromptTurnCompleted();
        await opts.onReady(readyTurnContext);
      },
      onProviderPromptStarted: async () => {
        beginReadyNotificationTurn();
        await recordPromptTurnStarted();
      },
      setTurnInterrupt: (handler) => {
        opts.onTurnInterruptChanged?.(handler);
      },
      onTerminalPromptInjected: async (acceptedPrompt) => {
        if (shouldSuppressAcceptedPromptEcho()) {
          promptEchoSuppressor.recordAcceptedPrompt(acceptedPrompt);
        }
        if (acceptedPrompt.acceptedAs !== 'in_flight_steer') {
          beginReadyNotificationTurn();
          await recordPromptTurnStarted();
          await opts.onPromptTurnStarted?.();
        }
      },
    },
    seedPersistedPromptEchoes,
    noteNextInjectedPromptShouldSuppressEcho,
    noteNextInjectedPromptShouldImportEcho,
    shouldSuppressTranscriptMessage,
    beginReadyNotificationTurn,
    recordPromptTurnStarted,
    recordPromptTurnCompleted,
    recordPromptTurnCancelled,
    notePromptTurnTerminal,
  };
}
