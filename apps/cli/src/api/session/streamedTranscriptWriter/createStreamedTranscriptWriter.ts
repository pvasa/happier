import { randomUUID } from 'node:crypto';

import type { ACPProvider } from '../sessionMessageTypes';
import { resolveCheckpointIntervalMs, resolveCheckpointMinChars } from './env';
import { buildStreamedTranscriptSegmentKey, type StreamedTranscriptSegmentKey, type StreamedTranscriptSegmentKind } from './segmentKey';
import { commitStreamedTranscriptSegmentSnapshot } from './commitStreamedTranscriptSegmentSnapshot';
import { normalizeSidechainId } from './normalizeSidechainId';
import { waitForSegmentDrain, type StreamedTranscriptSegmentRuntime, type StreamedTranscriptSegmentState } from './segmentRuntime';
import type {
  StreamedTranscriptFlushSummary,
  StreamedTranscriptSegmentFlushSummary,
  StreamedTranscriptWriter,
  StreamedTranscriptWriterSession,
} from './types';

type SegmentKind = StreamedTranscriptSegmentKind;
type SegmentState = StreamedTranscriptSegmentState;

type SegmentKey = StreamedTranscriptSegmentKey;

type SegmentRuntime = StreamedTranscriptSegmentRuntime;

function didSegmentDurablyFlush(segment: SegmentRuntime, expectedState: SegmentState): boolean {
  if (segment.accumulatedText.length === 0) return false;
  return segment.lastCommittedTextVersion === segment.textVersion && segment.lastCommittedState === expectedState;
}

function buildFlushSummary(params: {
  flushedSegments: ReadonlyArray<SegmentRuntime>;
  expectedState: SegmentState;
}): StreamedTranscriptFlushSummary {
  const segments: StreamedTranscriptSegmentFlushSummary[] = params.flushedSegments.map((segment) => ({
    kind: segment.kind,
    sidechainId: segment.sidechainId,
    sawText: segment.accumulatedText.length > 0,
    didDurablyFlush: didSegmentDurablyFlush(segment, params.expectedState),
    lastCommittedState: segment.lastCommittedState,
  }));

  const buildAggregate = (kind: SegmentKind, sidechainId?: string | null) => {
    const matches = segments.filter(
      (segment) => segment.kind === kind && segment.sawText && (sidechainId === undefined || segment.sidechainId === sidechainId),
    );
    return {
      sawText: matches.length > 0,
      didDurablyFlush: matches.length > 0 && matches.every((segment) => segment.didDurablyFlush),
    } as const;
  };

  return {
    assistant: buildAggregate('assistant'),
    assistantRoot: buildAggregate('assistant', null),
    thinking: buildAggregate('thinking'),
    thinkingRoot: buildAggregate('thinking', null),
    segments,
  };
}

