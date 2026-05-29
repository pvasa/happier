import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Metadata } from '@/api/types';
import { createTestMetadata } from '@/testkit/backends/sessionMetadata';
import { formatPiSessionDirectoryForCwd } from '@/backends/pi/utils/piSessionFiles';

import {
  maybeUpdatePiSessionIdMetadata,
  publishPiSessionIdMetadata,
  resolvePiSessionFileForRuntimeSession,
} from './piSessionIdMetadata';

describe('maybeUpdatePiSessionIdMetadata', () => {
  it.each([null, '', '   '])('does not publish metadata when session id is %p', (sessionId) => {
    const lastPublished = { value: null as string | null };
    let metadata = createTestMetadata();
    let calls = 0;

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => sessionId,
      getPiSessionFile: () => null,
      updateHappySessionMetadata: (updater) => {
        calls += 1;
        metadata = updater(metadata);
      },
      lastPublished,
    });

    expect(calls).toBe(0);
    expect(lastPublished.value).toBeNull();
    expect((metadata as Metadata & { piSessionId?: string }).piSessionId).toBeUndefined();
  });

  it('publishes trimmed session id once and preserves unrelated metadata', () => {
    const lastPublished = { value: null as string | null };
    let metadata = createTestMetadata({ flavor: 'pi' });

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => '  pi-session-1 ',
      getPiSessionFile: () => '  /tmp/pi/sessions/pi-session-1.jsonl ',
      updateHappySessionMetadata: (updater) => {
        metadata = updater(metadata);
      },
      lastPublished,
    });

    expect(lastPublished.value).toBe('pi-session-1');
    expect((metadata as Metadata & { piSessionId?: string }).piSessionId).toBe('pi-session-1');
    expect((metadata as Metadata & { piSessionFile?: string }).piSessionFile)
      .toBe('/tmp/pi/sessions/pi-session-1.jsonl');
    expect(metadata.agentRuntimeDescriptorV1).toEqual({
      v: 1,
      providerId: 'pi',
      provider: {
        resumeStrategy: 'sessionFileAbsolutePreferred',
        vendorSessionId: 'pi-session-1',
        sessionFile: '/tmp/pi/sessions/pi-session-1.jsonl',
      },
    });
    expect(metadata.flavor).toBe('pi');
  });

  it('does not update metadata when value is unchanged', () => {
    const lastPublished = { value: null as string | null };
    let metadata = createTestMetadata();
    let calls = 0;

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => 'pi-session-1',
      getPiSessionFile: () => null,
      updateHappySessionMetadata: (updater) => {
        calls += 1;
        metadata = updater(metadata);
      },
      lastPublished,
    });
    const snapshot = metadata;

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => ' pi-session-1 ',
      getPiSessionFile: () => null,
      updateHappySessionMetadata: (updater) => {
        calls += 1;
        metadata = updater(metadata);
      },
      lastPublished,
    });

    expect(calls).toBe(1);
    expect(metadata).toBe(snapshot);
  });

  it('updates metadata when the same session id later publishes an absolute session file', () => {
    const lastPublished = { value: null as string | null, sessionFile: null as string | null };
    let metadata = createTestMetadata();
    let calls = 0;

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => 'pi-session-1',
      getPiSessionFile: () => null,
      updateHappySessionMetadata: (updater) => {
        calls += 1;
        metadata = updater(metadata);
      },
      lastPublished,
    });

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => 'pi-session-1',
      getPiSessionFile: () => '/tmp/pi/sessions/pi-session-1.jsonl',
      updateHappySessionMetadata: (updater) => {
        calls += 1;
        metadata = updater(metadata);
      },
      lastPublished,
    });

    expect(calls).toBe(2);
    expect((metadata as Metadata & { piSessionFile?: string }).piSessionFile)
      .toBe('/tmp/pi/sessions/pi-session-1.jsonl');
    expect(metadata.agentRuntimeDescriptorV1).toEqual({
      v: 1,
      providerId: 'pi',
      provider: {
        resumeStrategy: 'sessionFileAbsolutePreferred',
        vendorSessionId: 'pi-session-1',
        sessionFile: '/tmp/pi/sessions/pi-session-1.jsonl',
      },
    });
  });

  it('clears stale piSessionFile when publishing a new session id without a resolved file', () => {
    const lastPublished = { value: null as string | null, sessionFile: null as string | null };
    let metadata = createTestMetadata({
      piSessionId: 'old-session',
      piSessionFile: '/tmp/pi/sessions/old-session.jsonl',
      agentRuntimeDescriptorV1: {
        v: 1,
        providerId: 'pi',
        provider: {
          resumeStrategy: 'sessionFileAbsolutePreferred',
          vendorSessionId: 'old-session',
          sessionFile: '/tmp/pi/sessions/old-session.jsonl',
        },
      },
    } as Partial<Metadata>);

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => 'new-session',
      getPiSessionFile: () => null,
      updateHappySessionMetadata: (updater) => {
        metadata = updater(metadata);
      },
      lastPublished,
    });

    expect((metadata as Metadata & { piSessionFile?: string }).piSessionFile).toBeUndefined();
    expect(metadata.agentRuntimeDescriptorV1).toEqual({
      v: 1,
      providerId: 'pi',
      provider: {
        resumeStrategy: 'sessionFileAbsolutePreferred',
        vendorSessionId: 'new-session',
      },
    });
  });

  it('resolves pi session files from PI_CODING_AGENT_DIR using the encoded cwd layout', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'pi-session-discovery-'));
    const cwd = join(tempRoot, 'repo');
    const encodedCwdDir = formatPiSessionDirectoryForCwd(cwd);
    const agentDir = join(tempRoot, 'pi-agent-dir');
    const sessionsDir = join(agentDir, 'sessions', encodedCwdDir);
    await mkdir(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 'session-pi-session-1.jsonl');
    await writeFile(sessionFile, '{}\n');

    const resolved = await resolvePiSessionFileForRuntimeSession({
      vendorSessionReference: 'pi-session-1',
      cwd,
      processEnv: {
        PI_CODING_AGENT_DIR: agentDir,
      },
    });

    expect(resolved).toBe(sessionFile);
  });

  it('publishes piSessionFile via runtime session discovery when available', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'pi-session-publish-'));
    const cwd = join(tempRoot, 'repo');
    const encodedCwdDir = formatPiSessionDirectoryForCwd(cwd);
    const agentDir = join(tempRoot, 'pi-agent-dir');
    const sessionsDir = join(agentDir, 'sessions', encodedCwdDir);
    await mkdir(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 'session-pi-session-1.jsonl');
    await writeFile(sessionFile, '{}\n');

    const lastPublished = { value: null as string | null, sessionFile: null as string | null };
    let metadata = createTestMetadata({ flavor: 'pi' });

    publishPiSessionIdMetadata({
      session: {
        updateMetadata: (updater) => {
          metadata = updater(metadata);
        },
        getMetadataSnapshot: () => metadata,
      },
      getPiSessionId: () => 'pi-session-1',
      cwd,
      processEnv: {
        PI_CODING_AGENT_DIR: agentDir,
      },
      lastPublished,
    });

    await vi.waitFor(() => {
      expect((metadata as Metadata & { piSessionFile?: string }).piSessionFile).toBe(sessionFile);
      expect(metadata.agentRuntimeDescriptorV1).toEqual({
        v: 1,
        providerId: 'pi',
        provider: {
          resumeStrategy: 'sessionFileAbsolutePreferred',
          vendorSessionId: 'pi-session-1',
          sessionFile,
        },
      });
    });
  });

  it('retries session-file discovery and publishes piSessionFile when the file appears shortly after startup', async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), 'pi-session-retry-'));
    const cwd = join(tempRoot, 'repo');
    const encodedCwdDir = formatPiSessionDirectoryForCwd(cwd);
    const agentDir = join(tempRoot, 'pi-agent-dir');
    const sessionsDir = join(agentDir, 'sessions', encodedCwdDir);
    await mkdir(sessionsDir, { recursive: true });
    const sessionFile = join(sessionsDir, 'session-pi-session-1.jsonl');

    const lastPublished = { value: null as string | null, sessionFile: null as string | null };
    let metadata = createTestMetadata({ flavor: 'pi' });

    publishPiSessionIdMetadata({
      session: {
        updateMetadata: (updater) => {
          metadata = updater(metadata);
        },
        getMetadataSnapshot: () => metadata,
      },
      getPiSessionId: () => 'pi-session-1',
      cwd,
      processEnv: {
        PI_CODING_AGENT_DIR: agentDir,
      },
      lastPublished,
    });

    setTimeout(() => {
      void writeFile(sessionFile, '{}\n');
    }, 100);

    await vi.waitFor(() => {
      expect((metadata as Metadata & { piSessionFile?: string }).piSessionFile).toBe(sessionFile);
    }, { timeout: 4_000 });
  });

  it('reverts lastPublished when the metadata update fails', async () => {
    const lastPublished = { value: null as string | null, sessionFile: null as string | null };
    let calls = 0;

    maybeUpdatePiSessionIdMetadata({
      getPiSessionId: () => 'pi-session-1',
      getPiSessionFile: () => null,
      updateHappySessionMetadata: async () => {
        calls += 1;
        throw new Error('update failed');
      },
      lastPublished,
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(calls).toBe(1);
    expect(lastPublished.value).toBeNull();
    expect(lastPublished.sessionFile).toBeNull();
  });
});
