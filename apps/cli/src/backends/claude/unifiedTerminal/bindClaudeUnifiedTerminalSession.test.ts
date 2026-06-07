import { describe, expect, it, vi } from 'vitest';

import type { RawJSONLines } from '../types';
import { bindClaudeUnifiedTerminalSession } from './bindClaudeUnifiedTerminalSession';

function userMessage(text: string, timestamp: string, uuid: string = `user-${text}`): RawJSONLines {
  return {
    type: 'user',
    uuid,
    timestamp,
    message: { content: text },
  } as RawJSONLines;
}

function assistantMessage(text: string, uuid: string = `assistant-${text}`): RawJSONLines {
  return {
    type: 'assistant',
    uuid,
    message: { content: [{ type: 'text', text }] },
  } as RawJSONLines;
}

function createBinding(overrides: Partial<Parameters<typeof bindClaudeUnifiedTerminalSession>[0]> = {}) {
  const observedMessages: RawJSONLines[] = [];
  const consumedMessages: RawJSONLines[] = [];
  const interruptChanges: Array<(() => Promise<void>) | null> = [];
  const readyContexts: unknown[] = [];
  const fetchRecentTranscriptTextItemsForAcpImport = vi.fn(async (): Promise<Array<{
    role: 'user' | 'agent';
    text: string;
  }>> => []);
  const sessionTurnLifecycle = {
    beginTurn: vi.fn(async () => ({ turnId: 'turn-1' })),
    completeTurn: vi.fn(async () => undefined),
    cancelTurn: vi.fn(async () => undefined),
  };
  const session = {
    fetchRecentTranscriptTextItemsForAcpImport,
    recordClaudeJsonlMessageConsumed: vi.fn((message: RawJSONLines) => {
      consumedMessages.push(message);
    }),
    getLastObservedMessageSeq: vi.fn(() => 41),
    beginTurnAssistantTextSnapshot: vi.fn(() => 'ready-turn-1'),
    sessionTurnLifecycle,
  };
  const binding = bindClaudeUnifiedTerminalSession({
    session,
    logPrefix: '[test-unified]',
    acceptedPromptEchoWindowMs: 100,
    nowMs: () => 1_000,
    onMessage: (message) => {
      observedMessages.push(message);
    },
    onReady: (context) => {
      readyContexts.push(context);
    },
    onTurnInterruptChanged: (handler) => {
      interruptChanges.push(handler);
    },
    onPromptTurnStarted: vi.fn(),
    ...overrides,
  });
  return {
    binding,
    consumedMessages,
    interruptChanges,
    observedMessages,
    readyContexts,
    session,
    sessionTurnLifecycle,
  };
}

describe('bindClaudeUnifiedTerminalSession', () => {
  it('uses the configured accepted-prompt echo window for injected UI prompts', async () => {
    const { binding, consumedMessages, observedMessages } = createBinding();

    binding.noteNextInjectedPromptShouldSuppressEcho();
    await binding.sessionOptions.onTerminalPromptInjected?.({
      message: 'short-lived echo',
      mode: { permissionMode: 'default', claudeUnifiedTerminalEnabled: true },
      acceptedAs: 'new_turn',
      turnStateAtInjection: 'idle',
    });
    binding.sessionOptions.onMessage?.(userMessage('short-lived echo', new Date(1_200).toISOString()));

    expect(consumedMessages).toHaveLength(0);
    expect(observedMessages).toEqual([expect.objectContaining({ type: 'user' })]);
  });

  it('seeds persisted user echoes and does not suppress fresh terminal-origin prompts', async () => {
    const { binding, consumedMessages, observedMessages, session } = createBinding();
    session.fetchRecentTranscriptTextItemsForAcpImport.mockResolvedValueOnce([
      { role: 'user', text: 'repeatable prompt' },
      { role: 'agent', text: 'old answer' },
    ]);

    await binding.seedPersistedPromptEchoes({ nowMs: 2_000 });
    binding.sessionOptions.onMessage?.(userMessage('repeatable prompt', new Date(1_500).toISOString(), 'historical'));
    await binding.sessionOptions.onProviderPromptStarted?.();
    binding.sessionOptions.onMessage?.(userMessage('repeatable prompt', new Date(2_500).toISOString(), 'fresh-terminal'));
    binding.sessionOptions.onMessage?.(assistantMessage('ok'));

    expect(session.fetchRecentTranscriptTextItemsForAcpImport).toHaveBeenCalledWith({ take: 500 });
    expect(consumedMessages).toEqual([expect.objectContaining({ uuid: 'historical' })]);
    expect(observedMessages).toEqual([
      expect.objectContaining({ uuid: 'fresh-terminal' }),
      expect.objectContaining({ type: 'assistant' }),
    ]);
  });

  it('opens one canonical turn for accepted prompts and completes it on ready', async () => {
    const { binding, readyContexts, session, sessionTurnLifecycle } = createBinding();

    binding.noteNextInjectedPromptShouldSuppressEcho();
    await binding.sessionOptions.onTerminalPromptInjected?.({
      message: 'hello',
      mode: { permissionMode: 'default', claudeUnifiedTerminalEnabled: true },
      acceptedAs: 'new_turn',
      turnStateAtInjection: 'idle',
    });
    await binding.sessionOptions.onProviderPromptStarted?.();
    await binding.sessionOptions.onReady?.();

    expect(session.beginTurnAssistantTextSnapshot).toHaveBeenCalledWith({ startSeqExclusive: 41 });
    expect(sessionTurnLifecycle.beginTurn).toHaveBeenCalledTimes(1);
    expect(sessionTurnLifecycle.completeTurn).toHaveBeenCalledWith({ provider: 'claude' });
    expect(readyContexts).toEqual([{ turnToken: 'ready-turn-1', startSeqExclusive: 41 }]);
  });

  it('forwards terminal interrupt handler installation and removal', () => {
    const { binding, interruptChanges } = createBinding();
    const interrupt = vi.fn(async () => undefined);

    binding.sessionOptions.setTurnInterrupt?.(interrupt);
    binding.sessionOptions.setTurnInterrupt?.(null);

    expect(interruptChanges).toEqual([interrupt, null]);
  });
});
