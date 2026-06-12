import type { Metadata } from '@/api/types';
import { updateMetadataBestEffort } from '@/api/session/sessionWritesBestEffort';
import { mergeSessionWorkStateMetadataV1 } from '@/session/workState/sessionWorkStateMetadata';
import { logger } from '@/ui/logger';

import type { Session } from '../session';
import type { RawJSONLines } from '../types';
import { createClaudeRawMessageTurnDiffBridge } from '../utils/createClaudeRawMessageTurnDiffBridge';
import { isClaudeInternalTranscriptMessage } from '../utils/isClaudeInternalTranscriptMessage';
import { buildClaudeTodoWriteWorkState, createClaudeTaskToolWorkStateTracker } from '../workState/claudeWorkState';
import { mapClaudeRateLimitEventToUsageDetails, type NormalizedProviderUsageLimitDetailsV1 } from '../connectedServices/mapClaudeRateLimitEventToUsageDetails';
import { surfaceClaudeRateLimitRuntimeIssue } from '../connectedServices/surfaceClaudeRuntimeIssues';
import {
  buildClaudeCompactionCompletedEvent,
  buildClaudeCompactionLifecycleId,
  buildClaudeCompactionStartedEvent,
} from '../contextCompactionEvents';
import { buildClaudeSessionModelsMetadataWithCurrentModelId } from '../remote/buildClaudeSessionModelsMetadataFromSupportedModels';

type ClaudeLocalWorkStateSnapshot = ReturnType<typeof buildClaudeTodoWriteWorkState>
  & Readonly<{ ownedSourceFamilies?: readonly string[] }>;

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

type CompactCommandMarkerKind = 'local-command' | 'plain';

function readCompactCommandMarkerKind(message: RawJSONLines): CompactCommandMarkerKind | null {
  const record = message as Record<string, unknown>;
  const nested = readRecord(record.message);
  const content = nested?.content;
  const texts = typeof content === 'string'
    ? [content]
    : Array.isArray(content)
      ? content.flatMap((entry) => {
        const entryRecord = readRecord(entry);
        const text = readString(entryRecord?.text ?? entryRecord?.content ?? entry);
        return text ? [text] : [];
      })
      : [];
  if (texts.some((text) => text.includes('<command-name>/compact</command-name>'))) return 'local-command';
  if (texts.some((text) => text.trim() === '/compact')) return 'plain';
  return null;
}

function readSystemSubtype(message: RawJSONLines): string | null {
  return message.type === 'system' ? readString((message as Record<string, unknown>).subtype) : null;
}

/**
 * Effective model id carried on a main-chain assistant transcript row.
 *
 * Sidechain rows are skipped (subagents may run a different model) and synthetic placeholders
 * (e.g. `<synthetic>` on API-error rows) are never real model ids.
 */
function readMainChainAssistantModelId(message: RawJSONLines): string | null {
  if (message.type !== 'assistant') return null;
  const record = message as Record<string, unknown>;
  if (record.isSidechain === true) return null;
  const model = readString(readRecord(record.message)?.model);
  if (!model || model.includes('<')) return null;
  return model;
}

