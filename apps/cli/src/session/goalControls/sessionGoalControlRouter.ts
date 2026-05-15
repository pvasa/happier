import {
  inferAgentIdFromSessionMetadata,
  type AgentId,
} from '@happier-dev/agents';
import type { SessionGoalSetRequestV1 } from '@happier-dev/protocol';

import { getSessionGoalControlAdapter } from '@/backends/catalog';
import type { Credentials } from '@/persistence';
import type {
  SessionEncryptionContext,
  SessionStoredContentEncryptionMode,
} from '@/session/transport/encryption/sessionEncryptionContext';
import { updateSessionMetadataWithRetry } from '@/session/metadata/updateSessionMetadataWithRetry';
import type { RawSessionRecord } from '@/session/transport/http/sessionsHttp';
import type {
  ResolveSessionGoalControlAdapter,
  SessionGoalControlAdapterParams,
  SessionGoalControlOperation,
} from './sessionGoalControlTypes';

type RouteSessionGoalControlParams = Readonly<{
  token: string;
  credentials?: Credentials;
  sessionId: string;
  rawSession: RawSessionRecord;
  metadata: Record<string, unknown> | null;
  currentMachineId: string | null;
  ctx: SessionEncryptionContext;
  mode: SessionStoredContentEncryptionMode;
  operation: SessionGoalControlOperation;
  request?: SessionGoalSetRequestV1;
  callLiveSessionRpc: () => Promise<unknown>;
  resolveAdapter?: ResolveSessionGoalControlAdapter;
}>;

function stableError(errorCode: string): Readonly<{ ok: false; errorCode: string; error: string }> {
  return { ok: false, errorCode, error: errorCode };
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveRawSessionString(rawSession: RawSessionRecord, key: 'path' | 'machineId'): string | null {
  return readString((rawSession as Partial<Record<typeof key, unknown>>)[key]);
}

function resolveAgentId(metadata: Record<string, unknown>): AgentId | null {
  return inferAgentIdFromSessionMetadata(metadata);
}

function buildAdapterParams(
  params: RouteSessionGoalControlParams,
  metadata: Record<string, unknown>,
  sessionMachineId: string,
): SessionGoalControlAdapterParams {
  return {
    token: params.token,
    ...(params.credentials ? { credentials: params.credentials } : {}),
    sessionId: params.sessionId,
    rawSession: params.rawSession,
    metadata,
    currentMachineId: params.currentMachineId,
    sessionMachineId,
    cwd: resolveRawSessionString(params.rawSession, 'path') ?? readString(metadata.path),
    ctx: params.ctx,
    mode: params.mode,
  };
}

function readMetadataResult(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const metadata = (value as { metadata?: unknown }).metadata;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  return metadata as Record<string, unknown>;
}

async function persistAdapterMetadataResult(
  params: RouteSessionGoalControlParams,
  result: unknown,
): Promise<unknown> {
  const nextMetadata = readMetadataResult(result);
  if (!nextMetadata || !params.credentials) return result;

  const persisted = await updateSessionMetadataWithRetry({
    token: params.token,
    credentials: params.credentials,
    sessionId: params.sessionId,
    rawSession: params.rawSession,
    updater: (currentMetadata) => ({
      ...currentMetadata,
      ...nextMetadata,
    }),
  });

  return {
    ...(result as Record<string, unknown>),
    metadata: persisted.metadata,
  };
}

export async function routeSessionGoalControl(params: RouteSessionGoalControlParams): Promise<unknown> {
  if (params.rawSession.active === true) {
    return await params.callLiveSessionRpc();
  }

  const metadata = params.metadata;
  if (!metadata) {
    return stableError('session_goal_control_metadata_unavailable');
  }

  const currentMachineId = readString(params.currentMachineId);
  if (!currentMachineId) {
    return stableError('session_goal_control_current_machine_unknown');
  }

  const sessionMachineId = readString(metadata.machineId) ?? resolveRawSessionString(params.rawSession, 'machineId');
  if (!sessionMachineId) {
    return stableError('session_goal_control_session_machine_unknown');
  }
  if (sessionMachineId !== currentMachineId) {
    return stableError('session_goal_control_remote_unavailable');
  }

  const agentId = resolveAgentId(metadata);
  const resolveAdapter = params.resolveAdapter ?? getSessionGoalControlAdapter;
  const adapter = await resolveAdapter(agentId);
  if (!adapter) {
    return stableError('session_goal_control_unsupported');
  }

  const adapterParams = buildAdapterParams(params, metadata, sessionMachineId);
  let result: unknown;
  if (params.operation === 'get') {
    result = typeof adapter.getGoal === 'function'
      ? await adapter.getGoal(adapterParams)
      : stableError('session_goal_control_unsupported');
    return await persistAdapterMetadataResult(params, result);
  }
  if (params.operation === 'clear') {
    result = typeof adapter.clearGoal === 'function'
      ? await adapter.clearGoal(adapterParams)
      : stableError('session_goal_control_unsupported');
    return await persistAdapterMetadataResult(params, result);
  }
  if (!params.request || typeof adapter.setGoal !== 'function') {
    return stableError('session_goal_control_unsupported');
  }
  result = await adapter.setGoal({
    ...adapterParams,
    request: params.request,
  });
  return await persistAdapterMetadataResult(params, result);
}
