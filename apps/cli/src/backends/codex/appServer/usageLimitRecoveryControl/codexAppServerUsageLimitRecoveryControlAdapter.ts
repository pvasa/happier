import {
  SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY,
  SessionRuntimeIssueV1Schema,
  SessionUsageLimitRecoveryV1Schema,
  type SessionUsageLimitRecoveryV1,
} from '@happier-dev/protocol';

import type {
  SessionUsageLimitRecoveryControlAdapter as GenericSessionUsageLimitRecoveryControlAdapter,
  SessionUsageLimitRecoveryControlAdapterParams,
} from '@/session/usageLimitRecoveryControls/sessionUsageLimitRecoveryControlTypes';
import { deriveUsageLimitRecoveryTiming } from '@/session/usageLimitRecoveryControls/deriveUsageLimitRecoveryTiming';
import { resolveUsageLimitRecoveryMaxAttemptsExhaustion } from '@/session/usageLimitRecoveryControls/resolveUsageLimitRecoveryMaxAttemptsExhaustion';
import type { CodexAppServerControlClientResult } from '../control/withCodexAppServerControlClient';
import { withCodexAppServerControlClient } from '../control/withCodexAppServerControlClient';
import type { CodexAppServerClient } from '../client/createCodexAppServerClient';
import {
  isCodexRateLimitSnapshotExhausted,
  readEarliestCodexRateLimitResetAtMs,
} from '../rateLimitSnapshot';

type MetadataRecord = Record<string, unknown>;

const CODEX_CONNECTED_SERVICE_ID = 'openai-codex' as const;
const DEFAULT_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS = 3;

type CodexAppServerUsageLimitRecoveryControlResult =
  | Readonly<{ ok: true; status: 'ready' | 'waiting'; metadata: MetadataRecord }>
  | Readonly<{ ok: false; errorCode: string; error: string }>;

type RunWithControlClient = (params: Readonly<{
  cwd: string;
  metadata?: unknown;
  accountSettings?: Readonly<Record<string, unknown>> | null;
  processEnv?: NodeJS.ProcessEnv;
  timeoutMs?: number | null;
  run: (client: CodexAppServerClient) => Promise<unknown>;
}>) => Promise<CodexAppServerControlClientResult<unknown>>;

function stableError(errorCode: string): Readonly<{ ok: false; errorCode: string; error: string }> {
  return { ok: false, errorCode, error: errorCode };
}

