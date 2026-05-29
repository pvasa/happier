import type {
  ConnectedServiceId,
  ConnectedServiceQuotaSnapshotV1,
} from '@happier-dev/protocol';

import type { TrackedSession } from '@/daemon/types';

import type { ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore } from '../accountGroups/quotas/ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore';
import { parseConnectedServiceBindingSelections } from '../parseConnectedServicesBindings';
import type { ConnectedServiceQuotasCoordinator } from './ConnectedServiceQuotasCoordinator';

type QuotaCoordinatorLike = Pick<ConnectedServiceQuotasCoordinator, 'recordInBandQuotaSnapshot'>;

function normalizeSessionId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function findTrackedSession(
  children: ReadonlyArray<TrackedSession>,
  sessionId: string,
): TrackedSession | null {
  const normalized = normalizeSessionId(sessionId);
  if (!normalized) return null;
  return children.find((child) => normalizeSessionId(child.happySessionId) === normalized) ?? null;
}

export async function recordConnectedServiceRuntimeQuotaSnapshotForSession(input: Readonly<{
  getChildren: () => ReadonlyArray<TrackedSession>;
  quotaCoordinator: QuotaCoordinatorLike | null;
  runtimeQuotaSnapshots: ConnectedServiceAuthGroupRuntimeQuotaSnapshotStore;
  sessionId: string;
  serviceId: ConnectedServiceId;
  snapshot: ConnectedServiceQuotaSnapshotV1;
}>): Promise<
  | Readonly<{ status: 'recorded'; groupRuntimeStateRecorded: boolean; quotaStateRecorded: boolean }>
  | Readonly<{ status: 'session_not_found' }>
  | Readonly<{ status: 'not_connected_selection' }>
> {
  const tracked = findTrackedSession(input.getChildren(), input.sessionId);
  if (!tracked) return { status: 'session_not_found' };
  const selection = parseConnectedServiceBindingSelections(tracked.spawnOptions?.connectedServices)
    .find((candidate) => candidate.serviceId === input.serviceId) ?? null;
  if (!selection) return { status: 'not_connected_selection' };

  const groupRuntimeStateRecorded = selection.kind === 'group';
  if (groupRuntimeStateRecorded) {
    input.runtimeQuotaSnapshots.recordSnapshot({
      serviceId: input.serviceId,
      groupId: selection.groupId,
      profileId: input.snapshot.profileId,
      snapshot: input.snapshot,
    });
  }

  let quotaStateRecorded = false;
  if (input.quotaCoordinator) {
    try {
      const persistence = await input.quotaCoordinator.recordInBandQuotaSnapshot({
        serviceId: input.serviceId,
        profileId: input.snapshot.profileId,
        snapshot: input.snapshot,
      });
      quotaStateRecorded = persistence.status !== 'deferred_unknown_mode';
    } catch {
      quotaStateRecorded = false;
    }
  }

  return { status: 'recorded', groupRuntimeStateRecorded, quotaStateRecorded };
}
