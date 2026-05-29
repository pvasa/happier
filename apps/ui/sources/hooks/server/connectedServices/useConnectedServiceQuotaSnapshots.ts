import * as React from 'react';

import { useAuth } from '@/auth/context/AuthContext';
import { resolveAuthCredentialsScopeKey } from '@/auth/storage/resolveAuthCredentialsScopeKey';
import { useFeatureEnabled } from '@/hooks/server/useFeatureEnabled';
import { getConnectedServiceQuotaSnapshotSealed } from '@/sync/api/account/apiConnectedServicesQuotasV2';
import { getConnectedServiceQuotaSnapshotPlain } from '@/sync/api/account/apiConnectedServicesQuotasV3';
import { openConnectedServiceQuotaSnapshot } from '@/sync/domains/connectedServices/openConnectedServiceQuotaSnapshot';
import { connectedServiceProfileKey } from '@/sync/domains/connectedServices/connectedServiceProfilePreferences';
import { fireAndForget } from '@/utils/system/fireAndForget';

import type { ConnectedServiceQuotaSnapshotV1 } from '@happier-dev/protocol';
import { ConnectedServiceIdSchema, type ConnectedServiceId } from '@happier-dev/protocol';
import { useCredentialScopedAccountModeResolver } from './useCredentialScopedAccountModeResolver';

type ProfileRef = Readonly<{ serviceId: string; profileId: string }>;
type NormalizedProfileRef = Readonly<{
  key: string;
  serviceId: ConnectedServiceId;
  profileId: string;
}>;

const QUOTA_SNAPSHOTS_POLL_MS = 30_000;
const QUOTA_SNAPSHOTS_MISS_RETRY_MS = 30_000;
const QUOTA_SNAPSHOTS_ERROR_BACKOFF_MIN_MS = 30_000;
const QUOTA_SNAPSHOTS_ERROR_BACKOFF_MAX_MS = 5 * 60_000;

type SnapshotCacheEntry = Readonly<{
  snapshot: ConnectedServiceQuotaSnapshotV1 | null;
  nextFetchAtMs: number;
  consecutiveErrors: number;
}>;
type SnapshotCacheState = Readonly<{
  credentialScope: string;
  entries: Record<string, SnapshotCacheEntry>;
}>;

function computeErrorBackoffMs(consecutiveErrors: number): number {
  const exp = QUOTA_SNAPSHOTS_ERROR_BACKOFF_MIN_MS * Math.pow(2, Math.max(0, consecutiveErrors - 1));
  return Math.max(QUOTA_SNAPSHOTS_ERROR_BACKOFF_MIN_MS, Math.min(QUOTA_SNAPSHOTS_ERROR_BACKOFF_MAX_MS, Math.trunc(exp)));
}

function normalizeProfile(profile: ProfileRef): NormalizedProfileRef | null {
  const serviceIdRaw = String(profile.serviceId ?? '').trim();
  const serviceIdParsed = ConnectedServiceIdSchema.safeParse(serviceIdRaw);
  const profileId = String(profile.profileId ?? '').trim();
  if (!serviceIdParsed.success || !profileId) return null;
  const serviceId = serviceIdParsed.data;
  return {
    key: connectedServiceProfileKey({ serviceId, profileId }),
    serviceId,
    profileId,
  };
}

function normalizeProfiles(profiles: ReadonlyArray<ProfileRef>): NormalizedProfileRef[] {
  const seenKeys = new Set<string>();
  const normalizedProfiles: NormalizedProfileRef[] = [];
  for (const profile of profiles) {
    const normalized = normalizeProfile(profile);
    if (!normalized || seenKeys.has(normalized.key)) continue;
    seenKeys.add(normalized.key);
    normalizedProfiles.push(normalized);
  }
  return normalizedProfiles.sort((a, b) => a.key.localeCompare(b.key));
}

function buildProfilesSignature(profiles: ReadonlyArray<ProfileRef>): string {
  return normalizeProfiles(profiles)
    .map((profile) => `${profile.key}\u0000${profile.serviceId}\u0000${profile.profileId}`)
    .join('\u0001');
}

