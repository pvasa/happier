import type { TrackedSession } from '@/daemon/types';

type TrackedConnectedServiceBindingSource = Pick<
  TrackedSession,
  'happySessionMetadataFromLocalWebhook' | 'spawnOptions'
>;

export function resolveTrackedConnectedServiceBindingsRaw(
  tracked: TrackedConnectedServiceBindingSource,
): unknown {
  return tracked.spawnOptions?.connectedServices ?? tracked.happySessionMetadataFromLocalWebhook?.connectedServices;
}
