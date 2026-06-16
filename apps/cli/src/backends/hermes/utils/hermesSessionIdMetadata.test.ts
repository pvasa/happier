import { describe, expect, it } from 'vitest';

import { createTestMetadata } from '@/testkit/backends/sessionMetadata';
import type { Metadata } from '@/api/types';
import { maybeUpdateHermesSessionIdMetadata } from './hermesSessionIdMetadata';

describe('maybeUpdateHermesSessionIdMetadata', () => {
  it.each([null, '', '   '])('does not publish metadata when session id is %p', (sessionId) => {
    const last = { value: null as string | null };
    let metadata = createTestMetadata();
    let updateCalls = 0;

    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => sessionId,
      updateHappySessionMetadata: (updater) => {
        updateCalls += 1;
        metadata = updater(metadata);
      },
      lastPublished: last,
    });

    expect(updateCalls).toBe(0);
    expect(last.value).toBeNull();
    expect((metadata as Metadata & { hermesSessionId?: string }).hermesSessionId).toBeUndefined();
  });

  it('publishes trimmed hermesSessionId and preserves existing metadata fields', () => {
    const last = { value: null as string | null };
    let metadata = createTestMetadata({ flavor: 'hermes' });

    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => '  hermes-1  ',
      updateHappySessionMetadata: (updater) => {
        metadata = updater(metadata);
      },
      lastPublished: last,
    });

    expect(last.value).toBe('hermes-1');
    expect((metadata as Metadata & { hermesSessionId?: string }).hermesSessionId).toBe('hermes-1');
    expect(metadata.path).toBe('/tmp/project');
    expect(metadata.flavor).toBe('hermes');
  });

  it('does not re-run updater when session id is unchanged after trimming', () => {
    const last = { value: null as string | null };
    let metadata = createTestMetadata({ flavor: 'hermes' });
    let updateCalls = 0;

    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => 'hermes-1',
      updateHappySessionMetadata: (updater) => {
        updateCalls += 1;
        metadata = updater(metadata);
      },
      lastPublished: last,
    });
    const before = metadata;
    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => '  hermes-1 ',
      updateHappySessionMetadata: (updater) => {
        updateCalls += 1;
        metadata = updater(metadata);
      },
      lastPublished: last,
    });

    expect(updateCalls).toBe(1);
    expect(metadata).toBe(before);
    expect(last.value).toBe('hermes-1');
  });

  it('publishes again when session id changes', () => {
    const last = { value: null as string | null };
    let metadata = createTestMetadata({ flavor: 'hermes' });

    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => 'hermes-1',
      updateHappySessionMetadata: (updater) => {
        metadata = updater(metadata);
      },
      lastPublished: last,
    });
    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => 'hermes-2',
      updateHappySessionMetadata: (updater) => {
        metadata = updater(metadata);
      },
      lastPublished: last,
    });

    expect(last.value).toBe('hermes-2');
    expect((metadata as Metadata & { hermesSessionId?: string }).hermesSessionId).toBe('hermes-2');
  });

  it('reverts lastPublished when the metadata update fails', async () => {
    const last = { value: null as string | null };
    let updateCalls = 0;

    maybeUpdateHermesSessionIdMetadata({
      getHermesSessionId: () => 'hermes-1',
      updateHappySessionMetadata: async () => {
        updateCalls += 1;
        throw new Error('update failed');
      },
      lastPublished: last,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(updateCalls).toBe(1);
    expect(last.value).toBeNull();
  });
});