function normalizeCwd(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readCodexBackendMode(metadata: MetadataRecord): string | null {
  const descriptor = readRecord(metadata.agentRuntimeDescriptorV1);
  const provider = readRecord(descriptor?.provider);
  const backendMode = provider?.backendMode;
  return typeof backendMode === 'string' && backendMode.trim().length > 0 ? backendMode.trim() : null;
}

function readRecoveryIntent(metadata: MetadataRecord): SessionUsageLimitRecoveryV1 | null {
  const parsed = SessionUsageLimitRecoveryV1Schema.safeParse(metadata[SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]);
  return parsed.success ? parsed.data : null;
}

function buildUsageLimitIssueFingerprint(
  issue: NonNullable<ReturnType<typeof SessionRuntimeIssueV1Schema.safeParse>['data']>,
): string {
  return [
    'usage-limit',
    issue.provider ?? 'codex',
    issue.providerTurnId ?? 'unknown-turn',
    String(issue.occurredAt),
    issue.usageLimit?.resetAtMs === null || issue.usageLimit?.resetAtMs === undefined
      ? 'no-reset'
      : String(issue.usageLimit.resetAtMs),
  ].join(':');
}

function buildRecoveryIntentFromLatestUsageLimitIssue(
  params: SessionUsageLimitRecoveryControlAdapterParams,
): SessionUsageLimitRecoveryV1 | null {
  if (params.rawSession.latestTurnStatus != null && params.rawSession.latestTurnStatus !== 'failed') {
    return null;
  }

  const issueParsed = SessionRuntimeIssueV1Schema.safeParse(params.rawSession.lastRuntimeIssue);
  if (!issueParsed.success || issueParsed.data.source !== 'usage_limit' || !issueParsed.data.usageLimit) {
    return null;
  }

  const connectedService = issueParsed.data.usageLimit.connectedService;
  const selectedAuth: SessionUsageLimitRecoveryV1['selectedAuth'] =
    connectedService?.groupId && connectedService.profileId
      ? {
        kind: 'group',
        serviceId: connectedService.serviceId,
        groupId: connectedService.groupId,
        profileId: connectedService.profileId,
      }
      : connectedService?.profileId
        ? {
          kind: 'profile',
          serviceId: connectedService.serviceId,
          profileId: connectedService.profileId,
        }
        : { kind: 'native', serviceId: CODEX_CONNECTED_SERVICE_ID };

  const timing = deriveUsageLimitRecoveryTiming({
    occurredAtMs: issueParsed.data.occurredAt,
    resetAtMs: issueParsed.data.usageLimit.resetAtMs,
    retryAfterMs: issueParsed.data.usageLimit.retryAfterMs,
  });

  return {
    v: 1,
    status: 'waiting',
    issueFingerprint: buildUsageLimitIssueFingerprint(issueParsed.data),
    armedAtMs: issueParsed.data.occurredAt,
    resetAtMs: timing.resetAtMs,
    nextCheckAtMs: timing.nextCheckAtMs,
    attemptCount: 0,
    maxAttempts: DEFAULT_USAGE_LIMIT_RECOVERY_MAX_ATTEMPTS,
    lastProbeError: null,
    selectedAuth,
  };
}

function buildNextIntent(params: Readonly<{
  intent: SessionUsageLimitRecoveryV1;
  exhausted: boolean;
  resetAtMs: number | null;
}>): SessionUsageLimitRecoveryV1 {
  const attemptCount = params.intent.attemptCount + 1;
  if (!params.exhausted) {
    return {
      ...params.intent,
      status: 'cancelled',
      attemptCount,
      lastProbeError: null,
    };
  }
  return {
    ...params.intent,
    status: 'waiting',
    attemptCount,
    resetAtMs: params.resetAtMs ?? params.intent.resetAtMs,
    nextCheckAtMs: params.resetAtMs ?? params.intent.nextCheckAtMs ?? params.intent.resetAtMs,
    lastProbeError: null,
  };
}

export function createCodexAppServerUsageLimitRecoveryControlAdapter(deps: Readonly<{
  runWithControlClient?: RunWithControlClient;
}> = {}): GenericSessionUsageLimitRecoveryControlAdapter {
  const runWithControlClient = deps.runWithControlClient ?? withCodexAppServerControlClient;
  return {
    checkNow: async (params: SessionUsageLimitRecoveryControlAdapterParams): Promise<CodexAppServerUsageLimitRecoveryControlResult> => {
      const backendMode = readCodexBackendMode(params.metadata);
      if (backendMode && backendMode !== 'appServer') {
        return stableError('codex_quota_probe_unsupported_for_backend_mode');
      }

      const persistedIntent = readRecoveryIntent(params.metadata);
      const intent = persistedIntent && persistedIntent.status !== 'cancelled'
        ? persistedIntent
        : buildRecoveryIntentFromLatestUsageLimitIssue(params);
      if (!intent) {
        return stableError('session_usage_limit_recovery_control_inactive');
      }

      const exhaustedIntent = resolveUsageLimitRecoveryMaxAttemptsExhaustion(intent);
      if (exhaustedIntent) {
        return {
          ok: true,
          status: 'waiting',
          metadata: {
            ...params.metadata,
            [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: exhaustedIntent,
          },
        };
      }

      const cwd = normalizeCwd(params.cwd);
      if (!cwd) return stableError('session_usage_limit_recovery_control_cwd_unavailable');

      const controlResult = await runWithControlClient({
        cwd,
        metadata: params.metadata,
        accountSettings: null,
        run: async (client) => await client.request('account/rateLimits/read'),
      });
      if (!controlResult.ok) return stableError(controlResult.errorCode);

      const exhausted = isCodexRateLimitSnapshotExhausted(controlResult.value);
      const nextIntent = buildNextIntent({
        intent,
        exhausted,
        resetAtMs: readEarliestCodexRateLimitResetAtMs(controlResult.value),
      });
      return {
        ok: true,
        status: exhausted ? 'waiting' : 'ready',
        metadata: {
          ...params.metadata,
          [SESSION_USAGE_LIMIT_RECOVERY_METADATA_KEY]: nextIntent,
        },
      };
    },
  };
}

export const codexAppServerUsageLimitRecoveryControlAdapter =
  createCodexAppServerUsageLimitRecoveryControlAdapter();