export function createStreamedTranscriptWriter(params: {
  provider: ACPProvider;
  session: StreamedTranscriptWriterSession;
  makeLocalId?: () => string;
  checkpointIntervalMs?: number | null;
  checkpointMinChars?: number | null;
}): StreamedTranscriptWriter {
  const provider = params.provider;
  const session = params.session;
  const makeLocalId = typeof params.makeLocalId === 'function' ? params.makeLocalId : () => randomUUID();

  const checkpointIntervalMs = resolveCheckpointIntervalMs(params.checkpointIntervalMs);
  const checkpointMinChars = resolveCheckpointMinChars(params.checkpointMinChars);

  const segments = new Map<SegmentKey, SegmentRuntime>();

  const commitDurableSnapshot = (segment: SegmentRuntime, opts: { state: SegmentState; interruptedReason?: string }) => {
    commitStreamedTranscriptSegmentSnapshot({
      provider,
      session,
      segment,
      state: opts.state,
      interruptedReason: opts.interruptedReason,
    });
  };

  const getOrCreateSegment = (kind: SegmentKind, sidechainId: string | null): SegmentRuntime => {
    const key = buildStreamedTranscriptSegmentKey(kind, sidechainId);
    const existing = segments.get(key);
    if (existing) return existing;

    const nowMs = Date.now();
    const created: SegmentRuntime = {
      key,
      kind,
      sidechainId,
      segmentLocalId: makeLocalId(),
      startedAtMs: nowMs,
      accumulatedText: '',
      textVersion: 0,
      didWriteDurable: false,
      lastCheckpointAtMs: 0,
      lastCheckpointTextLen: 0,
      lastCommittedTextVersion: 0,
      lastCommittedState: null,
      lastCommitFailedAtMs: 0,
      isCommittingDurable: false,
      pendingDurableCommit: null,
      idleWaiters: [],
    };
    segments.set(key, created);
    return created;
  };

  const getExistingSegment = (kind: SegmentKind, sidechainId: string | null): SegmentRuntime | null => {
    const key = buildStreamedTranscriptSegmentKey(kind, sidechainId);
    return segments.get(key) ?? null;
  };

  const appendDelta = (kind: SegmentKind, deltaText: string, sidechainId: string | null) => {
    if (!deltaText) return;

    const segment = getOrCreateSegment(kind, sidechainId);
    segment.accumulatedText += deltaText;
    segment.textVersion += 1;

    if (!segment.didWriteDurable) {
      // While the first durable snapshot is still in flight, keep coalescing text in memory and
      // let the in-flight commit or a later terminal flush capture the newer snapshot. Emitting
      // another streaming checkpoint here creates duplicate transcript rows with the same final text.
      if (segment.isCommittingDurable) {
        if (
          checkpointIntervalMs === 0
          && segment.accumulatedText.length - segment.lastCheckpointTextLen >= checkpointMinChars
        ) {
          commitDurableSnapshot(segment, { state: 'streaming' });
        }
        return;
      }
      commitDurableSnapshot(segment, { state: 'streaming' });
      return;
    }

    const nowMs = Date.now();
    if (checkpointIntervalMs === 0) {
      if (segment.accumulatedText.length - segment.lastCheckpointTextLen >= checkpointMinChars) {
        commitDurableSnapshot(segment, { state: 'streaming' });
      }
      return;
    }

    if (nowMs - segment.lastCheckpointAtMs < checkpointIntervalMs) return;
    if (segment.accumulatedText.length - segment.lastCheckpointTextLen < checkpointMinChars) return;
    commitDurableSnapshot(segment, { state: 'streaming' });
  };

  const overrideSegmentText = (kind: SegmentKind, text: string, sidechainId: string | null): boolean => {
    const segment = getExistingSegment(kind, sidechainId);
    if (!segment) return false;
    if (segment.accumulatedText === text) return true;
    segment.accumulatedText = text;
    segment.textVersion += 1;
    return true;
  };

  const flushAll = async (opts: {
    reason: 'tool-call-boundary' | 'turn-end' | 'abort';
    interruptedReason?: string;
  }): Promise<StreamedTranscriptFlushSummary> => {
    const state: SegmentState = opts.reason === 'abort' ? 'interrupted' : 'complete';
    const drainPromises: Promise<void>[] = [];
    const flushedSegments = Array.from(segments.values());

    for (const segment of flushedSegments) {
      commitDurableSnapshot(segment, { state, interruptedReason: opts.interruptedReason });
      drainPromises.push(waitForSegmentDrain(segment));
      segments.delete(segment.key);
    }

    await Promise.all(drainPromises);
    return buildFlushSummary({ flushedSegments, expectedState: state });
  };

  return {
    appendAssistantDelta: (deltaText, opts) => appendDelta('assistant', deltaText, normalizeSidechainId(opts?.sidechainId)),
    appendThinkingDelta: (deltaText, opts) => appendDelta('thinking', deltaText, normalizeSidechainId(opts?.sidechainId)),
    overrideAssistantText: (text, opts) => overrideSegmentText('assistant', text, normalizeSidechainId(opts?.sidechainId)),
    overrideThinkingText: (text, opts) => overrideSegmentText('thinking', text, normalizeSidechainId(opts?.sidechainId)),
    flushAll,
  };
}
