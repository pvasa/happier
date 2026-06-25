import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

describe('daemon control client startup lock inspection', () => {
  let envScope = createEnvKeyScope(['HAPPIER_HOME_DIR']);
  const spawnedChildren: ChildProcess[] = [];

  afterEach(() => {
    while (spawnedChildren.length > 0) {
      const child = spawnedChildren.pop();
      if (!child) continue;
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
    envScope.restore();
    envScope = createEnvKeyScope(['HAPPIER_HOME_DIR']);
    vi.resetModules();
  });

  it('reports startup in progress when a live daemon lock exists before state is written', async () => {
    const homeDir = createTempDirSync('happier-cli-daemon-starting-lock-');
    envScope.patch({
      HAPPIER_HOME_DIR: homeDir,
    });

    try {
      const child = spawn(
        process.execPath,
        ['-e', 'setInterval(() => {}, 1000)', '/repo/dist/index.mjs', 'daemon', 'start-sync'],
        { stdio: 'ignore' },
      );
      if (!child.pid) throw new Error('missing pid for child');
      spawnedChildren.push(child);

      vi.resetModules();
      const [{ configuration }, { inspectDaemonRunningStateAndCleanupStaleState }] = await Promise.all([
        import('@/configuration'),
        import('./controlClient'),
      ]);

      mkdirSync(dirname(configuration.daemonLockFile), { recursive: true });
      writeFileSync(configuration.daemonLockFile, String(child.pid), 'utf-8');

      await expect(inspectDaemonRunningStateAndCleanupStaleState()).resolves.toEqual({
        status: 'starting',
        pid: child.pid,
      });
      expect(existsSync(configuration.daemonLockFile)).toBe(true);
    } finally {
      removeTempDirSync(homeDir);
    }
  });
});
