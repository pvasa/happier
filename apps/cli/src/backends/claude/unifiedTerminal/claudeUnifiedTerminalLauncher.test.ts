import { afterEach, describe, expect, it, vi } from 'vitest';

import type { TerminalHostHandle } from '@/integrations/terminalHost/_types';
import type { TerminalAttachmentInfo } from '@/terminal/attachment/terminalAttachmentInfo';
import type { AccountSettings } from '@happier-dev/protocol';
import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from '@/daemon/connectedServices/connectedServiceChildEnvironment';

import type { Session } from '../session';

const mocks = vi.hoisted(() => ({
  runClaudeUnifiedTerminalSession: vi.fn(),
  runTmuxAttach: vi.fn(async () => 0),
  runZellijAttach: vi.fn(async () => 0),
  dispatchActivityNotificationAsync: vi.fn(async () => undefined),
  reportConnectedServiceRuntimeAuthFailureToDaemon: vi.fn(async () => ({
    handled: false,
    report: null,
    statusCode: null,
    statusMessage: null,
  })),
}));

vi.mock('./runClaudeUnifiedTerminalSession', () => ({
  runClaudeUnifiedTerminalSession: mocks.runClaudeUnifiedTerminalSession,
}));

vi.mock('@/terminal/attachment/tmuxAttach', () => ({
  runTmuxAttach: mocks.runTmuxAttach,
}));

vi.mock('@/terminal/attachment/zellijAttach', () => ({
  runZellijAttach: mocks.runZellijAttach,
}));

vi.mock('@/activity/notifications/dispatchActivityNotification', () => ({
  dispatchActivityNotificationAsync: mocks.dispatchActivityNotificationAsync,
}));

vi.mock('@/daemon/connectedServices/runtimeAuth/reportConnectedServiceRuntimeAuthFailureToDaemon', () => ({
  reportConnectedServiceRuntimeAuthFailureToDaemon: mocks.reportConnectedServiceRuntimeAuthFailureToDaemon,
}));

import { claudeUnifiedTerminalLauncher } from './claudeUnifiedTerminalLauncher';

const originalStdinIsTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalStdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

function setProcessTty(value: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value });
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value });
}

function restoreProcessTty(): void {
  if (originalStdinIsTTY) {
    Object.defineProperty(process.stdin, 'isTTY', originalStdinIsTTY);
  } else {
    Reflect.deleteProperty(process.stdin, 'isTTY');
  }
  if (originalStdoutIsTTY) {
    Object.defineProperty(process.stdout, 'isTTY', originalStdoutIsTTY);
  } else {
    Reflect.deleteProperty(process.stdout, 'isTTY');
  }
}

function createSession(): Session {
  return {
    path: '/workspace/project',
    client: {
      sessionId: 'happy-session-id',
      sendSessionEvent: vi.fn(),
      sendClaudeSessionMessage: vi.fn(),
      recordClaudeJsonlMessageConsumed: vi.fn(),
      fetchCommittedClaudeJsonlMessageKeys: vi.fn(() => new Set<string>()),
      fetchRecentTranscriptTextItemsForAcpImport: vi.fn(async () => []),
      sessionTurnLifecycle: {
        beginTurn: vi.fn(async () => ({ turnId: 'turn-1' })),
        completeTurn: vi.fn(async () => undefined),
        cancelTurn: vi.fn(async () => undefined),
        failTurn: vi.fn(async () => undefined),
      },
      rpcHandlerManager: {
        registerHandler: vi.fn(),
      },
      flush: vi.fn(async () => undefined),
    },
    pushSender: null,
    accountSettings: null,
    sessionId: 'claude-session-id',
    transcriptPath: null,
    claudeArgs: [],
    hookSettingsPath: undefined,
    hookPluginDir: null,
    queue: {
      size: vi.fn(() => 0),
      waitForMessagesAndGetAsString: vi.fn(),
    },
    getOrCreateHappierMcpBridge: vi.fn(async () => ({ mcpConfigJson: '{}' })),
    addClaudeSessionHookCallback: vi.fn(),
    removeClaudeSessionHookCallback: vi.fn(),
    onSessionFound: vi.fn(),
    onThinkingChange: vi.fn(),
    setThinkingWithoutTaskLifecycle: vi.fn(),
    noteUserAbortRequested: vi.fn(),
    abortCurrentTaskTurn: vi.fn(),
  } as unknown as Session;
}

