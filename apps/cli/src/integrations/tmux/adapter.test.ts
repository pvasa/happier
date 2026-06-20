import { afterEach, describe, expect, it, vi } from 'vitest';

import { parseClaudeScreenState, resolveClaudeScreenInFlightSteerVeto } from '@/backends/claude/unifiedTerminal/tuiControls/screenState';

import { createTmuxTerminalHostAdapter } from './adapter';
import { TmuxUtilities } from './TmuxUtilities';

const TMUX_HANDLE = {
  kind: 'tmux',
  sessionName: 'happy',
  paneId: 'claude.1',
  attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
} as const;

describe('createTmuxTerminalHostAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  describe('captureInputState multi-line fidelity (R-E1)', () => {
    it('returns the FULL pane so multi-line steer vetoes (permission prompt above the bottom line) fire on tmux', async () => {
      // Live-shaped capture-pane output: a permission dialog sits ABOVE the bottom composer line.
      const fullPane = [
        '● Reading file src/index.ts',
        '',
        'Do you want to proceed?',
        '❯ 1. Yes',
        '  2. No',
        '',
        '│ > │',
      ].join('\n');
      const tmux = new TmuxUtilities();
      vi.spyOn(tmux, 'executeTmuxCommand').mockImplementation(async (args) => ({
        returncode: 0,
        stdout: args[0] === 'capture-pane'
          ? `${fullPane}\n`
          : args[0] === 'display-message'
            ? '4\t6\n'
            : '',
        stderr: '',
        command: [...args],
      }));
      const adapter = createTmuxTerminalHostAdapter({ tmux });

      const inputState = await adapter.captureInputState?.(TMUX_HANDLE);
      expect(inputState).toBeDefined();
      expect(inputState?.cursor).toEqual({ x: 4, y: 6 });

      const screen = parseClaudeScreenState(inputState!.currentInput, { cursor: inputState!.cursor });
      // The permission prompt is several lines above the bottom; a last-line-only capture cannot see it.
      expect(screen.permissionPromptVisible).toBe(true);
      expect(resolveClaudeScreenInFlightSteerVeto(screen)).toBe('permission_prompt');
    });
  });

  it('declares terminal-host attach metadata for created tmux hosts', async () => {
    const tmux = new TmuxUtilities();
    vi.spyOn(tmux, 'spawnInTmux').mockResolvedValue({
      success: true,
      sessionName: 'happy',
      windowName: 'claude.1',
    });
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(adapter.createOrAttachHost({
      sessionName: 'happy',
      workingDirectory: '/workspace/project',
      spawnArgv: ['/managed/node', 'claude_local_launcher.cjs'],
      spawnEnv: { HAPPIER_CLAUDE_PATH: '/opt/claude/cli.js' },
      isolatedEnv: true,
    })).resolves.toMatchObject({
      kind: 'tmux',
      sessionName: 'happy',
      paneId: 'claude.1',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        maxClients: null,
        requiresLocalAttachmentInfo: true,
        liveProbe: 'required',
      },
    });
  });

  it('types prompt text as literal keys and submits with carriage return', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand').mockResolvedValue({
      returncode: 0,
      stdout: '0\t12345\tclaude\n',
      stderr: '',
      command: [],
    });
    vi.spyOn(tmux, 'captureCurrentInput').mockResolvedValue('');
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: { deferredUntilQuietMs: 250 },
        },
      ),
    ).resolves.toMatchObject({ status: 'injected' });

    expect(executeTmuxCommand.mock.calls.map((call) => call[0])).toEqual([
      ['display-message', '-p', '-t', 'happy:claude.1', '#{pane_dead}\t#{pane_pid}\t#{pane_current_command}'],
      ['display-message', '-p', '#{cursor_x}\t#{cursor_y}'],
      ['display-message', '-p', '#{cursor_x}\t#{cursor_y}'],
      ['send-keys', '-t', 'happy:claude.1', '-l', '--', 'queued prompt'],
      ['send-keys', '-t', 'happy:claude.1', 'C-m'],
    ]);
  });

  it('types multiline prompts with tmux newline keys before submitting with carriage return', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand').mockResolvedValue({
      returncode: 0,
      stdout: '0\t12345\tclaude\n',
      stderr: '',
      command: [],
    });
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'alpha\nbeta',
          multiline: true,
          origin: { kind: 'ui_pending', nonce: 'nonce-multiline' },
          scheduling: {},
        },
      ),
    ).resolves.toMatchObject({ status: 'injected' });

    expect(executeTmuxCommand.mock.calls.map((call) => call[0])).toEqual([
      ['display-message', '-p', '-t', 'happy:claude.1', '#{pane_dead}\t#{pane_pid}\t#{pane_current_command}'],
      ['send-keys', '-t', 'happy:claude.1', '-l', '--', 'alpha'],
      ['send-keys', '-t', 'happy:claude.1', 'C-j'],
      ['send-keys', '-t', 'happy:claude.1', '-l', '--', 'beta'],
      ['send-keys', '-t', 'happy:claude.1', 'C-m'],
    ]);
  });

  it('chunks literal prompt text without treating leading dashes as tmux options', async () => {
    const originalChunkSize = process.env.HAPPIER_CLI_TMUX_SEND_KEYS_CHUNK_SIZE;
    process.env.HAPPIER_CLI_TMUX_SEND_KEYS_CHUNK_SIZE = '4';
    try {
      const tmux = new TmuxUtilities();
      const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand').mockResolvedValue({
        returncode: 0,
        stdout: '0\t12345\tclaude\n',
        stderr: '',
        command: [],
      });
      const adapter = createTmuxTerminalHostAdapter({ tmux });

      await expect(
        adapter.injectUserPrompt(
          {
            kind: 'tmux',
            sessionName: 'happy',
            paneId: 'claude.1',
            attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
          },
          {
            text: '-abcdef',
            multiline: false,
            origin: { kind: 'ui_pending', nonce: 'nonce-chunked' },
            scheduling: {},
          },
        ),
      ).resolves.toMatchObject({ status: 'injected' });

      expect(executeTmuxCommand.mock.calls.map((call) => call[0])).toEqual([
        ['display-message', '-p', '-t', 'happy:claude.1', '#{pane_dead}\t#{pane_pid}\t#{pane_current_command}'],
        ['send-keys', '-t', 'happy:claude.1', '-l', '--', '-abc'],
        ['send-keys', '-t', 'happy:claude.1', '-l', '--', 'def'],
        ['send-keys', '-t', 'happy:claude.1', 'C-m'],
      ]);
    } finally {
      if (originalChunkSize === undefined) {
        delete process.env.HAPPIER_CLI_TMUX_SEND_KEYS_CHUNK_SIZE;
      } else {
        process.env.HAPPIER_CLI_TMUX_SEND_KEYS_CHUNK_SIZE = originalChunkSize;
      }
    }
  });

  it('honors runtime-core deferral reasons before touching tmux', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand');
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: { deferReason: 'permission_blocked', retryAfterMs: 500 },
        },
      ),
    ).resolves.toEqual({ status: 'deferred', reason: 'permission_blocked', retryAfterMs: 500 });

    expect(executeTmuxCommand).not.toHaveBeenCalled();
  });

  it('interrupts the active tmux turn with Escape on the canonical window target', async () => {
    const tmux = new TmuxUtilities();
    const sendKeys = vi.spyOn(tmux, 'sendKeys').mockResolvedValue(true);
    const adapter = createTmuxTerminalHostAdapter({ tmux });
    const interruptTurn = (adapter as unknown as {
      interruptTurn?: (handle: {
        kind: 'tmux';
        sessionName: string;
        paneId?: string;
        attachMetadata: { attachStrategy: 'terminal_host'; topology: 'shared' };
      }) => Promise<void>;
    }).interruptTurn;

    expect(interruptTurn).toBeTypeOf('function');
    await interruptTurn?.({
      kind: 'tmux',
      sessionName: 'happy',
      paneId: 'claude.1',
      attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
    });

    expect(sendKeys).toHaveBeenCalledWith('Escape', 'happy:claude.1');
  });

  it('fails with no_target when the handle has no tmux target', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand');
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: '',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: {},
        },
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'no_target',
      phase: 'liveness',
      duplicateRisk: 'none',
      recoverable: true,
    });

    expect(executeTmuxCommand).not.toHaveBeenCalled();
  });

  it('fails with pane_dead when tmux liveness reports a dead pane', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand').mockResolvedValue({
      returncode: 0,
      stdout: '1\t12345\tzsh\n',
      stderr: '',
      command: [],
    });
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: {},
        },
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'pane_dead',
      phase: 'liveness',
      duplicateRisk: 'none',
      recoverable: false,
    });

    expect(executeTmuxCommand).toHaveBeenCalledTimes(1);
  });

  it('defers instead of failing when tmux liveness probe is inconclusive', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand').mockResolvedValue({
      returncode: 1,
      stdout: '',
      stderr: 'display-message timed out',
      command: [],
    });
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: { retryAfterMs: 250 },
        },
      ),
    ).resolves.toEqual({
      status: 'deferred',
      reason: 'pane_initializing',
      retryAfterMs: 250,
    });

    expect(executeTmuxCommand).toHaveBeenCalledTimes(1);
  });

  it('fails with host_unreachable when typed tmux injection fails', async () => {
    const tmux = new TmuxUtilities();
    vi.spyOn(tmux, 'executeTmuxCommand').mockImplementation(async (args) => ({
      returncode: args[0] === 'display-message' ? 0 : 1,
      stdout: args[0] === 'display-message' ? '0\t12345\tclaude\n' : '',
      stderr: args[0] === 'send-keys' ? 'tmux unavailable' : '',
      command: [...args],
    }));
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: {},
        },
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'host_unreachable',
      phase: 'during_write',
      duplicateRisk: 'none',
      recoverable: true,
    });
  });

  it('fails with timeout when prompt injection exceeds its deadline', async () => {
    const tmux = new TmuxUtilities();
    vi.spyOn(tmux, 'executeTmuxCommand').mockImplementation(async (args) => {
      if (args[0] === 'display-message') {
        return { returncode: 0, stdout: '0\t12345\tclaude\n', stderr: '', command: [...args] };
      }
      return { returncode: 1, stdout: '', stderr: '', command: [...args], timedOut: true };
    });
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: { timeoutMs: 5 },
        },
      ),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
      phase: 'during_write',
      duplicateRisk: 'possible',
      recoverable: true,
    });
  });

  it('does not report timeout while a tmux write command can still continue', async () => {
    vi.useFakeTimers();
    const tmux = new TmuxUtilities();
    const calls: readonly string[][] = [];
    let finishWrite: ((result: { returncode: number; stdout: string; stderr: string; command: string[] }) => void) | undefined;
    vi.spyOn(tmux, 'executeTmuxCommand').mockImplementation(async (args) => {
      (calls as string[][]).push([...args]);
      if (args[0] === 'display-message') {
        return { returncode: 0, stdout: '0\t12345\tclaude\n', stderr: '', command: [...args] };
      }
      if (args[0] === 'send-keys' && args.includes('-l')) {
        return new Promise((resolve) => {
          finishWrite = resolve;
        });
      }
      return { returncode: 0, stdout: '', stderr: '', command: [...args] };
    });
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    let settled = false;
    const injection = adapter.injectUserPrompt(
      {
        kind: 'tmux',
        sessionName: 'happy',
        paneId: 'claude.1',
        attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
      },
      {
        text: 'queued prompt',
        multiline: false,
        origin: { kind: 'ui_pending', nonce: 'nonce-a' },
        scheduling: { timeoutMs: 5 },
      },
    ).finally(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);

    finishWrite?.({ returncode: 0, stdout: '', stderr: '', command: [] });
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(injection).resolves.toMatchObject({ status: 'injected' });
    expect(calls).toEqual([
      ['display-message', '-p', '-t', 'happy:claude.1', '#{pane_dead}\t#{pane_pid}\t#{pane_current_command}'],
      ['send-keys', '-t', 'happy:claude.1', '-l', '--', 'queued prompt'],
      ['send-keys', '-t', 'happy:claude.1', 'C-m'],
    ]);
  });

  it('defers injection with a typed user_typing result when scheduled quiet input is unstable', async () => {
    const tmux = new TmuxUtilities();
    const executeTmuxCommand = vi.spyOn(tmux, 'executeTmuxCommand').mockResolvedValue({
      returncode: 0,
      stdout: '0\t12345\tclaude\n',
      stderr: '',
      command: [],
    });
    // Two full-pane captures that differ => the user is mid-keystroke => unstable => defer.
    const captureCurrentInput = vi.spyOn(tmux, 'captureCurrentInput')
      .mockResolvedValueOnce('partial promp')
      .mockResolvedValueOnce('partial prompt');

    const adapter = createTmuxTerminalHostAdapter({ tmux });

    await expect(
      adapter.injectUserPrompt(
        {
          kind: 'tmux',
          sessionName: 'happy',
          paneId: 'claude.1',
          attachMetadata: { attachStrategy: 'terminal_host', topology: 'shared' },
        },
        {
          text: 'queued prompt',
          multiline: false,
          origin: { kind: 'ui_pending', nonce: 'nonce-a' },
          scheduling: { deferredUntilQuietMs: 250 },
        },
      ),
    ).resolves.toEqual({ status: 'deferred', reason: 'user_typing', retryAfterMs: 250 });

    expect(executeTmuxCommand).toHaveBeenCalledTimes(3);
    expect(captureCurrentInput).toHaveBeenCalledTimes(2);
    expect(captureCurrentInput).toHaveBeenNthCalledWith(1, 'happy:claude.1');
    expect(captureCurrentInput).toHaveBeenNthCalledWith(2, 'happy:claude.1');
  });

  it('exposes a runtime-control port bound to the pane that is distinct from prompt injection', async () => {
    const tmux = new TmuxUtilities();
    const adapter = createTmuxTerminalHostAdapter({ tmux });

    const port = adapter.createControlPort?.({
      kind: 'tmux',
      sessionName: 'happy',
      paneId: 'claude.1',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        maxClients: null,
        requiresLocalAttachmentInfo: true,
        liveProbe: 'required',
      },
    });

    expect(port).not.toBeNull();
    expect(port?.hostKind).toBe('tmux');
    // The control port is a dedicated surface; it must never expose prompt injection.
    expect('injectUserPrompt' in (port ?? {})).toBe(false);

    const empty = adapter.createControlPort?.({
      kind: 'tmux',
      sessionName: '   ',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        maxClients: null,
        requiresLocalAttachmentInfo: true,
        liveProbe: 'required',
      },
    });
    expect(empty).toBeNull();
  });
});