export function createClaudeSessionTranscriptProjector(params: Readonly<{
  session: Session;
  logPrefix: string;
}>): Readonly<{
  observe(message: RawJSONLines): void;
  reset(): void;
}> {
  const turnDiffBridge = createClaudeRawMessageTurnDiffBridge({
    getSessionId: () => params.session.sessionId ?? params.session.client.sessionId ?? 'unknown',
    sendMessage: (message) => {
      params.session.client.sendClaudeSessionMessage(message);
    },
  });
  const publishWorkStateSnapshot = (snapshot: ClaudeLocalWorkStateSnapshot): void => {
    updateMetadataBestEffort(
      params.session.client,
      (metadata) => mergeSessionWorkStateMetadataV1({
        metadata,
        nextOwned: snapshot,
        ownedSourceFamilies: snapshot.ownedSourceFamilies,
      }) as unknown as Metadata,
      params.logPrefix,
      'claude_terminal_work_state',
    );
  };
  const taskToolWorkStateTracker = createClaudeTaskToolWorkStateTracker({
    backendId: 'claude',
    agentId: 'claude',
  });
  const maybeProjectWorkState = (message: RawJSONLines): void => {
    const updatedAt = Date.now();
    const messageRecord = readRecord((message as Record<string, unknown>).message);
    const content = Array.isArray(messageRecord?.content) ? messageRecord.content : [];
    for (const blockValue of content) {
      const block = readRecord(blockValue);
      if (block?.type !== 'tool_use' || block.name !== 'TodoWrite') continue;
      const snapshot = buildClaudeTodoWriteWorkState({
        backendId: 'claude',
        updatedAt,
        input: block.input,
      });
      publishWorkStateSnapshot(snapshot);
    }
    const taskSnapshot = taskToolWorkStateTracker.applyMessage(message, updatedAt);
    if (taskSnapshot) {
      publishWorkStateSnapshot(taskSnapshot);
    }
  };
  const surfaceRateLimit = (details: NormalizedProviderUsageLimitDetailsV1): void => {
    void surfaceClaudeRateLimitRuntimeIssue(params.session, details, params.logPrefix).catch((error) => {
      logger.debug(`${params.logPrefix}: failed to surface Claude rate-limit runtime issue`, error);
    });
  };
  // Terminal-hosted Claude (unified/local) has no SDK system-message stream, so the transcript is
  // the only place the EFFECTIVE model id is visible. Mirroring the SDK launcher's
  // `runtime_model_update` adoption keeps session models metadata (and therefore UI context-window
  // resolution) correct for terminal sessions.
  let lastAdoptedModelId: string | null = null;
  const maybeAdoptEffectiveModel = (message: RawJSONLines): void => {
    const modelId = readMainChainAssistantModelId(message);
    if (!modelId || modelId === lastAdoptedModelId) return;
    lastAdoptedModelId = modelId;
    updateMetadataBestEffort(
      params.session.client,
      (metadata) => ({
        ...metadata,
        ...(buildClaudeSessionModelsMetadataWithCurrentModelId({
          currentModelId: modelId,
          metadata,
        }) ?? {}),
      }),
      params.logPrefix,
      'runtime_model_update',
    );
  };
  let compactionSequence = 0;
  let activeCompactionLifecycleId: string | null = null;
  let suppressNextLocalCommandCompactStart = false;
  const nextCompactionLifecycleId = (): string => buildClaudeCompactionLifecycleId({
    sessionId: params.session.sessionId ?? params.session.client.sessionId,
    sequence: ++compactionSequence,
  });
  const maybeEmitCompactionEvents = (message: RawJSONLines): void => {
    if (readSystemSubtype(message) === 'compact_boundary') {
      const lifecycleId = activeCompactionLifecycleId ?? nextCompactionLifecycleId();
      activeCompactionLifecycleId = null;
      suppressNextLocalCommandCompactStart = true;
      const providerSessionId = readString((message as Record<string, unknown>).session_id);
      params.session.client.sendSessionEvent(buildClaudeCompactionCompletedEvent({
        lifecycleId,
        source: 'provider-event',
        ...(providerSessionId ? { providerSessionId } : {}),
      }));
      return;
    }

    const compactCommandMarkerKind = readCompactCommandMarkerKind(message);
    if (!compactCommandMarkerKind) return;
    if (compactCommandMarkerKind === 'local-command' && suppressNextLocalCommandCompactStart) {
      suppressNextLocalCommandCompactStart = false;
      return;
    }
    suppressNextLocalCommandCompactStart = false;
    if (activeCompactionLifecycleId !== null) return;
    activeCompactionLifecycleId = nextCompactionLifecycleId();
    params.session.client.sendSessionEvent(buildClaudeCompactionStartedEvent({
      lifecycleId: activeCompactionLifecycleId,
    }));
  };

  return {
    observe(message) {
      maybeAdoptEffectiveModel(message);
      maybeProjectWorkState(message);
      maybeEmitCompactionEvents(message);
      const rateLimitDetails = mapClaudeRateLimitEventToUsageDetails(message);
      if (rateLimitDetails) surfaceRateLimit(rateLimitDetails);
      if (isClaudeInternalTranscriptMessage(message)) {
        return;
      }
      const bridged = turnDiffBridge.observe(message);
      if (bridged) {
        params.session.client.sendClaudeSessionMessage(bridged);
        turnDiffBridge.flushAfterForwardIfNeeded();
      }
    },
    reset() {
      turnDiffBridge.reset();
    },
  };
}
