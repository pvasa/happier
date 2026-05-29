import type { Metadata } from '@/api/types';
import { buildPiAgentRuntimeDescriptorV1 } from '@happier-dev/protocol';
import { basename, isAbsolute } from 'node:path';

import {
  buildPiResumeSearchRoots,
  doesPiSessionFileNameMatchSessionId,
  findPiSessionFileForId,
  pathExistsAsFile,
  resolvePiSessionIdFromResumeReference,
} from '@/backends/pi/utils/piSessionFiles';

function normalizeOptionalAbsolutePath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return isAbsolute(trimmed) ? trimmed : null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

type PiSessionIdMetadataLastPublishedState = {
  value: string | null;
  sessionFile?: string | null;
};

const PI_SESSION_FILE_RESOLVE_RETRY_DELAYS_MS = [0, 250, 1_000, 2_500] as const;

export function maybeUpdatePiSessionIdMetadata(params: {
  getPiSessionId: () => string | null;
  getPiSessionFile: () => string | null;
  updateHappySessionMetadata: (updater: (metadata: Metadata) => Metadata) => Promise<void> | void;
  lastPublished: PiSessionIdMetadataLastPublishedState;
}): void {
  const raw = params.getPiSessionId();
  const next = typeof raw === 'string' ? raw.trim() : '';
  const nextSessionFile = normalizeOptionalAbsolutePath(params.getPiSessionFile());
  if (!next) return;

  const lastPublishedSessionFile = normalizeOptionalAbsolutePath(params.lastPublished.sessionFile);
  if (params.lastPublished.value === next && lastPublishedSessionFile === nextSessionFile) return;

  const prev = params.lastPublished.value;
  const prevSessionFile = lastPublishedSessionFile;
  params.lastPublished.value = next;
  params.lastPublished.sessionFile = nextSessionFile;

  try {
    const res = params.updateHappySessionMetadata((metadata) => {
      const nextMetadata = {
        ...metadata,
        piSessionId: next,
        agentRuntimeDescriptorV1: buildPiAgentRuntimeDescriptorV1({
          resumeStrategy: 'sessionFileAbsolutePreferred',
          vendorSessionId: next,
          ...(nextSessionFile ? { sessionFile: nextSessionFile } : {}),
        }),
      };

      if (nextSessionFile) {
        return {
          ...nextMetadata,
          piSessionFile: nextSessionFile,
        };
      }

      const withoutSessionFile = { ...nextMetadata } as Metadata & { piSessionFile?: string };
      delete withoutSessionFile.piSessionFile;
      return withoutSessionFile;
    });
    void Promise.resolve(res).catch(() => {
      if (params.lastPublished.value === next && normalizeOptionalAbsolutePath(params.lastPublished.sessionFile) === nextSessionFile) {
        params.lastPublished.value = prev;
        params.lastPublished.sessionFile = prevSessionFile;
      }
    });
  } catch {
    if (params.lastPublished.value === next && normalizeOptionalAbsolutePath(params.lastPublished.sessionFile) === nextSessionFile) {
      params.lastPublished.value = prev;
      params.lastPublished.sessionFile = prevSessionFile;
    }
  }
}

export async function resolvePiSessionFileForRuntimeSession(params: Readonly<{
  vendorSessionReference: string | null;
  cwd: string;
  processEnv?: NodeJS.ProcessEnv;
  candidatePersistedSessionFile?: string | null;
}>): Promise<string | null> {
  const vendorSessionReference = normalizeOptionalString(params.vendorSessionReference);
  const candidatePersistedSessionFile = normalizeOptionalAbsolutePath(params.candidatePersistedSessionFile);

  if (vendorSessionReference && isAbsolute(vendorSessionReference) && await pathExistsAsFile(vendorSessionReference)) {
    return vendorSessionReference;
  }

  const sessionId = resolvePiSessionIdFromResumeReference(vendorSessionReference ?? '');
  if (!sessionId) {
    return null;
  }

  if (
    candidatePersistedSessionFile &&
    doesPiSessionFileNameMatchSessionId(basename(candidatePersistedSessionFile), sessionId) &&
    await pathExistsAsFile(candidatePersistedSessionFile)
  ) {
    return candidatePersistedSessionFile;
  }

  const roots = buildPiResumeSearchRoots({
    cwd: params.cwd,
    env: params.processEnv ?? process.env,
    candidatePersistedSessionFile,
  });
  return await findPiSessionFileForId({ sessionId, roots });
}

export function publishPiSessionIdMetadata(params: Readonly<{
  session: Readonly<{
    updateMetadata: (updater: (metadata: Metadata) => Metadata) => Promise<void> | void;
    getMetadataSnapshot?: () => Metadata | null;
  }>;
  getPiSessionId: () => string | null;
  cwd: string;
  processEnv?: NodeJS.ProcessEnv;
  lastPublished: PiSessionIdMetadataLastPublishedState;
}>): void {
  const currentSessionReference = normalizeOptionalString(params.getPiSessionId());

  maybeUpdatePiSessionIdMetadata({
    getPiSessionId: () => currentSessionReference,
    getPiSessionFile: () => null,
    updateHappySessionMetadata: (updater) => params.session.updateMetadata(updater),
    lastPublished: params.lastPublished,
  });

  if (!currentSessionReference) return;

  const scheduleResolveAttempt = (attemptIndex: number): void => {
    const delayMs = PI_SESSION_FILE_RESOLVE_RETRY_DELAYS_MS[attemptIndex];
    if (delayMs === undefined) return;

    const runAttempt = () => {
      if (params.lastPublished.value !== currentSessionReference) return;

      const metadataSnapshot = params.session.getMetadataSnapshot?.();
      const candidatePersistedSessionFile = normalizeOptionalAbsolutePath(
        (metadataSnapshot as (Metadata & { piSessionFile?: string }) | null | undefined)?.piSessionFile,
      );

      void resolvePiSessionFileForRuntimeSession({
        vendorSessionReference: currentSessionReference,
        cwd: params.cwd,
        processEnv: params.processEnv,
        candidatePersistedSessionFile,
      }).then((resolvedSessionFile) => {
        if (resolvedSessionFile) {
          if (params.lastPublished.value !== currentSessionReference) return;
          maybeUpdatePiSessionIdMetadata({
            getPiSessionId: () => currentSessionReference,
            getPiSessionFile: () => resolvedSessionFile,
            updateHappySessionMetadata: (updater) => params.session.updateMetadata(updater),
            lastPublished: params.lastPublished,
          });
          return;
        }

        scheduleResolveAttempt(attemptIndex + 1);
      }).catch(() => {
        // Best-effort: missing/removed session files should not fail ACP runtime startup.
        scheduleResolveAttempt(attemptIndex + 1);
      });
    };

    if (delayMs <= 0) {
      runAttempt();
      return;
    }

    const timeout = setTimeout(runAttempt, delayMs);
    timeout.unref?.();
  };

  scheduleResolveAttempt(0);
}
