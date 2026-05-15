import { afterEach, describe, expect, it, vi } from 'vitest';

const { createCodexAppServerRuntimeMock } = vi.hoisted(() => ({
  createCodexAppServerRuntimeMock: vi.fn<(params: any) => any>(() => ({
    startOrLoad: async () => undefined,
    getSessionId: () => 'thread_1',
    sendPrompt: async () => undefined,
    startReview: async () => undefined,
    compactContext: async () => undefined,
    cancel: async () => undefined,
    reset: async () => undefined,
  })),
}));

vi.mock('@/backends/codex/appServer/runtime', () => ({
  createCodexAppServerRuntime: createCodexAppServerRuntimeMock,
}));

describe('createCodexAppServerExecutionRunBackend', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('passes the isolated execution-run env through to the app-server runtime (no process.env fallback)', async () => {
    const { createCodexAppServerExecutionRunBackend } = await import('./createCodexAppServerExecutionRunBackend');

    createCodexAppServerExecutionRunBackend({
      cwd: '/tmp/happier-worktree',
      env: {
        PATH: '/tmp/isolated-bin:/usr/bin',
        HAPPIER_CODEX_APP_SERVER_BIN: '/tmp/fake-codex-app-server',
      } as any,
      permissionMode: 'read-only' as any,
      permissionHandler: null,
    });

    expect(createCodexAppServerRuntimeMock).toHaveBeenCalledTimes(1);
    const params = createCodexAppServerRuntimeMock.mock.calls[0]?.[0] as any;
    expect(params?.processEnv?.HAPPIER_CODEX_APP_SERVER_BIN).toBe('/tmp/fake-codex-app-server');
    expect(params?.processEnv?.PATH).toBe('/tmp/isolated-bin:/usr/bin');
  });

  it('routes /compact to the app-server compaction RPC instead of a normal prompt', async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const compactContext = vi.fn(async () => undefined);
    createCodexAppServerRuntimeMock.mockReturnValueOnce({
      startOrLoad: async () => undefined,
      getSessionId: () => 'thread_1',
      sendPrompt,
      startReview: async () => undefined,
      compactContext,
      cancel: async () => undefined,
      reset: async () => undefined,
    });

    const { createCodexAppServerExecutionRunBackend } = await import('./createCodexAppServerExecutionRunBackend');
    const backend = createCodexAppServerExecutionRunBackend({
      cwd: '/tmp/happier-worktree',
      env: {},
      permissionMode: 'read-only' as any,
      permissionHandler: null,
    });

    await backend.startSession();
    await backend.sendPrompt('thread_1', '/compact');

    expect(compactContext).toHaveBeenCalledWith('/compact');
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('starts native Codex review for the first review prompt', async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const startReview = vi.fn(async () => undefined);
    createCodexAppServerRuntimeMock.mockReturnValueOnce({
      startOrLoad: async () => undefined,
      getSessionId: () => 'thread_1',
      sendPrompt,
      startReview,
      compactContext: async () => undefined,
      cancel: async () => undefined,
      reset: async () => undefined,
    });

    const { createCodexAppServerExecutionRunBackend } = await import('./createCodexAppServerExecutionRunBackend');
    const backend = createCodexAppServerExecutionRunBackend({
      cwd: '/tmp/happier-worktree',
      env: {},
      permissionMode: 'read-only' as any,
      permissionHandler: null,
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          changeType: 'uncommitted',
          base: { kind: 'none' },
        },
      },
    });

    await backend.startSession();
    await backend.sendPrompt('thread_1', 'prompt fallback text');

    expect(startReview).toHaveBeenCalledWith({
      target: { type: 'uncommittedChanges' },
      delivery: 'inline',
    });
    expect(sendPrompt).not.toHaveBeenCalled();
  });

  it('keeps review follow-ups on the prompt path', async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const startReview = vi.fn(async () => undefined);
    createCodexAppServerRuntimeMock.mockReturnValueOnce({
      startOrLoad: async () => undefined,
      getSessionId: () => 'thread_1',
      sendPrompt,
      startReview,
      compactContext: async () => undefined,
      cancel: async () => undefined,
      reset: async () => undefined,
    });

    const { createCodexAppServerExecutionRunBackend } = await import('./createCodexAppServerExecutionRunBackend');
    const backend = createCodexAppServerExecutionRunBackend({
      cwd: '/tmp/happier-worktree',
      env: {},
      permissionMode: 'read-only' as any,
      permissionHandler: null,
      start: {
        intent: 'review',
        intentInput: {
          kind: 'review_follow_up.v1',
          parentRunRef: { runId: 'run_1', callId: 'call_1', backendId: 'codex' },
          threadId: 'thread_1',
          messageMarkdown: 'Can you expand?',
          summary: 'Summary',
          overviewMarkdown: 'Overview',
        },
      },
    });

    await backend.startSession();
    await backend.sendPrompt('thread_1', 'follow-up prompt');

    expect(startReview).not.toHaveBeenCalled();
    expect(sendPrompt).toHaveBeenCalledWith('follow-up prompt');
  });

  it('falls back to the prompt path when native review is unavailable', async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const startReview = vi.fn(async () => ({
      ok: false,
      errorCode: 'unsupported_session_runtime_method' as const,
      error: 'unsupported_session_runtime_method:review/start',
    }));
    createCodexAppServerRuntimeMock.mockReturnValueOnce({
      startOrLoad: async () => undefined,
      getSessionId: () => 'thread_1',
      sendPrompt,
      startReview,
      compactContext: async () => undefined,
      cancel: async () => undefined,
      reset: async () => undefined,
    });

    const { createCodexAppServerExecutionRunBackend } = await import('./createCodexAppServerExecutionRunBackend');
    const backend = createCodexAppServerExecutionRunBackend({
      cwd: '/tmp/happier-worktree',
      env: {},
      permissionMode: 'read-only' as any,
      permissionHandler: null,
      start: {
        intent: 'review',
        intentInput: {
          engineIds: ['codex'],
          changeType: 'uncommitted',
          base: { kind: 'none' },
        },
      },
    });

    await backend.startSession();
    await backend.sendPrompt('thread_1', 'prompt fallback text');

    expect(startReview).toHaveBeenCalledTimes(1);
    expect(sendPrompt).toHaveBeenCalledWith('prompt fallback text');
  });

  it('fails clearly when review input is invalid', async () => {
    const sendPrompt = vi.fn(async () => undefined);
    const startReview = vi.fn(async () => undefined);
    createCodexAppServerRuntimeMock.mockReturnValueOnce({
      startOrLoad: async () => undefined,
      getSessionId: () => 'thread_1',
      sendPrompt,
      startReview,
      compactContext: async () => undefined,
      cancel: async () => undefined,
      reset: async () => undefined,
    });

    const { createCodexAppServerExecutionRunBackend } = await import('./createCodexAppServerExecutionRunBackend');
    const backend = createCodexAppServerExecutionRunBackend({
      cwd: '/tmp/happier-worktree',
      env: {},
      permissionMode: 'read-only' as any,
      permissionHandler: null,
      start: {
        intent: 'review',
        intentInput: {
          engineIds: [],
          changeType: 'uncommitted',
          base: { kind: 'none' },
        },
      },
    });

    await backend.startSession();
    await expect(backend.sendPrompt('thread_1', 'prompt fallback text')).rejects.toThrow(/Invalid review input/);

    expect(startReview).not.toHaveBeenCalled();
    expect(sendPrompt).not.toHaveBeenCalled();
  });
});
