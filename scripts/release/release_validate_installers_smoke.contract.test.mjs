import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveInstallersSmokeBinaryPath,
  resolveInstallersSmokeLifecycleSteps,
  resolveInstallersSmokePlan,
} from '../pipeline/release-validation/executors/installers-smoke.mjs';

test('installers-smoke resolves published channel installer plans by platform', () => {
  assert.deepEqual(
    resolveInstallersSmokePlan({
      platform: 'linux',
      source: { kind: 'published-channel', ref: 'stable' },
    }),
    {
      platform: 'linux',
      tag: 'cli-stable',
      installer: 'install.sh',
      binaryName: 'happier',
      installerEnv: {
        HAPPIER_WITH_DAEMON: '0',
      },
    },
  );

  assert.deepEqual(
    resolveInstallersSmokePlan({
      platform: 'darwin',
      source: { kind: 'published-channel', ref: 'preview' },
    }),
    {
      platform: 'darwin',
      tag: 'cli-preview',
      installer: 'install-preview.sh',
      binaryName: 'hprev',
      installerEnv: {
        HAPPIER_WITH_DAEMON: '0',
      },
    },
  );

  assert.deepEqual(
    resolveInstallersSmokePlan({
      platform: 'win32',
      source: { kind: 'published-channel', ref: 'dev' },
    }),
    {
      platform: 'win32',
      tag: 'cli-dev',
      installer: 'install-dev.ps1',
      binaryName: 'hdev.exe',
      installerEnv: {
        HAPPIER_WITH_DAEMON: '0',
      },
    },
  );
});

test('installers-smoke resolves published rolling and versioned tags to the matching installer surface', () => {
  assert.deepEqual(
    resolveInstallersSmokePlan({
      platform: 'linux',
      source: { kind: 'published-tag', ref: 'cli-preview' },
    }),
    {
      platform: 'linux',
      tag: 'cli-preview',
      installer: 'install-preview.sh',
      binaryName: 'hprev',
      installerEnv: {
        HAPPIER_WITH_DAEMON: '0',
      },
    },
  );

  assert.deepEqual(
    resolveInstallersSmokePlan({
      platform: 'win32',
      source: { kind: 'published-tag', ref: 'cli-v0.2.4-dev.47.1' },
    }),
    {
      platform: 'win32',
      tag: 'cli-v0.2.4-dev.47.1',
      installer: 'install-dev.ps1',
      binaryName: 'hdev.exe',
      installerEnv: {
        HAPPIER_WITH_DAEMON: '0',
      },
    },
  );
});

test('installers-smoke rejects unsupported source kinds', () => {
  assert.throws(
    () =>
      resolveInstallersSmokePlan({
        platform: 'linux',
        source: { kind: 'local-build', ref: 'dist/release-assets/cli' },
      }),
    /supports only published-channel or published-tag/i,
  );
});

test('installers-smoke lifecycle steps include reinstall/check/uninstall where supported', () => {
  assert.deepEqual(resolveInstallersSmokeLifecycleSteps({ platform: 'linux' }), [
    'install',
    'version',
    'help',
    'check',
    'reinstall',
    'check',
    'uninstall',
  ]);
  assert.deepEqual(resolveInstallersSmokeLifecycleSteps({ platform: 'darwin' }), [
    'install',
    'version',
    'help',
    'check',
    'reinstall',
    'check',
    'uninstall',
  ]);
  assert.deepEqual(resolveInstallersSmokeLifecycleSteps({ platform: 'win32' }), [
    'install',
    'version',
    'help',
  ]);
});

test('installers-smoke resolves the managed binary path for each native installer surface', () => {
  assert.equal(
    resolveInstallersSmokeBinaryPath({
      platform: 'linux',
      installDir: '/tmp/happier-install',
      requestedBinDir: '/tmp/bin',
      binaryName: 'happier',
    }),
    '/tmp/bin/happier',
  );
  assert.equal(
    resolveInstallersSmokeBinaryPath({
      platform: 'darwin',
      installDir: '/tmp/happier-install',
      requestedBinDir: '/tmp/bin',
      binaryName: 'happier',
    }),
    '/tmp/bin/happier',
  );
  assert.equal(
    resolveInstallersSmokeBinaryPath({
      platform: 'win32',
      installDir: 'C:\\Users\\lee\\.happier',
      requestedBinDir: 'C:\\Users\\lee\\.local\\bin',
      binaryName: 'hdev.exe',
    }),
    'C:\\Users\\lee\\.local\\bin\\hdev.exe',
  );
});
