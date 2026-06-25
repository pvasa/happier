import type { SpawnSessionOptions } from '@/rpc/handlers/registerSessionHandlers';
import { getDirectSessionProviderOps } from '@/backends/catalog';
import {
  hasConnectedServiceBindings,
  mergeConnectedServiceRuntimeSnapshots,
  readConnectedServiceRuntimeSnapshot,
  type ConnectedServiceRuntimeSnapshot,
} from '@/daemon/connectedServices/connectedServiceRuntimeSnapshot';
import { listSessionMarkers, type DaemonSessionMarker } from '@/daemon/sessionRegistry';
import type { LoadedLinkedDirectSession } from './loadLinkedDirectSession';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (value === null) return null;
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

function resolveMarkerProviderId(marker: DaemonSessionMarker): LoadedLinkedDirectSession['providerId'] | null {
  const metadata = readRecord(marker.metadata);
  const metadataFlavor = normalizeNullableString(metadata?.flavor);
  if (metadataFlavor === 'claude' || metadataFlavor === 'codex' || metadataFlavor === 'opencode') {
    return metadataFlavor;
  }
  if (marker.flavor === 'claude' || marker.flavor === 'codex' || marker.flavor === 'opencode') {
    return marker.flavor;
  }
  const respawn = readRecord(marker.respawn);
  const backendTarget = readRecord(respawn?.backendTarget);
  const agentId = normalizeNullableString(backendTarget?.agentId);
  return agentId === 'claude' || agentId === 'codex' || agentId === 'opencode' ? agentId : null;
}

function resolveMetadataRemoteSessionId(
  metadata: Readonly<Record<string, unknown>> | null,
  providerId: LoadedLinkedDirectSession['providerId'],
): string | null {
  if (!metadata) return null;
  const directSession = readRecord(metadata.directSessionV1);
  if (directSession?.providerId === providerId) {
    const directRemoteSessionId = normalizeNullableString(directSession.remoteSessionId);
    if (directRemoteSessionId) return directRemoteSessionId;
  }
  if (providerId === 'codex') return normalizeNullableString(metadata.codexSessionId);
  if (providerId === 'claude') return normalizeNullableString(metadata.claudeSessionId);
  if (providerId === 'opencode') return normalizeNullableString(metadata.opencodeSessionId);
  return null;
}

function markerMatchesDirectSession(
  marker: DaemonSessionMarker,
  linked: LoadedLinkedDirectSession,
): boolean {
  if (resolveMarkerProviderId(marker) !== linked.providerId) return false;
  const respawn = readRecord(marker.respawn);
  const markerRemoteSessionId =
    normalizeNullableString(respawn?.resume)
    ?? resolveMetadataRemoteSessionId(readRecord(marker.metadata), linked.providerId);
  return markerRemoteSessionId === linked.remoteSessionId;
}

async function resolveTrackedConnectedServiceRuntimeSnapshot(
  linked: LoadedLinkedDirectSession,
): Promise<ConnectedServiceRuntimeSnapshot> {
  const markers = await listSessionMarkers().catch(() => [] as DaemonSessionMarker[]);
  const matches = markers
    .filter((marker) => markerMatchesDirectSession(marker, linked))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  for (const marker of matches) {
    const snapshot = mergeConnectedServiceRuntimeSnapshots(
      readConnectedServiceRuntimeSnapshot(marker.respawn),
      readConnectedServiceRuntimeSnapshot(marker.metadata),
    );
    if (hasConnectedServiceBindings(snapshot)) return snapshot;
  }
  return {};
}

export async function resolveDirectTakeoverSpawnOptions(params: Readonly<{
  linked: LoadedLinkedDirectSession;
  sessionId: string;
}>): Promise<SpawnSessionOptions | null> {
  const spawnOptions = await (await getDirectSessionProviderOps(params.linked.providerId)).resolveTakeoverSpawnOptions(params);
  if (!spawnOptions) return null;
  const snapshot = mergeConnectedServiceRuntimeSnapshots(
    readConnectedServiceRuntimeSnapshot(params.linked.metadata),
    await resolveTrackedConnectedServiceRuntimeSnapshot(params.linked),
  );
  return hasConnectedServiceBindings(snapshot)
    ? { ...spawnOptions, ...snapshot }
    : spawnOptions;
}
