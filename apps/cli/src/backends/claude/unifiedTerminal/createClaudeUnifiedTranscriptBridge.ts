import { createSessionScanner, type SessionScanner } from '../utils/sessionScanner';
import type { RawJSONLines } from '../types';
import type { SessionHookData } from '../utils/startHookServer';
import type { ClaudeUnifiedSessionHookSubscription } from './createClaudeUnifiedHookLifecycleBridge';
import type { ClaudeUnifiedStartableDisposable } from './_types';

type ClaudeUnifiedTranscriptBridgeSessionFound = (sessionId: string, data: SessionHookData) => void;

function readHookEventName(data: SessionHookData): string {
  const raw = data.hook_event_name ?? data.hookEventName;
  return typeof raw === 'string' ? raw : '';
}

function readHookString(data: SessionHookData, snakeKey: string, camelKey: string): string | null {
  const raw = (data as Record<string, unknown>)[snakeKey] ?? (data as Record<string, unknown>)[camelKey];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function readSessionStartInfo(data: SessionHookData): Readonly<{
  sessionId: string;
  transcriptPath: string | null;
  source: string | null;
}> | null {
  if (readHookEventName(data) !== 'SessionStart') return null;
  const sessionId = readHookString(data, 'session_id', 'sessionId');
  if (!sessionId) return null;
  return {
    sessionId,
    transcriptPath: readHookString(data, 'transcript_path', 'transcriptPath'),
    source: readHookString(data, 'source', 'source'),
  };
}

type ClaudeUnifiedSessionStartInfo = NonNullable<ReturnType<typeof readSessionStartInfo>>;

type PendingClaudeUnifiedSessionStart = Readonly<{
  data: SessionHookData;
  receivedAtMs: number;
  sessionInfo: ClaudeUnifiedSessionStartInfo;
}>;

function disposeSubscription(dispose: (() => void) | null): void {
  if (!dispose) return;
  dispose();
}

function readTranscriptString(message: RawJSONLines, key: string): string | null {
  const raw = (message as Record<string, unknown>)[key];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

function readTranscriptTimestampMs(message: RawJSONLines): number | null {
  const timestamp = readTranscriptString(message, 'timestamp');
  if (!timestamp) return null;
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

function shouldForwardResumeTranscriptToLifecycle(
  message: RawJSONLines,
  resumeLiveTranscriptAfterMsBySessionId: ReadonlyMap<string, number>,
): boolean {
  const sessionId = readTranscriptString(message, 'sessionId');
  if (!sessionId) return true;
  const liveAfterMs = resumeLiveTranscriptAfterMsBySessionId.get(sessionId);
  if (liveAfterMs === undefined) return true;
  const timestampMs = readTranscriptTimestampMs(message);
  if (timestampMs === null) return true;
  return timestampMs >= liveAfterMs;
}

export function createClaudeUnifiedTranscriptBridge(opts: Readonly<{
  sessionId: string | null;
  transcriptPath?: string | null | undefined;
  workingDirectory: string;
  claudeConfigDir?: string | null | undefined;
  onMessage?: ((message: RawJSONLines) => void) | undefined;
  onTranscriptMessage?: ((message: RawJSONLines) => void) | undefined;
  onSessionFound?: ClaudeUnifiedTranscriptBridgeSessionFound | undefined;
  onTranscriptMissing?: ((info: { sessionId: string; filePath: string }) => void) | undefined;
  transcriptMissingWarningMs?: number | undefined;
  subscribeClaudeSessionHooks?: ClaudeUnifiedSessionHookSubscription | undefined;
  loadCommittedClaudeJsonlMessageKeys?: (() => Promise<ReadonlySet<string>> | ReadonlySet<string>) | undefined;
  classifyDiscoveredSession?: ((params: {
    sessionId: string;
    filePath: string;
    messages: readonly RawJSONLines[];
  }) => 'ignore' | 'diagnostic' | 'main' | null | undefined) | undefined;
}>): ClaudeUnifiedStartableDisposable {
  let disposed = false;
  let scanner: Awaited<SessionScanner> | null = null;
  let unsubscribe: (() => void) | null = null;
  const resumeLiveTranscriptAfterMsBySessionId = new Map<string, number>();
  const pendingSessionStarts: PendingClaudeUnifiedSessionStart[] = [];

  const applySessionStart = (
    sessionInfo: ClaudeUnifiedSessionStartInfo,
    data: SessionHookData,
    receivedAtMs: number,
  ) => {
    if (disposed) return;
    if (sessionInfo.source === 'resume') {
      resumeLiveTranscriptAfterMsBySessionId.set(sessionInfo.sessionId, receivedAtMs);
    }
    opts.onSessionFound?.(sessionInfo.sessionId, data);

    if (!scanner) {
      pendingSessionStarts.push({ data, receivedAtMs, sessionInfo });
      return;
    }

    scanner.onNewSession({
      sessionId: sessionInfo.sessionId,
      transcriptPath: sessionInfo.transcriptPath,
    });
  };

  const flushPendingSessionStarts = () => {
    if (!scanner) return;
    for (const pending of pendingSessionStarts.splice(0)) {
      if (pending.sessionInfo.source === 'resume') {
        resumeLiveTranscriptAfterMsBySessionId.set(pending.sessionInfo.sessionId, pending.receivedAtMs);
      }
      scanner.onNewSession({
        sessionId: pending.sessionInfo.sessionId,
        transcriptPath: pending.sessionInfo.transcriptPath,
      });
    }
  };

  return {
    async start() {
      if (disposed || scanner) return;
      const waitForSessionStartHook = Boolean(opts.subscribeClaudeSessionHooks);
      if (opts.subscribeClaudeSessionHooks && !unsubscribe) {
        unsubscribe = opts.subscribeClaudeSessionHooks((data) => {
          const sessionInfo = readSessionStartInfo(data);
          if (!sessionInfo) return;
          applySessionStart(sessionInfo, data, Date.now());
        }) ?? null;
      }
      const committedClaudeJsonlMessageKeys = waitForSessionStartHook
        ? await Promise.resolve(opts.loadCommittedClaudeJsonlMessageKeys?.()).catch(() => new Set<string>())
        : new Set<string>();
      if (disposed) {
        pendingSessionStarts.length = 0;
        return;
      }
      const nextScanner = await createSessionScanner({
        sessionId: waitForSessionStartHook ? null : opts.sessionId,
        transcriptPath: waitForSessionStartHook ? null : opts.transcriptPath,
        claudeConfigDir: opts.claudeConfigDir,
        workingDirectory: opts.workingDirectory,
        onMessage: (message) => {
          opts.onMessage?.(message);
          if (shouldForwardResumeTranscriptToLifecycle(message, resumeLiveTranscriptAfterMsBySessionId)) {
            opts.onTranscriptMessage?.(message);
          }
        },
        onTranscriptMissing: opts.onTranscriptMissing,
        transcriptMissingWarningMs: opts.transcriptMissingWarningMs,
        initialProcessedMessageKeys: committedClaudeJsonlMessageKeys,
        replayInitialMessages: waitForSessionStartHook,
        discoverNewSessions: waitForSessionStartHook && !opts.sessionId && !opts.transcriptPath,
        bindToFirstSession: waitForSessionStartHook,
        bindDiscoveredSessions: !waitForSessionStartHook,
        classifyDiscoveredSession: opts.classifyDiscoveredSession,
      });
      if (disposed) {
        pendingSessionStarts.length = 0;
        await nextScanner.cleanup();
        return;
      }
      scanner = nextScanner;
      flushPendingSessionStarts();
    },
    async dispose() {
      if (disposed) return;
      disposed = true;
      disposeSubscription(unsubscribe);
      unsubscribe = null;
      pendingSessionStarts.length = 0;
      await scanner?.cleanup();
      scanner = null;
    },
  };
}