function readFirstInvocationOrder(
  spy: Readonly<{ mock: Readonly<{ invocationCallOrder: readonly number[] }> }>,
  label: string,
): number {
  const order = spy.mock.invocationCallOrder[0];
  if (typeof order !== 'number') {
    throw new Error(`Expected ${label} to have been called`);
  }
  return order;
}

function getFailTurnSpy(session: Session) {
  const failTurn = session.client.sessionTurnLifecycle?.failTurn;
  if (!failTurn) {
    throw new Error('test fixture missing sessionTurnLifecycle.failTurn');
  }
  return vi.mocked(failTurn);
}

describe('claudeUnifiedTerminalLauncher', () => {
  afterEach(() => {
    restoreProcessTty();
    vi.clearAllMocks();
  });

  it('foreground-attaches tty-started tmux unified sessions after the host is ready', async () => {
    setProcessTty(true);
    const terminal: NonNullable<TerminalAttachmentInfo['terminal']> = {
      mode: 'tmux',
      tmux: { target: 'happy:unified-window' },
    };
    const handle: TerminalHostHandle = {
      kind: 'tmux',
      sessionName: 'happy',
      paneId: 'unified-window',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        liveProbe: 'required',
      },
    };
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalHostReady?: (params: { handle: TerminalHostHandle; terminal: NonNullable<TerminalAttachmentInfo['terminal']> }) => void;
    }) => {
      opts.onTerminalHostReady?.({ handle, terminal });
    });

    await claudeUnifiedTerminalLauncher(createSession(), {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'tmux',
      },
    });

    expect(mocks.runTmuxAttach).toHaveBeenCalledWith({
      sessionId: 'happy-session-id',
      terminal,
    });
  });

  it('foreground-attaches tty-started zellij unified sessions after the host is ready', async () => {
    setProcessTty(true);
    const terminal = {
      mode: 'zellij',
      zellij: { sessionName: 'happy-zellij', paneId: 'terminal_7' },
    } as NonNullable<TerminalAttachmentInfo['terminal']>;
    const handle: TerminalHostHandle = {
      kind: 'zellij',
      sessionName: 'happy-zellij',
      paneId: 'terminal_7',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        liveProbe: 'required',
      },
    };
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalHostReady?: (params: { handle: TerminalHostHandle; terminal: NonNullable<TerminalAttachmentInfo['terminal']> }) => void;
    }) => {
      opts.onTerminalHostReady?.({ handle, terminal });
    });

    await claudeUnifiedTerminalLauncher(createSession(), {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'zellij',
      },
    });

    expect(mocks.runZellijAttach).toHaveBeenCalledWith({
      sessionId: 'happy-session-id',
      terminal,
    });
  });

  it('suppresses Claude transcript user echoes for accepted UI prompts', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
      onMessage?: (message: unknown) => void;
    }) => {
      await opts.onTerminalPromptInjected?.({
        message: 'hello from ui',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      opts.onMessage?.({
        type: 'user',
        uuid: 'user-echo',
        message: { role: 'user', content: 'hello from ui' },
      });
      opts.onMessage?.({
        type: 'assistant',
        uuid: 'assistant-reply',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    expect(session.client.sendClaudeSessionMessage).toHaveBeenCalledTimes(1);
    expect(session.client.recordClaudeJsonlMessageConsumed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user',
      uuid: 'user-echo',
    }));
    expect(session.client.sendClaudeSessionMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'assistant',
      uuid: 'assistant-reply',
    }));
  });

  it('suppresses historical persisted user echoes during unified resume replay without suppressing fresh terminal input', async () => {
    setProcessTty(false);
    const session = createSession();
    const fetchRecentTranscriptTextItemsForAcpImport = session.client.fetchRecentTranscriptTextItemsForAcpImport;
    if (!fetchRecentTranscriptTextItemsForAcpImport) {
      throw new Error('test fixture missing fetchRecentTranscriptTextItemsForAcpImport');
    }
    vi.mocked(fetchRecentTranscriptTextItemsForAcpImport).mockResolvedValueOnce([
      { role: 'user', text: 'repeatable prompt' },
      { role: 'agent', text: 'old reply' },
    ]);
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onMessage?: (message: unknown) => void;
    }) => {
      opts.onMessage?.({
        type: 'user',
        uuid: 'historical-user-echo',
        timestamp: '2000-01-01T00:00:00.000Z',
        message: { role: 'user', content: 'repeatable prompt' },
      });
      opts.onMessage?.({
        type: 'user',
        uuid: 'fresh-terminal-user',
        timestamp: new Date(Date.now() + 1_000).toISOString(),
        message: { role: 'user', content: 'repeatable prompt' },
      });
      opts.onMessage?.({
        type: 'assistant',
        uuid: 'assistant-reply',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    expect(session.client.fetchRecentTranscriptTextItemsForAcpImport).toHaveBeenCalledWith({ take: 500 });
    expect(session.client.recordClaudeJsonlMessageConsumed).toHaveBeenCalledWith(expect.objectContaining({
      type: 'user',
      uuid: 'historical-user-echo',
    }));
    expect(session.client.sendClaudeSessionMessage).toHaveBeenCalledTimes(2);
    expect(session.client.sendClaudeSessionMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'user',
      uuid: 'fresh-terminal-user',
    }));
    expect(session.client.sendClaudeSessionMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'assistant',
      uuid: 'assistant-reply',
    }));
  });

  it('starts the canonical Claude turn only after a new-turn terminal injection is accepted', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
    }) => {
      expect(session.client.sessionTurnLifecycle?.beginTurn).not.toHaveBeenCalled();
      await opts.onTerminalPromptInjected?.({
        message: 'hello from ui',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    expect(session.client.sessionTurnLifecycle?.beginTurn).toHaveBeenCalledWith({ provider: 'claude' });
    expect(session.setThinkingWithoutTaskLifecycle).toHaveBeenCalledWith(true);
    expect(session.onThinkingChange).not.toHaveBeenCalledWith(true);
  });

  it('completes the canonical Claude turn when unified lifecycle reports ready', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
      onReady?: () => void | Promise<void>;
    }) => {
      await opts.onTerminalPromptInjected?.({
        message: 'hello from ui',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      await opts.onReady?.();
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    await vi.waitFor(() => {
      expect(session.client.sessionTurnLifecycle?.completeTurn).toHaveBeenCalledWith({ provider: 'claude' });
    });
    expect(readFirstInvocationOrder(vi.mocked(session.client.sessionTurnLifecycle!.completeTurn!), 'completeTurn')).toBeGreaterThan(
      readFirstInvocationOrder(vi.mocked(session.client.sessionTurnLifecycle!.beginTurn), 'beginTurn'),
    );
  });

  it('starts and completes a canonical Claude turn for terminal-originated unified prompts', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onProviderPromptStarted?: () => void | Promise<void>;
      onReady?: () => void | Promise<void>;
    }) => {
      await opts.onProviderPromptStarted?.();
      await opts.onReady?.();
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    await vi.waitFor(() => {
      expect(session.client.sessionTurnLifecycle?.beginTurn).toHaveBeenCalledWith({ provider: 'claude' });
      expect(session.client.sessionTurnLifecycle?.completeTurn).toHaveBeenCalledWith({ provider: 'claude' });
    });
  });

  it('does not start a second canonical turn for in-flight steering injections', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'in_flight_steer';
        turnStateAtInjection: 'running';
      }) => void | Promise<void>;
    }) => {
      await opts.onTerminalPromptInjected?.({
        message: 'steer this turn',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'in_flight_steer',
        turnStateAtInjection: 'running',
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    expect(session.client.sessionTurnLifecycle?.beginTurn).not.toHaveBeenCalled();
    expect(session.setThinkingWithoutTaskLifecycle).not.toHaveBeenCalledWith(true);
    expect(session.onThinkingChange).not.toHaveBeenCalledWith(true);
  });

  it('uses a CLI positional prompt as the first terminal-injected unified input', async () => {
    setProcessTty(false);
    const session = createSession();
    session.claudeArgs = ['--model', 'opus', 'run pwd'];
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      claudeArgs?: readonly string[];
      initialMode?: unknown;
      allowFirstInputBeforeSessionStart?: boolean;
      nextMessage: () => Promise<{ message: string; mode: unknown } | null>;
    }) => {
      expect(opts.claudeArgs).toEqual(['--model', 'opus']);
      expect(opts.initialMode).toBeUndefined();
      expect(opts.allowFirstInputBeforeSessionStart).toBe(true);
      const first = await opts.nextMessage();
      expect(first).toEqual({
        message: 'run pwd',
        mode: expect.objectContaining({
          permissionMode: 'acceptEdits',
          claudeUnifiedTerminalHost: 'zellij',
        }),
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'acceptEdits',
        claudeUnifiedTerminalHost: 'zellij',
      },
    });

    expect(session.queue.waitForMessagesAndGetAsString).not.toHaveBeenCalled();
  });

  it('imports CLI positional prompt transcript rows because Happier has no submitted-message echo to suppress', async () => {
    setProcessTty(false);
    const session = createSession();
    session.claudeArgs = ['--model', 'opus', 'source cli prompt'];
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      nextMessage: () => Promise<{ message: string; mode: unknown } | null>;
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
      onMessage?: (message: unknown) => void;
    }) => {
      const first = await opts.nextMessage();
      expect(first).toEqual(expect.objectContaining({
        message: 'source cli prompt',
      }));
      if (!first) throw new Error('Expected CLI positional prompt');

      await opts.onTerminalPromptInjected?.({
        message: first.message,
        mode: first.mode,
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      opts.onMessage?.({
        type: 'user',
        uuid: 'cli-positional-user',
        message: { role: 'user', content: 'source cli prompt' },
      });
      opts.onMessage?.({
        type: 'assistant',
        uuid: 'cli-positional-assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] },
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'acceptEdits',
        claudeUnifiedTerminalHost: 'zellij',
      },
    });

    expect(session.client.recordClaudeJsonlMessageConsumed).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'user',
      uuid: 'cli-positional-user',
    }));
    expect(session.client.sendClaudeSessionMessage).toHaveBeenCalledTimes(2);
    expect(session.client.sendClaudeSessionMessage).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'user',
      uuid: 'cli-positional-user',
    }));
    expect(session.client.sendClaudeSessionMessage).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'assistant',
      uuid: 'cli-positional-assistant',
    }));
  });

  it('allows the first session-queue prompt before Claude lifecycle starts', async () => {
    setProcessTty(false);
    const session = createSession();
    vi.mocked(session.queue.waitForMessagesAndGetAsString).mockResolvedValueOnce({
      message: 'daemon queued prompt',
      mode: {
        permissionMode: 'safe-yolo',
        claudeUnifiedTerminalEnabled: true,
        localId: 'daemon-initial-prompt:happy-session-id',
      },
    } as never);
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      allowFirstInputBeforeSessionStart?: boolean;
      nextMessage: () => Promise<{ message: string; mode: unknown } | null>;
    }) => {
      expect(opts.allowFirstInputBeforeSessionStart).toBe(true);
      await expect(opts.nextMessage()).resolves.toEqual({
        message: 'daemon queued prompt',
        mode: expect.objectContaining({
          permissionMode: 'safe-yolo',
          claudeUnifiedTerminalEnabled: true,
        }),
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: undefined,
    });
  });

  it('forwards the resolved default coding prompt into unified terminal spawn options', async () => {
    setProcessTty(false);
    const session = createSession();
    Object.defineProperty(session, 'defaultSystemPromptText', {
      configurable: true,
      value: 'Resolved default coding prompt',
    });
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      systemPromptText?: string | null;
    }) => {
      expect(opts.systemPromptText).toBe('Resolved default coding prompt');
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });
  });

  it('uses the committed assistant snapshot for unified ready notifications after terminal injection starts a turn', async () => {
    setProcessTty(false);
    const session = createSession();
    const sendToAllDevices = vi.fn();
    const beginTurnAssistantTextSnapshot = vi.fn(() => 'ready-turn-1');
    const getTurnAssistantTextSnapshot = vi.fn((params: { turnToken?: string | null; startSeqExclusive?: number | null }) => (
      params.turnToken === 'ready-turn-1' && params.startSeqExclusive === 42
        ? {
            turnToken: 'ready-turn-1',
            text: 'Latest unified assistant response',
            observedAtMs: 123,
            seq: 45,
            localId: 'assistant-message-1',
            sidechainId: null,
            provider: 'claude',
            source: 'committed' as const,
          }
        : null
    ));
    (session as any).pushSender = { sendToAllDevices };
    (session.client as any).getLastObservedMessageSeq = vi.fn(() => 42);
    (session.client as any).beginTurnAssistantTextSnapshot = beginTurnAssistantTextSnapshot;
    (session.client as any).getTurnAssistantTextSnapshot = getTurnAssistantTextSnapshot;
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
      onReady?: () => void | Promise<void>;
    }) => {
      await opts.onTerminalPromptInjected?.({
        message: 'hello from ui',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      await opts.onReady?.();
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    expect(beginTurnAssistantTextSnapshot).toHaveBeenCalledWith({ startSeqExclusive: 42 });
    expect(getTurnAssistantTextSnapshot).toHaveBeenCalledWith({
      turnToken: 'ready-turn-1',
      startSeqExclusive: 42,
    });
    expect(sendToAllDevices).toHaveBeenCalledWith(
      'Claude',
      'Latest unified assistant response',
      { sessionId: 'happy-session-id' },
    );
  });

  it('uses the committed assistant snapshot for terminal-originated unified ready notifications', async () => {
    setProcessTty(false);
    const session = createSession();
    const sendToAllDevices = vi.fn();
    const beginTurnAssistantTextSnapshot = vi.fn(() => 'terminal-turn-1');
    const getTurnAssistantTextSnapshot = vi.fn((params: { turnToken?: string | null; startSeqExclusive?: number | null }) => (
      params.turnToken === 'terminal-turn-1' && params.startSeqExclusive === 7
        ? {
            turnToken: 'terminal-turn-1',
            text: 'Direct terminal assistant response',
            observedAtMs: 456,
            seq: 9,
            localId: 'assistant-message-terminal',
            sidechainId: null,
            provider: 'claude',
            source: 'committed' as const,
          }
        : null
    ));
    (session as any).pushSender = { sendToAllDevices };
    (session.client as any).getLastObservedMessageSeq = vi.fn(() => 7);
    (session.client as any).beginTurnAssistantTextSnapshot = beginTurnAssistantTextSnapshot;
    (session.client as any).getTurnAssistantTextSnapshot = getTurnAssistantTextSnapshot;
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onProviderPromptStarted?: () => void | Promise<void>;
      onReady?: () => void | Promise<void>;
    }) => {
      await opts.onProviderPromptStarted?.();
      await opts.onReady?.();
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    expect(beginTurnAssistantTextSnapshot).toHaveBeenCalledWith({ startSeqExclusive: 7 });
    expect(getTurnAssistantTextSnapshot).toHaveBeenCalledWith({
      turnToken: 'terminal-turn-1',
      startSeqExclusive: 7,
    });
    expect(sendToAllDevices).toHaveBeenCalledWith(
      'Claude',
      'Direct terminal assistant response',
      { sessionId: 'happy-session-id' },
    );
  });

  it('honors account notification settings and secrets for unified ready notifications', async () => {
    setProcessTty(false);
    const session = createSession();
    const settingsSecretsReadKeys = [new Uint8Array(32).fill(5)];
    const accountSettings = {
      notificationsSettingsV1: {
        v: 1,
        pushEnabled: true,
        ready: true,
        readyIncludeMessageText: false,
        permissionRequest: true,
      },
    } as AccountSettings;
    const beginTurnAssistantTextSnapshot = vi.fn(() => 'ready-turn-no-preview');
    const getTurnAssistantTextSnapshot = vi.fn(() => ({
      turnToken: 'ready-turn-no-preview',
      text: 'This text must not be included',
      observedAtMs: 123,
      seq: 45,
      localId: 'assistant-message-hidden',
      sidechainId: null,
      provider: 'claude',
      source: 'committed' as const,
    }));
    (session as any).pushSender = { sendToAllDevicesAsync: vi.fn() };
    (session as any).accountSettings = accountSettings;
    (session as any).accountSettingsSecretsReadKeys = settingsSecretsReadKeys;
    (session.client as any).getLastObservedMessageSeq = vi.fn(() => 42);
    (session.client as any).beginTurnAssistantTextSnapshot = beginTurnAssistantTextSnapshot;
    (session.client as any).getTurnAssistantTextSnapshot = getTurnAssistantTextSnapshot;
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
      onReady?: () => void | Promise<void>;
    }) => {
      await opts.onTerminalPromptInjected?.({
        message: 'hello from ui',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      await opts.onReady?.();
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    await vi.waitFor(() => {
      expect(mocks.dispatchActivityNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({
        settings: accountSettings,
        settingsSecretsReadKeys,
        event: expect.objectContaining({
          topic: 'ready',
          assistantPreviewText: null,
        }),
      }));
    });
    expect(getTurnAssistantTextSnapshot).not.toHaveBeenCalled();
  });

  it('surfaces unified StopFailure usage-limit details through the session runtime issue path', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onUsageLimitDetails?: (details: unknown) => void | Promise<void>;
    }) => {
      expect(opts.onUsageLimitDetails).toBeTypeOf('function');
      opts.onUsageLimitDetails?.({
        v: 1,
        resetAtMs: null,
        retryAfterMs: null,
        quotaScope: 'account',
        recoverability: 'wait',
        providerLimitId: 'rate_limit',
        planType: null,
        utilization: null,
        overage: null,
        action: null,
        connectedService: null,
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    await vi.waitFor(() => {
      expect(session.client.sessionTurnLifecycle?.failTurn).toHaveBeenCalledWith({
        provider: 'claude',
        issue: expect.objectContaining({
          code: 'usage_limit',
          source: 'usage_limit',
          provider: 'claude',
          usageLimit: expect.objectContaining({
            providerLimitId: 'rate_limit',
          }),
        }),
      });
    });
  });

  it('surfaces unified overloaded capacity details through the session runtime issue path', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onUsageLimitDetails?: (details: unknown) => void | Promise<void>;
    }) => {
      expect(opts.onUsageLimitDetails).toBeTypeOf('function');
      opts.onUsageLimitDetails?.({
        v: 1,
        resetAtMs: null,
        retryAfterMs: null,
        quotaScope: 'account',
        recoverability: 'wait',
        limitCategory: 'capacity',
        providerLimitId: 'server_overloaded',
        planType: null,
        utilization: null,
        overage: null,
        action: null,
        connectedService: null,
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    await vi.waitFor(() => {
      expect(session.client.sessionTurnLifecycle?.failTurn).toHaveBeenCalledWith({
        provider: 'claude',
        issue: expect.objectContaining({
          code: 'provider_status_error',
          source: 'provider_status_error',
          provider: 'claude',
          usageLimit: expect.objectContaining({
            limitCategory: 'capacity',
            providerLimitId: 'server_overloaded',
          }),
        }),
      });
    });
  });

  it('surfaces unified transcript auth failures through the session runtime issue path', async () => {
    setProcessTty(false);
    const previousSelectionEnv = process.env[HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY];
    process.env[HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY] = JSON.stringify([{
      kind: 'group',
      serviceId: 'claude-subscription',
      groupId: 'claude',
      activeProfileId: 'claude-main',
      fallbackProfileId: 'claude-main',
      generation: 1,
    }]);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onRuntimeAuthFailureEvent?: (error: unknown) => void | Promise<void>;
    }) => {
      expect(opts.onRuntimeAuthFailureEvent).toBeTypeOf('function');
      await opts.onRuntimeAuthFailureEvent?.({
        type: 'assistant',
        isApiErrorMessage: true,
        error: 'authentication_failed',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Not logged in · Please run /login' }],
        },
      });
    });

    try {
      await claudeUnifiedTerminalLauncher(session, {
        initialMode: {
          permissionMode: 'default',
          claudeUnifiedTerminalHost: 'auto',
        },
      });
    } finally {
      if (previousSelectionEnv === undefined) {
        delete process.env[HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY];
      } else {
        process.env[HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY] = previousSelectionEnv;
      }
    }

    await vi.waitFor(() => {
      expect(session.client.sessionTurnLifecycle?.failTurn).toHaveBeenCalledWith({
        provider: 'claude',
        issue: expect.objectContaining({
          code: 'auth_error',
          source: 'auth_error',
          provider: 'claude',
        }),
      });
    });
  });

  it('surfaces unified transcript provider API errors through the session runtime issue path', async () => {
    setProcessTty(false);
    const session = createSession();
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      onTerminalPromptInjected?: (acceptedPrompt: {
        message: string;
        mode: { permissionMode: 'default'; claudeUnifiedTerminalEnabled: true };
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
      onPromptTurnTerminal?: (event: {
        reason: 'failed';
        source: string;
        detail?: string;
      }) => void | Promise<void>;
    }) => {
      expect(opts.onPromptTurnTerminal).toBeTypeOf('function');
      await opts.onTerminalPromptInjected?.({
        message: 'hello',
        mode: { permissionMode: 'default', claudeUnifiedTerminalEnabled: true },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      await opts.onPromptTurnTerminal?.({
        reason: 'failed',
        source: 'claude_transcript_api_error',
        detail: 'api_error',
      });
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'auto',
      },
    });

    await vi.waitFor(() => {
      expect(session.client.sessionTurnLifecycle?.failTurn).toHaveBeenCalledWith({
        provider: 'claude',
        issue: expect.objectContaining({
          code: 'provider_status_error',
          source: 'provider_status_error',
          provider: 'claude',
        }),
      });
    });
  });

  it('surfaces terminal host death through the primary turn runtime issue path', async () => {
    setProcessTty(false);
    const session = createSession();
    const hostDeadError = Object.assign(new Error('Claude unified terminal host is not alive'), {
      code: 'claude_unified_terminal_host_dead',
    });
    mocks.runClaudeUnifiedTerminalSession.mockRejectedValueOnce(hostDeadError);

    await expect(claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'zellij',
      },
    })).rejects.toBe(hostDeadError);

    expect(session.client.sessionTurnLifecycle?.failTurn).toHaveBeenCalledWith({
      provider: 'claude',
      issue: expect.objectContaining({
        code: 'provider_process_exit',
        source: 'provider_process_exit',
        provider: 'claude',
      }),
    });
    expect(session.client.sendSessionEvent).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message',
      message: expect.stringContaining('Claude unified terminal host is not alive'),
    }));
    expect(session.client.flush).toHaveBeenCalledTimes(1);
    expect(readFirstInvocationOrder(vi.mocked(session.client.flush), 'flush')).toBeGreaterThan(
      readFirstInvocationOrder(getFailTurnSpy(session), 'failTurn'),
    );
    expect(readFirstInvocationOrder(vi.mocked(session.client.flush), 'flush')).toBeGreaterThan(
      readFirstInvocationOrder(vi.mocked(session.client.sendSessionEvent), 'sendSessionEvent'),
    );
    expect(session.onThinkingChange).toHaveBeenCalledWith(false);
  });

  it('surfaces terminal injection failures through the primary turn runtime issue path', async () => {
    setProcessTty(false);
    const session = createSession();
    const injectionError = Object.assign(new Error('Claude unified terminal injection failed: timeout'), {
      code: 'claude_unified_terminal_injection_failed',
    });
    mocks.runClaudeUnifiedTerminalSession.mockRejectedValueOnce(injectionError);

    await expect(claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'zellij',
      },
    })).rejects.toBe(injectionError);

    expect(session.client.sessionTurnLifecycle?.failTurn).toHaveBeenCalledWith({
      provider: 'claude',
      issue: expect.objectContaining({
        code: 'provider_session_error',
        source: 'provider_session_error',
        provider: 'claude',
      }),
    });
    expect(session.onThinkingChange).toHaveBeenCalledWith(false);
  });

  it('registers UI abort as a terminal-host turn interrupt for CLI-started unified sessions', async () => {
    setProcessTty(false);
    const session = createSession();
    const turnInterrupt = vi.fn(async () => {});
    let abortHandler: (() => Promise<boolean>) | undefined;
    let runnerSignal: AbortSignal | undefined;
    vi.mocked(session.client.rpcHandlerManager.registerHandler).mockImplementation((method, handler) => {
      if (method === 'abort') {
        abortHandler = handler as () => Promise<boolean>;
      }
    });
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      signal?: AbortSignal;
      setTurnInterrupt?: (handler: (() => Promise<void>) | null) => void;
      onTerminalPromptInjected?: (accepted: {
        message: string;
        mode: unknown;
        acceptedAs: 'new_turn';
        turnStateAtInjection: 'idle';
      }) => void | Promise<void>;
    }) => {
      runnerSignal = opts.signal;
      opts.setTurnInterrupt?.(turnInterrupt);
      await opts.onTerminalPromptInjected?.({
        message: 'please stop this',
        mode: {
          permissionMode: 'default',
          claudeUnifiedTerminalEnabled: true,
          claudeUnifiedTerminalHost: 'auto',
        },
        acceptedAs: 'new_turn',
        turnStateAtInjection: 'idle',
      });
      await abortHandler?.();
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'tmux',
      },
    });

    expect(session.client.rpcHandlerManager.registerHandler).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(turnInterrupt).toHaveBeenCalledTimes(1);
    expect(session.noteUserAbortRequested).toHaveBeenCalledTimes(1);
    expect(session.abortCurrentTaskTurn).toHaveBeenCalledTimes(1);
    expect(session.client.sessionTurnLifecycle?.cancelTurn).toHaveBeenCalledWith({ provider: 'claude' });
    expect(runnerSignal?.aborted).toBe(false);
    expect(session.client.sendSessionEvent).toHaveBeenCalledWith({ type: 'message', message: 'Aborted by user' });
  });

  it('does not stop the unified terminal host when UI abort is requested before an interrupt handler is ready', async () => {
    setProcessTty(false);
    const session = createSession();
    let abortHandler: (() => Promise<boolean>) | undefined;
    let runnerSignal: AbortSignal | undefined;
    vi.mocked(session.client.rpcHandlerManager.registerHandler).mockImplementation((method, handler) => {
      if (method === 'abort') {
        abortHandler = handler as () => Promise<boolean>;
      }
    });
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      signal?: AbortSignal;
    }) => {
      runnerSignal = opts.signal;
      expect(await abortHandler?.()).toBe(true);
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'tmux',
      },
    });

    expect(session.noteUserAbortRequested).toHaveBeenCalledTimes(1);
    expect(session.abortCurrentTaskTurn).toHaveBeenCalledTimes(1);
    expect(runnerSignal?.aborted).toBe(false);
  });

  it('does not stop the unified terminal host when terminal turn interruption fails', async () => {
    setProcessTty(false);
    const session = createSession();
    const turnInterrupt = vi.fn(async () => {
      throw new Error('terminal unavailable');
    });
    let abortHandler: (() => Promise<boolean>) | undefined;
    let runnerSignal: AbortSignal | undefined;
    vi.mocked(session.client.rpcHandlerManager.registerHandler).mockImplementation((method, handler) => {
      if (method === 'abort') {
        abortHandler = handler as () => Promise<boolean>;
      }
    });
    mocks.runClaudeUnifiedTerminalSession.mockImplementationOnce(async (opts: {
      signal?: AbortSignal;
      setTurnInterrupt?: (handler: (() => Promise<void>) | null) => void;
    }) => {
      runnerSignal = opts.signal;
      opts.setTurnInterrupt?.(turnInterrupt);
      expect(await abortHandler?.()).toBe(true);
    });

    await claudeUnifiedTerminalLauncher(session, {
      initialMode: {
        permissionMode: 'default',
        claudeUnifiedTerminalHost: 'tmux',
      },
    });

    expect(turnInterrupt).toHaveBeenCalledTimes(1);
    expect(session.noteUserAbortRequested).toHaveBeenCalledTimes(1);
    expect(session.abortCurrentTaskTurn).toHaveBeenCalledTimes(1);
    expect(runnerSignal?.aborted).toBe(false);
  });
});
