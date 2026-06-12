import { describe, expect, it, vi } from 'vitest';

import { ClaudeUnifiedTerminalHostDeadError } from './createClaudeUnifiedController';
import { ClaudeUnifiedTerminalReadinessTimeoutError } from './createClaudeUnifiedTerminalReadinessBridge';
import { ClaudeUnifiedTerminalInjectionFailureError } from './terminalInjectionFailureError';
import {
  isClaudeUnifiedTerminalRuntimeIssueError,
  surfaceClaudeUnifiedTerminalRuntimeIssue,
} from './surfaceClaudeUnifiedTerminalRuntimeIssue';

function buildInjectionFailureError(): ClaudeUnifiedTerminalInjectionFailureError {
  return new ClaudeUnifiedTerminalInjectionFailureError({
    batch: {
      message: 'hello',
      origin: { kind: 'ui_pending' },
    },
    result: {
      status: 'failed',
      reason: 'timeout',
      phase: 'after_enter_unknown',
      duplicateRisk: 'likely',
      recoverable: true,
    },
    failureState: 'failed_terminal',
  });
}

function buildReadinessTimeoutError(): ClaudeUnifiedTerminalReadinessTimeoutError {
  return new ClaudeUnifiedTerminalReadinessTimeoutError({
    timeoutMs: 250,
    handle: {
      kind: 'tmux',
      sessionName: 'happier-claude-session-test',
      paneId: '1',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        maxClients: null,
        requiresLocalAttachmentInfo: true,
        liveProbe: 'required',
      },
    },
  });
}

describe('surfaceClaudeUnifiedTerminalRuntimeIssue', () => {
  it('classifies host-dead, injection-failure, and readiness-timeout as runtime issues', () => {
    expect(isClaudeUnifiedTerminalRuntimeIssueError(new ClaudeUnifiedTerminalHostDeadError())).toBe(true);
    expect(isClaudeUnifiedTerminalRuntimeIssueError(buildInjectionFailureError())).toBe(true);
    expect(isClaudeUnifiedTerminalRuntimeIssueError(buildReadinessTimeoutError())).toBe(true);
  });

  it('does not classify unrelated errors as runtime issues', () => {
    expect(isClaudeUnifiedTerminalRuntimeIssueError(new Error('boom'))).toBe(false);
    expect(isClaudeUnifiedTerminalRuntimeIssueError(null)).toBe(false);
    expect(isClaudeUnifiedTerminalRuntimeIssueError({ code: 'something_else' })).toBe(false);
  });

  it('surfaces a primary runtime issue through the session turn lifecycle for each classified error', async () => {
    for (const error of [
      new ClaudeUnifiedTerminalHostDeadError(),
      buildInjectionFailureError(),
      buildReadinessTimeoutError(),
    ]) {
      const failTurn = vi.fn(async () => {});
      const session = {
        sessionTurnLifecycle: {
          beginTurn: vi.fn(async () => ({ turnId: 't1' })),
          completeTurn: vi.fn(async () => {}),
          cancelTurn: vi.fn(async () => {}),
          failTurn,
        },
      } as unknown as Parameters<typeof surfaceClaudeUnifiedTerminalRuntimeIssue>[0]['session'];

      const surfaced = await surfaceClaudeUnifiedTerminalRuntimeIssue({ error, session });
      expect(surfaced).toBe(true);
      // Session-scoped deaths (host dead, readiness timeout, injection failure)
      // routinely occur with no active turn; the surfacing must allocate one so
      // the issue is not silently dropped (incident cmq8y3nlx / QA A-F4).
      expect(failTurn).toHaveBeenCalledWith({
        provider: 'claude',
        issue: expect.objectContaining({ provider: 'claude' }),
        allocateWhenIdle: true,
      });
    }
  });

  it('does not surface or touch the session for an unrelated error', async () => {
    const failTurn = vi.fn(async () => {});
    const session = {
      sessionTurnLifecycle: {
        beginTurn: vi.fn(async () => ({ turnId: 't1' })),
        completeTurn: vi.fn(async () => {}),
        cancelTurn: vi.fn(async () => {}),
        failTurn,
      },
    } as unknown as Parameters<typeof surfaceClaudeUnifiedTerminalRuntimeIssue>[0]['session'];

    const surfaced = await surfaceClaudeUnifiedTerminalRuntimeIssue({
      error: new Error('unrelated'),
      session,
    });
    expect(surfaced).toBe(false);
    expect(failTurn).not.toHaveBeenCalled();
  });
});
