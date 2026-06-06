import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdtemp, writeFile, mkdir, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import * as packModule from './pack.mjs';
import { analyzeTarList, findMonorepoRoot, resolvePackDirForComponent } from './pack.mjs';

test('analyzeTarList detects bundled workspace deps in tar listing', () => {
  const { hasAgents, hasCliCommon, hasProtocol } = analyzeTarList([
    'package/dist/index.mjs',
    'package/node_modules/@happier-dev/agents/package.json',
    'package/node_modules/@happier-dev/agents/dist/index.js',
    'package/node_modules/@happier-dev/cli-common/package.json',
    'package/node_modules/@happier-dev/protocol/package.json',
  ]);
  assert.equal(hasAgents, true);
  assert.equal(hasCliCommon, true);
  assert.equal(hasProtocol, true);
});

test('findMonorepoRoot finds nearest package.json + yarn.lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-test-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'monorepo' }));
    await writeFile(join(root, 'yarn.lock'), '# lock');
    await mkdir(join(root, 'packages', 'happy-cli'), { recursive: true });

    const nested = join(root, 'packages', 'happy-cli');
    const found = await findMonorepoRoot(nested);
    assert.equal(found, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolvePackDirForComponent maps monorepo root to apps/cli', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-test-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'monorepo' }));
    await writeFile(join(root, 'yarn.lock'), '# lock');
    await mkdir(join(root, 'apps', 'cli'), { recursive: true });

    const resolved = await resolvePackDirForComponent({
      component: 'happy-cli',
      componentDir: root,
      explicitDir: null,
    });
    assert.equal(resolve(resolved), resolve(join(root, 'apps', 'cli')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolvePackDirForComponent prefers explicitDir override', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-test-explicit-'));
  try {
    const explicit = join(root, 'custom-pack-dir');
    await mkdir(explicit, { recursive: true });
    const resolved = await resolvePackDirForComponent({
      component: 'happy-cli',
      componentDir: root,
      explicitDir: explicit,
    });
    assert.equal(resolve(resolved), resolve(explicit));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('createPackSandbox includes root workspace scripts required by workspace package builds', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-test-sandbox-scripts-'));
  let sandbox = null;
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'monorepo' }));
    await writeFile(join(root, 'yarn.lock'), '# lock');
    await mkdir(join(root, 'apps', 'cli'), { recursive: true });
    await mkdir(join(root, 'packages', 'agents'), { recursive: true });
    await mkdir(join(root, 'packages', 'cli-common'), { recursive: true });
    await mkdir(join(root, 'packages', 'connection-supervisor'), { recursive: true });
    await mkdir(join(root, 'packages', 'protocol'), { recursive: true });
    await mkdir(join(root, 'packages', 'release-runtime'), { recursive: true });
    await mkdir(join(root, 'packages', 'transfers'), { recursive: true });
    await mkdir(join(root, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(root, 'apps', 'stack', 'scripts', 'utils', 'workspaces'), { recursive: true });
    await mkdir(join(root, 'scripts', 'workspaces'), { recursive: true });
    await writeFile(
      join(root, 'apps', 'cli', 'package.json'),
      JSON.stringify({
        dependencies: {
          '@happier-dev/connection-supervisor': '0.0.0',
          '@happier-dev/transfers': '0.0.0',
        },
        bundledDependencies: ['@happier-dev/release-runtime'],
      }),
    );
    await writeFile(join(root, 'apps', 'stack', 'scripts', 'utils', 'workspaces', 'workspaceBundleLock.mjs'), 'export const lock = true;\n');
    await writeFile(join(root, 'scripts', 'workspaces', 'execYarnCommand.mjs'), 'export const sentinel = true;\n');
    await writeFile(join(root, 'packages', 'connection-supervisor', 'package.json'), JSON.stringify({ name: '@happier-dev/connection-supervisor' }));
    await writeFile(join(root, 'packages', 'release-runtime', 'package.json'), JSON.stringify({ name: '@happier-dev/release-runtime' }));
    await writeFile(join(root, 'packages', 'transfers', 'package.json'), JSON.stringify({ name: '@happier-dev/transfers' }));

    assert.equal(typeof packModule.createPackSandbox, 'function');
    sandbox = await packModule.createPackSandbox({ monorepoRoot: root, packageRelDir: 'apps/cli' });

    const copied = await readFile(join(sandbox, 'scripts', 'workspaces', 'execYarnCommand.mjs'), 'utf8');
    assert.match(copied, /sentinel/);
    const stackWorkspaceLock = await readFile(
      join(sandbox, 'apps', 'stack', 'scripts', 'utils', 'workspaces', 'workspaceBundleLock.mjs'),
      'utf8',
    );
    assert.match(stackWorkspaceLock, /lock/);
    assert.match(
      await readFile(join(sandbox, 'packages', 'connection-supervisor', 'package.json'), 'utf8'),
      /connection-supervisor/,
    );
    assert.match(await readFile(join(sandbox, 'packages', 'release-runtime', 'package.json'), 'utf8'), /release-runtime/);
    assert.match(await readFile(join(sandbox, 'packages', 'transfers', 'package.json'), 'utf8'), /transfers/);
    assert.equal((await lstat(join(sandbox, 'node_modules'))).isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    if (sandbox) await rm(sandbox, { recursive: true, force: true });
  }
});

test('buildPackEnvironment exposes the monorepo toolchain binaries to pack scripts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pack-test-env-'));
  try {
    const env = packModule.buildPackEnvironment({
      monorepoRoot: root,
      env: { PATH: '/usr/bin' },
    });

    assert.equal(env.PATH.split(':')[0], join(root, 'node_modules', '.bin'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('stack package exposes happier as a published binary', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.deepEqual(pkg.bin, {
    hstack: './bin/hstack.mjs',
    happier: './bin/happier.mjs',
  });
});

test('stack package excludes the WSREPL Lima test shims from published files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(Array.isArray(pkg.files), 'expected stack package to declare published files');
  assert.ok(
    pkg.files.includes('!scripts/provision/macos-lima-wsrepl-matrix.sh'),
    'expected WSREPL Lima matrix shim to be excluded from the published stack package',
  );
  assert.ok(
    pkg.files.includes('!scripts/provision/macos-lima-vm.sh'),
    'expected WSREPL Lima VM shim to be excluded from the published stack package',
  );
});

test('stack package keeps the Expo heap helper local to the packaged scripts tree', async () => {
  const commandMjs = await readFile(new URL('./utils/expo/command.mjs', import.meta.url), 'utf8');
  assert.match(commandMjs, /from '\.\/expoNodeHeapEnv\.mjs';/);
  assert.doesNotMatch(commandMjs, /scripts\/expo\/expoNodeHeapEnv\.mjs/);
});
