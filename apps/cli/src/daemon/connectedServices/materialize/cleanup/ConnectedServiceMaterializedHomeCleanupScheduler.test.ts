import { mkdir, rm, stat, utimes } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { createTempDir, removeTempDir } from '@/testkit/fs/tempDir';
import { ConnectedServiceMaterializedHomeCleanupScheduler } from './ConnectedServiceMaterializedHomeCleanupScheduler';

async function touchOld(path: string, nowMs: number, ageMs: number): Promise<void> {
  const time = new Date(nowMs - ageMs);
  await utimes(path, time, time);
}

describe('ConnectedServiceMaterializedHomeCleanupScheduler', () => {
  it('keeps live and resumable materialized homes while deleting stale orphan homes', async () => {
    const baseDir = await createTempDir('happier-connected-service-materialized-cleanup-');
    const nowMs = 100_000;
    try {
      const liveHome = join(baseDir, 'csm_live', 'codex');
      const retainedHome = join(baseDir, 'csm_retained', 'claude');
      const recentHome = join(baseDir, 'csm_recent', 'pi');
      const orphanHome = join(baseDir, 'csm_orphan', 'opencode');
      await mkdir(liveHome, { recursive: true });
      await mkdir(retainedHome, { recursive: true });
      await mkdir(recentHome, { recursive: true });
      await mkdir(orphanHome, { recursive: true });
      await touchOld(liveHome, nowMs, 60_000);
      await touchOld(retainedHome, nowMs, 60_000);
      await touchOld(recentHome, nowMs, 1_000);
      await touchOld(orphanHome, nowMs, 60_000);

      const scheduler = new ConnectedServiceMaterializedHomeCleanupScheduler({
        baseDir,
        nowMs: () => nowMs,
        rootTtlMs: 10_000,
        attemptsTtlMs: 10_000,
        hasLiveTarget: ({ materializationIdentityId }) => materializationIdentityId === 'csm_live',
        listRetainedIdentityIds: async () => new Set(['csm_retained']),
      });

      await expect(scheduler.reconcileMaterializedHomes()).resolves.toEqual([
        expect.objectContaining({ cleaned: true, path: orphanHome }),
      ]);
      await expect(stat(liveHome)).resolves.toBeTruthy();
      await expect(stat(retainedHome)).resolves.toBeTruthy();
      await expect(stat(recentHome)).resolves.toBeTruthy();
      await expect(stat(orphanHome)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeTempDir(baseDir);
    }
  });

  it('reaps stale attempt roots only when no active materialization references them', async () => {
    const baseDir = await createTempDir('happier-connected-service-materialized-attempt-cleanup-');
    const nowMs = 100_000;
    try {
      const attemptsDir = join(baseDir, '.attempts');
      const liveAttempt = join(attemptsDir, 'csm_live-codex-00000000-0000-4000-8000-000000000001');
      const staleAttempt = join(attemptsDir, 'csm_orphan-codex-00000000-0000-4000-8000-000000000002');
      await mkdir(liveAttempt, { recursive: true });
      await mkdir(staleAttempt, { recursive: true });
      await touchOld(liveAttempt, nowMs, 60_000);
      await touchOld(staleAttempt, nowMs, 60_000);

      const scheduler = new ConnectedServiceMaterializedHomeCleanupScheduler({
        baseDir,
        nowMs: () => nowMs,
        rootTtlMs: 10_000,
        attemptsTtlMs: 10_000,
        hasLiveTarget: ({ materializationIdentityId }) => materializationIdentityId === 'csm_live',
        listRetainedIdentityIds: async () => new Set(),
      });

      await expect(scheduler.reconcileMaterializedHomes()).resolves.toEqual([
        expect.objectContaining({ cleaned: true, path: staleAttempt }),
      ]);
      await expect(stat(liveAttempt)).resolves.toBeTruthy();
      await expect(stat(staleAttempt)).rejects.toMatchObject({ code: 'ENOENT' });
    } finally {
      await removeTempDir(baseDir);
    }
  });

  it('keeps a queued pending home when its identity becomes retained before child-exit cleanup', async () => {
    const baseDir = await createTempDir('happier-connected-service-materialized-retained-pending-');
    const nowMs = 100_000;
    try {
      const queuedHome = join(baseDir, 'csm_later_retained', 'codex');
      await mkdir(queuedHome, { recursive: true });
      await touchOld(queuedHome, nowMs, 60_000);

      let live = true;
      const retainedIdentityIds = new Set<string>();
      const scheduler = new ConnectedServiceMaterializedHomeCleanupScheduler({
        baseDir,
        nowMs: () => nowMs,
        rootTtlMs: 10_000,
        attemptsTtlMs: 10_000,
        hasLiveTarget: () => live,
        listRetainedIdentityIds: async () => retainedIdentityIds,
      });

      await expect(scheduler.reconcileMaterializedHomes()).resolves.toEqual([]);

      live = false;
      retainedIdentityIds.add('csm_later_retained');

      await expect(scheduler.cleanupPendingMaterializedHomes()).resolves.toEqual([]);
      await expect(stat(queuedHome)).resolves.toBeTruthy();
    } finally {
      await removeTempDir(baseDir);
    }
  });

  it('keeps failed cleanup targets retryable and drops them after the retry budget', async () => {
    const baseDir = await createTempDir('happier-connected-service-materialized-cleanup-retry-');
    const nowMs = 100_000;
    try {
      const orphanHome = join(baseDir, 'csm_orphan', 'codex');
      await mkdir(orphanHome, { recursive: true });
      await touchOld(orphanHome, nowMs, 60_000);
      let removeAttempts = 0;
      const removePath: typeof rm = async () => {
        removeAttempts += 1;
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      };
      const scheduler = new ConnectedServiceMaterializedHomeCleanupScheduler({
        baseDir,
        nowMs: () => nowMs,
        rootTtlMs: 10_000,
        attemptsTtlMs: 10_000,
        maxCleanupRetries: 2,
        removePath,
        hasLiveTarget: () => false,
        listRetainedIdentityIds: async () => new Set(),
      });

      await expect(scheduler.reconcileMaterializedHomes()).rejects.toMatchObject({ code: 'EBUSY' });
      await expect(scheduler.cleanupPendingMaterializedHomes()).rejects.toMatchObject({ code: 'EBUSY' });
      await expect(scheduler.cleanupPendingMaterializedHomes()).resolves.toEqual([]);
      expect(removeAttempts).toBe(2);
    } finally {
      await removeTempDir(baseDir);
    }
  });
});
