import { describe, expect, it, vi } from 'vitest';

import {
  recordPrimaryTurnCompleted,
  recordPrimaryTurnInProgress,
  surfacePrimarySessionRuntimeIssue,
} from './surfacePrimarySessionRuntimeIssue';

describe('surfacePrimarySessionRuntimeIssue', () => {
  it('surfaces provider failures as failed primary turn runtime issues', async () => {
    const sendAgentMessage = vi.fn();
    const updatePrimaryTurnRuntimeState = vi.fn();

    const issue = await surfacePrimarySessionRuntimeIssue({
      provider: 'codex',
      providerTurnId: 'turn_1',
      sessionSeq: 7,
      occurredAt: 123,
      cause: 'status_error',
      error: new Error('401 raw token should not be stored'),
      session: { sendAgentMessage, updatePrimaryTurnRuntimeState },
    });

    expect(issue).toMatchObject({
      v: 1,
      scope: 'primary_session',
      status: 'failed',
      code: 'auth_error',
      source: 'auth_error',
      occurredAt: 123,
      sessionSeq: 7,
      provider: 'codex',
      providerTurnId: 'turn_1',
      sanitizedPreview: 'Authentication failed',
    });
    expect(JSON.stringify(issue)).not.toContain('raw token');
    expect(sendAgentMessage).toHaveBeenCalledWith('codex', expect.objectContaining({ type: 'turn_failed' }));
    expect(updatePrimaryTurnRuntimeState).toHaveBeenCalledWith({
      latestTurnStatus: 'failed',
      lastRuntimeIssue: issue,
    });
  });

  it('surfaces cancellation as cancelled primary turn state without a runtime issue', async () => {
    const sendAgentMessage = vi.fn();
    const updatePrimaryTurnRuntimeState = vi.fn();

    const issue = await surfacePrimarySessionRuntimeIssue({
      provider: 'claude',
      cause: 'cancelled',
      session: { sendAgentMessage, updatePrimaryTurnRuntimeState },
    });

    expect(issue).toBeNull();
    expect(sendAgentMessage).toHaveBeenCalledWith('claude', expect.objectContaining({ type: 'turn_cancelled' }));
    expect(updatePrimaryTurnRuntimeState).toHaveBeenCalledWith({
      latestTurnStatus: 'cancelled',
      lastRuntimeIssue: null,
    });
  });

  it('records in-progress and completed primary turn states', async () => {
    const updatePrimaryTurnRuntimeState = vi.fn();

    await recordPrimaryTurnInProgress({ session: { updatePrimaryTurnRuntimeState } });
    await recordPrimaryTurnCompleted({ session: { updatePrimaryTurnRuntimeState } });

    expect(updatePrimaryTurnRuntimeState).toHaveBeenNthCalledWith(1, {
      latestTurnStatus: 'in_progress',
    });
    expect(updatePrimaryTurnRuntimeState).toHaveBeenNthCalledWith(2, {
      latestTurnStatus: 'completed',
    });
  });
});
