import { inferAgentIdFromSessionMetadata } from '@happier-dev/agents';
import {
  ConnectedServiceBindingsV1Schema,
  ConnectedServiceMaterializationIdentityV1Schema,
  type ConnectedServiceBindingsV1,
  type ConnectedServiceMaterializationIdentityV1,
} from '@happier-dev/protocol';

import { resolveCatalogAgentId } from '@/backends/catalog';
import type { CatalogAgentId } from '@/backends/types';
import type { Credentials } from '@/persistence';
import { resolveExistingSessionAttachContext } from '@/daemon/sessionEncryption/resolveExistingSessionAttachContext';

type ResolveExistingSessionAttachContext = typeof resolveExistingSessionAttachContext;

function readConnectedServiceBindingsOrEmpty(raw: unknown): ConnectedServiceBindingsV1 {
  const parsed = ConnectedServiceBindingsV1Schema.safeParse(raw);
  return parsed.success ? parsed.data : { v: 1, bindingsByServiceId: {} };
}

function readConnectedServiceMaterializationIdentity(
  raw: unknown,
): ConnectedServiceMaterializationIdentityV1 | null {
  const parsed = ConnectedServiceMaterializationIdentityV1Schema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export async function resolveInactiveConnectedServiceSessionForAuthSwitch(params: Readonly<{
  credentials: Credentials;
  sessionId: string;
  agentId: CatalogAgentId;
  resolveAttachContext?: ResolveExistingSessionAttachContext;
}>): Promise<Readonly<{
  agentId: CatalogAgentId;
  connectedServices: ConnectedServiceBindingsV1;
  connectedServiceMaterializationIdentityV1?: ConnectedServiceMaterializationIdentityV1 | null;
  vendorResumeId?: string | null;
}> | null> {
  const token = typeof params.credentials.token === 'string' ? params.credentials.token.trim() : '';
  if (!token) return null;

  const resolver = params.resolveAttachContext ?? resolveExistingSessionAttachContext;
  const attachContext = await resolver({
    token,
    sessionId: params.sessionId,
    agent: params.agentId,
    credentials: params.credentials,
  }).catch(() => null);
  if (!attachContext?.ok) return null;

  const metadata = attachContext.metadata;
  if (!metadata) return null;
  const inferredAgentId = inferAgentIdFromSessionMetadata(metadata, params.agentId);
  const materializationIdentity = readConnectedServiceMaterializationIdentity(
    metadata.connectedServiceMaterializationIdentityV1,
  );
  return {
    agentId: resolveCatalogAgentId(inferredAgentId),
    connectedServices: readConnectedServiceBindingsOrEmpty(metadata.connectedServices),
    ...(materializationIdentity ? { connectedServiceMaterializationIdentityV1: materializationIdentity } : {}),
    ...(typeof attachContext.vendorResumeId === 'string' && attachContext.vendorResumeId.trim()
      ? { vendorResumeId: attachContext.vendorResumeId.trim() }
      : {}),
  };
}
