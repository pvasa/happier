import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';

import { findConnectedServiceChildSelection } from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import { notifyDaemonConnectedServiceQuotaSnapshot } from '@/daemon/controlClient';
import { mapCodexRateLimitSnapshotToQuotaSnapshot } from './mapCodexRateLimitSnapshot';

type NotifyQuotaSnapshot = (body: Readonly<{
  sessionId: string;
  serviceId: 'openai-codex';
  snapshot: ConnectedServiceQuotaSnapshotV1;
}>) => Promise<unknown>;

export async function reportCodexRateLimitSnapshotToDaemon(input: Readonly<{
  env: Pick<NodeJS.ProcessEnv, string>;
  sessionId: string;
  rawSnapshot: unknown;
  nowMs?: number;
  notify?: NotifyQuotaSnapshot;
}>): Promise<void> {
  const selection = findConnectedServiceChildSelection(input.env, 'openai-codex');
  if (!selection) return;

  const profileId = selection.kind === 'group' ? selection.activeProfileId : selection.profileId;
  const snapshot = mapCodexRateLimitSnapshotToQuotaSnapshot({
    serviceId: 'openai-codex',
    profileId,
    fetchedAt: input.nowMs ?? Date.now(),
    rawSnapshot: input.rawSnapshot,
  });
  await (input.notify ?? notifyDaemonConnectedServiceQuotaSnapshot)({
    sessionId: input.sessionId,
    serviceId: 'openai-codex',
    snapshot,
  });
}
