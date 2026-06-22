import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { createTempDirSync } from '../../src/testkit/fs/tempDir';

function copyCliScriptFixture(options: {
  packageRoot: string;
  relativePath: string;
}) {
  const srcPath = resolve(process.cwd(), 'scripts', options.relativePath);
  const destPath = resolve(options.packageRoot, 'scripts', options.relativePath);
  mkdirSync(resolve(destPath, '..'), { recursive: true });
  cpSync(srcPath, destPath);
  return destPath;
}

describe('apps/cli published script surface', () => {
  it('keeps shipped build helpers self-contained outside the monorepo checkout', async () => {
    const packageRoot = createTempDirSync('happier-cli-published-script-surface-');
    try {
      writeFileSync(
        join(packageRoot, 'package.json'),
        `${JSON.stringify({ name: '@happier-dev/cli', version: '0.0.0', type: 'module' }, null, 2)}\n`,
        'utf8',
      );

      copyCliScriptFixture({ packageRoot, relativePath: 'optionalWorkspaceBundleLock.mjs' });
      copyCliScriptFixture({ packageRoot, relativePath: 'rmDirSafe.mjs' });
      const rmDistPath = copyCliScriptFixture({ packageRoot, relativePath: 'rmDist.mjs' });
      const syncPackageDistPath = copyCliScriptFixture({ packageRoot, relativePath: 'syncPackageDist.mjs' });

      mkdirSync(join(packageRoot, 'dist'), { recursive: true });
      mkdirSync(join(packageRoot, 'package-dist'), { recursive: true });
      writeFileSync(join(packageRoot, 'dist', 'index.mjs'), 'export const next = true;\n', 'utf8');
      writeFileSync(join(packageRoot, 'package-dist', 'index.mjs'), 'export const previous = true;\n', 'utf8');

      const { main } = await import(pathToFileURL(rmDistPath).href);
      const { syncPackageDist } = await import(pathToFileURL(syncPackageDistPath).href);

      const originalCwd = process.cwd();
      try {
        process.chdir(packageRoot);
        await main(['node', 'rmDist.mjs']);
      } finally {
        process.chdir(originalCwd);
      }

      expect(existsSync(join(packageRoot, 'dist', 'index.mjs'))).toBe(false);
      expect(existsSync(join(packageRoot, 'package-dist', 'index.mjs'))).toBe(true);

      mkdirSync(join(packageRoot, 'dist'), { recursive: true });
      writeFileSync(join(packageRoot, 'dist', 'index.mjs'), 'export const refreshed = true;\n', 'utf8');

      const result = syncPackageDist({ packageRoot });
      expect(result.packageDistDir).toBe(join(packageRoot, 'package-dist'));
      expect(existsSync(join(packageRoot, 'package-dist', 'index.mjs'))).toBe(true);
    } finally {
      rmSync(packageRoot, { recursive: true, force: true });
    }
  });
});
