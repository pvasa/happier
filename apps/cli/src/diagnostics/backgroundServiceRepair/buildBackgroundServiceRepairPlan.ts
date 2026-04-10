import type { PublicReleaseRingId } from '@happier-dev/release-runtime/releaseRings';

import type { DaemonServiceListEntry } from '@/daemon/service/cli';
import type { DaemonServiceMode } from '@/daemon/service/plan';

import type { BackgroundServiceRepairAction, BackgroundServiceRepairPlan } from './types';

function isCompatibleDefaultService(params: Readonly<{
  service: DaemonServiceListEntry;
  currentReleaseChannel: PublicReleaseRingId;
}>): boolean {
  return params.service.targetMode === 'default-following' && params.service.releaseChannel === params.currentReleaseChannel;
}

export function buildBackgroundServiceRepairPlan(params: Readonly<{
  currentReleaseChannel: PublicReleaseRingId;
  preferredMode: DaemonServiceMode;
  services: readonly DaemonServiceListEntry[];
}>): BackgroundServiceRepairPlan {
  const compatibleDefaultServices = params.services.filter((service) => isCompatibleDefaultService({
    service,
    currentReleaseChannel: params.currentReleaseChannel,
  }));
  const compatibleDefaultService = compatibleDefaultServices.find((service) => service.mode === params.preferredMode)
    ?? compatibleDefaultServices[0]
    ?? null;

  const actions: BackgroundServiceRepairAction[] = [];
  const removableServices = compatibleDefaultService
    ? params.services.filter((service) => service !== compatibleDefaultService)
    : [...params.services];

  for (const service of removableServices) {
    actions.push({
      kind: 'remove-service',
      service: {
        label: service.label,
        mode: service.mode === 'system' ? 'system' : 'user',
        releaseChannel: service.releaseChannel,
        targetMode: service.targetMode,
        instanceId: service.serverId,
      },
    });
  }

  if (!compatibleDefaultService && params.services.length > 0) {
    actions.push({
      kind: 'install-default-following-service',
      releaseChannel: params.currentReleaseChannel,
      mode: params.preferredMode,
    });
  }

  return {
    currentReleaseChannel: params.currentReleaseChannel,
    existingServices: [...params.services],
    actions,
    manualWarnings: [],
  };
}