export function useConnectedServiceQuotaSnapshots(
  profiles: ReadonlyArray<ProfileRef>,
): Record<string, ConnectedServiceQuotaSnapshotV1 | null> {
  const auth = useAuth();
  const credentials = auth.credentials;
  const quotasEnabled = useFeatureEnabled('connectedServices.quotas');
  const [wakeSeq, setWakeSeq] = React.useState(0);
  const credentialScope = quotasEnabled && credentials ? resolveAuthCredentialsScopeKey(credentials) : '';

  const [cacheState, setCacheState] = React.useState<SnapshotCacheState>({
    credentialScope: '',
    entries: {},
  });
  const cacheByKey = cacheState.credentialScope === credentialScope ? cacheState.entries : {};
  const cacheStateRef = React.useRef(cacheState);
  React.useEffect(() => {
    cacheStateRef.current = cacheState;
  }, [cacheState]);

  React.useEffect(() => {
    const resetState = { credentialScope, entries: {} };
    cacheStateRef.current = resetState;
    setCacheState(resetState);
  }, [credentialScope]);
  const resolveAccountMode = useCredentialScopedAccountModeResolver({ credentials, credentialScope });

  const profilesSignature = React.useMemo(() => buildProfilesSignature(profiles), [profiles]);
  const normalizedProfiles = React.useMemo(() => normalizeProfiles(profiles), [profilesSignature]);
  const activeCredentialScopeRef = React.useRef(credentialScope);
  activeCredentialScopeRef.current = credentialScope;
  const activeControllersRef = React.useRef(new Set<AbortController>());
  const inFlightKeysRef = React.useRef(new Set<string>());

  React.useEffect(() => () => {
    activeCredentialScopeRef.current = '';
    for (const controller of activeControllersRef.current) {
      controller.abort();
    }
    activeControllersRef.current.clear();
  }, []);

  React.useEffect(() => {
    if (!quotasEnabled) return;
    if (!credentials) return;

    const now = Date.now();
    let nextWakeAtMs = Number.POSITIVE_INFINITY;
    let hasMissingCache = false;

    for (const profile of normalizedProfiles) {
      const cached = cacheByKey[profile.key];
      if (!cached) {
        hasMissingCache = true;
        continue;
      }
      nextWakeAtMs = Math.min(nextWakeAtMs, cached.nextFetchAtMs);
    }

    if (hasMissingCache) return;
    if (!Number.isFinite(nextWakeAtMs)) return;

    const delayMs = Math.max(0, nextWakeAtMs - now);
    const handle = setTimeout(() => setWakeSeq((value) => value + 1), delayMs);
    return () => clearTimeout(handle);
  }, [cacheByKey, credentials, normalizedProfiles, quotasEnabled, wakeSeq]);

  React.useEffect(() => {
    if (!quotasEnabled) return;
    if (!credentials) return;

    const now = Date.now();
    const toFetch = normalizedProfiles.filter((profile) => {
      const cacheSnapshot = cacheStateRef.current;
      const cached = cacheSnapshot.credentialScope === credentialScope
        ? cacheSnapshot.entries[profile.key]
        : undefined;
      const inFlightKey = `${credentialScope}\u0000${profile.key}`;
      return !inFlightKeysRef.current.has(inFlightKey) && (!cached || now >= cached.nextFetchAtMs);
    });
    if (toFetch.length === 0) return;

    for (const entry of toFetch) {
      inFlightKeysRef.current.add(`${credentialScope}\u0000${entry.key}`);
    }

    const controller = new AbortController();
    const requestCredentialScope = credentialScope;
    activeControllersRef.current.add(controller);
    fireAndForget((async () => {
      try {
        const mode = await resolveAccountMode();
        if (controller.signal.aborted || activeCredentialScopeRef.current !== requestCredentialScope) return;
        await Promise.all(toFetch.map(async (entry) => {
          try {
            let opened: ConnectedServiceQuotaSnapshotV1 | null = null;
            if (mode === 'plain') {
              opened = await getConnectedServiceQuotaSnapshotPlain(credentials, {
                serviceId: entry.serviceId,
                profileId: entry.profileId,
              }, { signal: controller.signal });
            }
            if (controller.signal.aborted || activeCredentialScopeRef.current !== requestCredentialScope) return;
            if (!opened) {
              const sealed = await getConnectedServiceQuotaSnapshotSealed(credentials, {
                serviceId: entry.serviceId,
                profileId: entry.profileId,
              }, { signal: controller.signal });
              opened = sealed ? openConnectedServiceQuotaSnapshot(credentials, sealed.sealed) : null;
            }
            if (controller.signal.aborted || activeCredentialScopeRef.current !== requestCredentialScope) return;
            setCacheState((prev) => {
              const entries = prev.credentialScope === requestCredentialScope ? prev.entries : {};
              return {
                credentialScope: requestCredentialScope,
                entries: {
                  ...entries,
                  [entry.key]: {
                    snapshot: opened,
                    nextFetchAtMs: opened
                      ? now + Math.max(QUOTA_SNAPSHOTS_POLL_MS, Math.trunc(opened.staleAfterMs ?? QUOTA_SNAPSHOTS_POLL_MS))
                      : now + QUOTA_SNAPSHOTS_MISS_RETRY_MS,
                    consecutiveErrors: 0,
                  },
                },
              };
            });
          } catch {
            if (controller.signal.aborted || activeCredentialScopeRef.current !== requestCredentialScope) return;
            setCacheState((prev) => {
              const entries = prev.credentialScope === requestCredentialScope ? prev.entries : {};
              const existing = entries[entry.key];
              const consecutiveErrors = (existing?.consecutiveErrors ?? 0) + 1;
              return {
                credentialScope: requestCredentialScope,
                entries: {
                  ...entries,
                  [entry.key]: {
                    snapshot: existing?.snapshot ?? null,
                    nextFetchAtMs: now + computeErrorBackoffMs(consecutiveErrors),
                    consecutiveErrors,
                  },
                },
              };
            });
          } finally {
            inFlightKeysRef.current.delete(`${requestCredentialScope}\u0000${entry.key}`);
          }
        }));
      } finally {
        activeControllersRef.current.delete(controller);
      }
    })(), { tag: 'useConnectedServiceQuotaSnapshots.refresh' });

    return () => {
      if (activeCredentialScopeRef.current !== requestCredentialScope) {
        controller.abort();
      }
    };
  }, [credentialScope, quotasEnabled, credentials, normalizedProfiles, wakeSeq, resolveAccountMode]);

  const snapshotsByKey: Record<string, ConnectedServiceQuotaSnapshotV1 | null> = {};
  if (!quotasEnabled) return snapshotsByKey;

  for (const profile of normalizedProfiles) {
    snapshotsByKey[profile.key] = cacheByKey[profile.key]?.snapshot ?? null;
  }

  return snapshotsByKey;
}
