import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { readLiveRelayRuntimeStatus } from './liveRelayRuntime';

const trackedEnvKeys = [
  'HOME',
  'USERPROFILE',
  'PATH',
  'HAPPIER_SELF_HOST_INSTALL_ROOT',
  'HAPPIER_SELF_HOST_CONFIG_DIR',
  'HAPPIER_SELF_HOST_DATA_DIR',
  'HAPPIER_SELF_HOST_LOG_DIR',
] as const;

const previousEnv = new Map<string, string | undefined>();

function patchEnv(patch: Partial<Record<(typeof trackedEnvKeys)[number], string | undefined>>): void {
  for (const key of trackedEnvKeys) {
    if (!previousEnv.has(key)) {
      previousEnv.set(key, process.env[key]);
    }
    const value = patch[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

afterEach(() => {
  for (const key of trackedEnvKeys) {
    const value = previousEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  previousEnv.clear();
});

describe('readLiveRelayRuntimeStatus', () => {
  it('resolves ~/ self-host install and config overrides before reading runtime state', async () => {
    const scopedHomeDir = await mkdtemp(path.join(tmpdir(), 'happier-relay-runtime-home-'));
    const installRoot = path.join(scopedHomeDir, 'self-host', 'install');
    const configDir = path.join(scopedHomeDir, 'self-host', 'config');

    try {
      patchEnv({
        HOME: scopedHomeDir,
        USERPROFILE: scopedHomeDir,
        PATH: '',
        HAPPIER_SELF_HOST_INSTALL_ROOT: '~/self-host/install',
        HAPPIER_SELF_HOST_CONFIG_DIR: '~/self-host/config',
        HAPPIER_SELF_HOST_DATA_DIR: '~/self-host/data',
        HAPPIER_SELF_HOST_LOG_DIR: '~/self-host/logs',
      });

      await mkdir(installRoot, { recursive: true });
      await mkdir(configDir, { recursive: true });
      await writeFile(
        path.join(installRoot, 'relay-runtime-state.json'),
        `${JSON.stringify({ version: '1.2.3' })}\n`,
        'utf8',
      );
      await writeFile(path.join(configDir, 'server.env'), 'PORT=4321\n', 'utf8');

      const status = await readLiveRelayRuntimeStatus({
        platform: 'linux',
        mode: 'user',
        channel: 'stable',
        homeDir: scopedHomeDir,
      });

      expect(status.installed).toBe(true);
      expect(status.version).toBe('1.2.3');
      expect(status.health.url).toContain(':4321/');
    } finally {
      await rm(scopedHomeDir, { recursive: true, force: true });
    }
  });
});
