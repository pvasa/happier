import { describe, expect, it, vi } from 'vitest';

import { createPermissionHandlerSessionStub } from '../../utils/permissionHandler.testkit';
import { createFakeControlPort } from '../tuiControls/fakeControlPort';
import { parseClaudeScreenState } from '../tuiControls/screenState';
import { CLAUDE_UNIFIED_RESUME_CHOICE_QUESTION, ClaudeUnifiedResumeChoiceBroker } from './claudeUnifiedResumeChoiceBroker';
import { createClaudeUnifiedResumeChoiceStartupResolver } from './claudeUnifiedResumeChoiceStartupResolver';

const RESUME_DIALOG = [
  'This session is 18h 2m old and 560.4k tokens.',
  'To reduce startup time, Claude can resume from the saved summary or load the full session.',
  '',
  '❯ 1. Resume from summary',
  '  2. Resume full session',
].join('\n');

const IDLE = [
  '──────────────────────────────',
  '❯ ',
  '──────────────────────────────',
].join('\n');

describe('createClaudeUnifiedResumeChoiceStartupResolver', () => {
  it('auto-answers resume-from-summary through terminal control', async () => {
    const { session } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session);
    const port = createFakeControlPort({ captures: [RESUME_DIALOG, IDLE] });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'resume_from_summary',
      broker,
      port,
      wait: async () => undefined,
      settleMs: 1,
    });

    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'handled' });

    expect(port.sentLiteral).toEqual(['1']);
    expect(port.sentKeys).toEqual(['Enter']);
  });

  it('auto-answers full-session resume through terminal control', async () => {
    const { session } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session);
    const port = createFakeControlPort({ captures: [RESUME_DIALOG, IDLE] });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'resume_full_session',
      broker,
      port,
      wait: async () => undefined,
      settleMs: 1,
    });

    await resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    });

    expect(port.sentLiteral).toEqual(['2']);
    expect(port.sentKeys).toEqual(['Enter']);
  });

  it('does not repeatedly send an auto-answer after a terminal control failure', async () => {
    const { session } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session);
    const port = createFakeControlPort({
      captures: [RESUME_DIALOG, RESUME_DIALOG, RESUME_DIALOG],
    });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'resume_full_session',
      broker,
      port,
      wait: async () => undefined,
      settleMs: 1,
    });

    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'unhandled' });
    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 2,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'unhandled' });

    expect(port.sentLiteral).toEqual(['2']);
    expect(port.sentKeys).toEqual(['Enter']);
  });

  it('asks the user once and sends the selected answer after the existing user-action RPC resolves', async () => {
    const { session, client } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session, { createRequestId: () => 'claude_resume_choice_1' });
    broker.activate();
    const port = createFakeControlPort({ captures: [RESUME_DIALOG, IDLE] });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'ask_every_time',
      broker,
      port,
      wait: async () => undefined,
      settleMs: 1,
    });

    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'waiting_for_user' });
    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 2,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'waiting_for_user' });

    expect(Object.keys(client.getAgentStateSnapshot().requests)).toEqual(['claude_resume_choice_1']);

    await client.rpcHandlerManager.getHandler('permission')?.({
      id: 'claude_resume_choice_1',
      approved: true,
      answers: { [CLAUDE_UNIFIED_RESUME_CHOICE_QUESTION]: 'Resume from summary' },
    });

    await vi.waitFor(() => {
      expect(port.sentLiteral).toEqual(['1']);
      expect(port.sentKeys).toEqual(['Enter']);
    });
  });

  it('keeps startup timeout paused while an answered ask-every-time choice is still being typed', async () => {
    const { session, client } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session, { createRequestId: () => 'claude_resume_choice_1' });
    broker.activate();
    const port = createFakeControlPort({ captures: [RESUME_DIALOG, IDLE] });
    let releaseSettle!: () => void;
    const settleStarted = vi.fn();
    const settlePromise = new Promise<void>((resolve) => {
      releaseSettle = resolve;
    });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'ask_every_time',
      broker,
      port,
      wait: async () => {
        settleStarted();
        await settlePromise;
      },
      settleMs: 1,
    });

    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'waiting_for_user' });

    await client.rpcHandlerManager.getHandler('permission')?.({
      id: 'claude_resume_choice_1',
      approved: true,
      answers: { [CLAUDE_UNIFIED_RESUME_CHOICE_QUESTION]: 'Resume from summary' },
    });

    await vi.waitFor(() => {
      expect(settleStarted).toHaveBeenCalledTimes(1);
    });
    expect(broker.hasPendingChoice()).toBe(false);
    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 2,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'waiting_for_user' });

    releaseSettle();
    await vi.waitFor(() => {
      expect(port.sentLiteral).toEqual(['1']);
      expect(port.sentKeys).toEqual(['Enter']);
    });
  });

  it('does not publish a new user action after the user cancels the resume choice', async () => {
    const { session, client } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session, {
      createRequestId: vi.fn()
        .mockReturnValueOnce('claude_resume_choice_1')
        .mockReturnValueOnce('claude_resume_choice_2'),
    });
    broker.activate();
    const port = createFakeControlPort({ captures: [RESUME_DIALOG] });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'ask_every_time',
      broker,
      port,
      wait: async () => undefined,
      settleMs: 1,
    });

    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'waiting_for_user' });

    await client.rpcHandlerManager.getHandler('permission')?.({
      id: 'claude_resume_choice_1',
      approved: false,
      reason: 'user_canceled_resume_choice',
    });
    await vi.waitFor(() => {
      expect(broker.hasPendingChoice()).toBe(false);
    });
    await Promise.resolve();
    await Promise.resolve();

    await expect(resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 2,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'unhandled' });

    expect(Object.keys(client.getAgentStateSnapshot().requests)).toEqual([]);
    expect(client.getAgentStateSnapshot().completedRequests.claude_resume_choice_1).toMatchObject({
      status: 'canceled',
      reason: 'user_canceled_resume_choice',
    });
    expect(client.getAgentStateSnapshot().completedRequests.claude_resume_choice_2).toBeUndefined();
    expect(port.sentLiteral).toEqual([]);
    expect(port.sentKeys).toEqual([]);
  });

  it('cancels the pending user action if the dialog disappears before the user answers', async () => {
    const { session, client } = createPermissionHandlerSessionStub('resume-choice-session');
    const broker = new ClaudeUnifiedResumeChoiceBroker(session, { createRequestId: () => 'claude_resume_choice_1' });
    broker.activate();
    const port = createFakeControlPort({ captures: [IDLE] });
    const resolver = createClaudeUnifiedResumeChoiceStartupResolver({
      choice: 'ask_every_time',
      broker,
      port,
      wait: async () => undefined,
      settleMs: 1,
    });

    await resolver({
      screenState: parseClaudeScreenState(RESUME_DIALOG),
      observedAtMs: 1,
      abortSignal: new AbortController().signal,
    });
    await expect(resolver({
      screenState: parseClaudeScreenState(IDLE),
      observedAtMs: 2,
      abortSignal: new AbortController().signal,
    })).resolves.toEqual({ status: 'handled' });

    expect(port.sentLiteral).toEqual([]);
    expect(client.getAgentStateSnapshot().completedRequests.claude_resume_choice_1).toMatchObject({
      status: 'canceled',
      reason: 'resume_dialog_resolved_in_terminal',
    });
  });
});
