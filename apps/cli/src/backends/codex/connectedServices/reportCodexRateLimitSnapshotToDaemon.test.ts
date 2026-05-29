import { describe, expect, it, vi } from 'vitest';

import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import { reportCodexRateLimitSnapshotToDaemon } from './reportCodexRateLimitSnapshotToDaemon';

describe('reportCodexRateLimitSnapshotToDaemon', () => {
  it('reports app-server rate-limit snapshots for the active connected-service group member', async () => {
    const notify = vi.fn(async () => ({ ok: true }));

    await reportCodexRateLimitSnapshotToDaemon({
      env: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'main',
          activeProfileId: 'backup',
          fallbackProfileId: 'primary',
          generation: 2,
        }]),
      },
      sessionId: 'sess_1',
      rawSnapshot: {
        plan_type: 'pro',
        primary: { used_percent: 88, resets_at: '2026-05-17T12:00:00.000Z' },
      },
      nowMs: 1_000,
      notify,
    });

    expect(notify).toHaveBeenCalledWith({
      sessionId: 'sess_1',
      serviceId: 'openai-codex',
      snapshot: expect.objectContaining({
        serviceId: 'openai-codex',
        profileId: 'backup',
        fetchedAt: 1_000,
        planLabel: 'pro',
      }),
    });
  });

  it('does not report snapshots when the session did not select OpenAI Codex connected auth', async () => {
    const notify = vi.fn(async () => ({ ok: true }));

    await reportCodexRateLimitSnapshotToDaemon({
      env: {},
      sessionId: 'sess_1',
      rawSnapshot: { primary: { used_percent: 88 } },
      nowMs: 1_000,
      notify,
    });

    expect(notify).not.toHaveBeenCalled();
  });
});
