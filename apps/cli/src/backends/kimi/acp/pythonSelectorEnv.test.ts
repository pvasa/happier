import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';

import { resolveKimiAcpPythonSelectorChildEnv } from './pythonSelectorEnv';

const TEMP_DIRS = new Set<string>();

afterEach(() => {
  for (const dir of TEMP_DIRS) removeTempDirSync(dir);
  TEMP_DIRS.clear();
});

function createTrackedTempDir(): string {
  const dir = createTempDirSync('happier-kimi-selector-env-');
  TEMP_DIRS.add(dir);
  return dir;
}

describe('resolveKimiAcpPythonSelectorChildEnv', () => {
  it('prepends a PollSelector sitecustomize shim to PYTHONPATH on Linux', () => {
    const shimBaseDir = createTrackedTempDir();

    const env = resolveKimiAcpPythonSelectorChildEnv({
      selector: 'poll',
      env: { PYTHONPATH: '/existing/pythonpath' },
      platform: 'linux',
      shimBaseDir,
    });

    const [shimDir, inheritedPythonPath] = env.PYTHONPATH?.split(delimiter) ?? [];
    expect(shimDir).toContain('kimi-acp-poll-selector-');
    expect(inheritedPythonPath).toBe('/existing/pythonpath');

    const sitecustomizePath = join(shimDir ?? '', 'sitecustomize.py');
    expect(existsSync(sitecustomizePath)).toBe(true);
    expect(readFileSync(sitecustomizePath, 'utf8')).toContain('PollSelector');
  });

  it('uses a fresh private shim directory for each poll selector environment', () => {
    const shimBaseDir = createTrackedTempDir();

    const firstEnv = resolveKimiAcpPythonSelectorChildEnv({
      selector: 'poll',
      platform: 'linux',
      shimBaseDir,
    });
    const secondEnv = resolveKimiAcpPythonSelectorChildEnv({
      selector: 'poll',
      platform: 'linux',
      shimBaseDir,
    });

    const firstShimDir = firstEnv.PYTHONPATH?.split(delimiter)[0];
    const secondShimDir = secondEnv.PYTHONPATH?.split(delimiter)[0];
    expect(firstShimDir).toContain('kimi-acp-poll-selector-');
    expect(secondShimDir).toContain('kimi-acp-poll-selector-');
    expect(firstShimDir).not.toBe(secondShimDir);
    expect(existsSync(join(firstShimDir ?? '', 'sitecustomize.py'))).toBe(true);
    expect(existsSync(join(secondShimDir ?? '', 'sitecustomize.py'))).toBe(true);
  });

  it('does not alter PYTHONPATH for automatic mode or non-Linux platforms', () => {
    const shimBaseDir = createTrackedTempDir();

    expect(
      resolveKimiAcpPythonSelectorChildEnv({
        selector: 'auto',
        env: { PYTHONPATH: '/existing/pythonpath' },
        platform: 'linux',
        shimBaseDir,
      }),
    ).toEqual({ PYTHONPATH: '/existing/pythonpath' });

    expect(
      resolveKimiAcpPythonSelectorChildEnv({
        selector: 'poll',
        env: { PYTHONPATH: '/existing/pythonpath' },
        platform: 'darwin',
        shimBaseDir,
      }),
    ).toEqual({ PYTHONPATH: '/existing/pythonpath' });
  });
});
