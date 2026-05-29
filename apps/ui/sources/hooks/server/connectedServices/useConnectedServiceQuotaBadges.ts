import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { computeConnectedServiceQuotaSummaryBadges } from '@/sync/domains/connectedServices/connectedServiceQuotaBadges';
import { connectedServiceProfileKey } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { useSettings } from '@/sync/store/hooks';

import { ConnectedServiceIdSchema } from '@happier-dev/protocol';

import { useConnectedServiceQuotaSnapshots } from './useConnectedServiceQuotaSnapshots';

type ProfileRef = Readonly<{ serviceId: string; profileId: string }>;

export function useConnectedServiceQuotaBadges(
    profiles: ReadonlyArray<ProfileRef>,
): Record<string, Array<{ meterId: string; text: string }>> {
    const settings = useSettings();
    const quotasEnabled = useFeatureEnabled('connectedServices.quotas');

    const pinnedByKey = settings.connectedServicesQuotaPinnedMeterIdsByKey;
    const strategyByKey = settings.connectedServicesQuotaSummaryStrategyByKey;
    const requestedProfiles = quotasEnabled
        ? profiles.filter((profile) => {
            const serviceIdParsed = ConnectedServiceIdSchema.safeParse(String(profile.serviceId ?? '').trim());
            const profileId = String(profile.profileId ?? '').trim();
            if (!serviceIdParsed.success || !profileId) return false;
            return true;
        })
        : [];
    const snapshotsByKey = useConnectedServiceQuotaSnapshots(requestedProfiles);

    const badgesByKey: Record<string, Array<{ meterId: string; text: string }>> = {};
    if (!quotasEnabled) return badgesByKey;

    for (const profile of profiles) {
        const serviceIdRaw = String(profile.serviceId ?? '').trim();
        const serviceIdParsed = ConnectedServiceIdSchema.safeParse(serviceIdRaw);
        const profileId = String(profile.profileId ?? '').trim();
        if (!serviceIdParsed.success || !profileId) continue;
        const serviceId = serviceIdParsed.data;

        const key = connectedServiceProfileKey({ serviceId, profileId });
        const pinnedMeterIds = pinnedByKey[key] ?? [];
        const rawStrategy = strategyByKey[key];
        const strategy = rawStrategy === 'primary' && pinnedMeterIds.length > 0 ? 'primary' : 'min_remaining';
        badgesByKey[key] = computeConnectedServiceQuotaSummaryBadges({
            snapshot: snapshotsByKey[key] ?? null,
            pinnedMeterIds,
            strategy,
        });
    }

    return badgesByKey;
}
