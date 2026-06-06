import { afterEach, describe, expect, it, vi } from 'vitest';

import { createTmuxTerminalHostAdapter } from './adapter';
import { TmuxUtilities } from './TmuxUtilities';

describe('createTmuxTerminalHostAdapter', () => {
  afterEach(() => {
    vi.useRealTimers();
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
    vi.spyOn(tmux, 'isUserTyping').mockResolvedValue(false);
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
    await expect(injection).resolves.toEqual({
      status: 'failed',
      reason: 'timeout',
      phase: 'after_write_before_enter',
      duplicateRisk: 'possible',
      recoverable: true,
    });
    expect(calls).toEqual([
      ['display-message', '-p', '-t', 'happy:claude.1', '#{pane_dead}\t#{pane_pid}\t#{pane_current_command}'],
      ['send-keys', '-t', 'happy:claude.1', '-l', '--', 'queued prompt'],
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
    const captureCurrentInput = vi.spyOn(tmux, 'captureCurrentInput').mockResolvedValue('partial prompt');
    const isUserTyping = vi.spyOn(tmux, 'isUserTyping').mockResolvedValue(true);

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

    expect(executeTmuxCommand).toHaveBeenCalledTimes(1);
    expect(captureCurrentInput).toHaveBeenCalledWith('happy:claude.1');
    expect(isUserTyping).toHaveBeenCalledWith(50, 2, 'happy:claude.1');
  });
});
