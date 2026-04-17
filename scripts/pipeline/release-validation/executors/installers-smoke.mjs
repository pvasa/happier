// @ts-check

import { access, chmod, copyFile, mkdtemp } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve, win32 as pathWin32 } from 'node:path';
import { tmpdir } from 'node:os';

import {
  resolvePublishedInstallerAsset,
  resolvePublishedInstallerAssetForTag,
} from '../../release/installers/catalog.mjs';

function assertNativePlatform(platform) {
  if (platform !== process.platform) {
    throw new Error(`installers-smoke must run natively on ${platform}; current runner platform is ${process.platform}`);
  }
}

/**
 * @param {'linux' | 'darwin' | 'win32'} platform
 * @param {string} installer
 */
function resolveCliSmokeBinaryName(platform, installer) {
  const baseName = installer.includes('install-dev')
    ? 'hdev'
    : installer.includes('install-preview')
      ? 'hprev'
      : 'happier';
  return platform === 'win32' ? `${baseName}.exe` : baseName;
}

/**
 * @param {{ platform: 'linux' | 'darwin' | 'win32'; source: { kind: string; ref: string } | null }} params
 */
export function resolveInstallersSmokePlan({ platform, source }) {
  if (!source) {
    throw new Error('installers-smoke requires --source published-channel|published-tag');
  }
  const resolved =
    source.kind === 'published-channel'
      ? resolvePublishedInstallerAsset({ platform, channel: source.ref })
      : source.kind === 'published-tag'
        ? resolvePublishedInstallerAssetForTag({ platform, tag: source.ref })
        : null;
  if (!resolved) {
    throw new Error('installers-smoke currently supports only published-channel or published-tag sources');
  }
  const { tag, installer } = resolved;
  return {
    platform,
    tag,
    installer,
    binaryName: resolveCliSmokeBinaryName(platform, installer),
    installerEnv: {
      HAPPIER_WITH_DAEMON: '0',
    },
  };
}

/**
 * @param {{ platform: 'linux' | 'darwin' | 'win32' }} params
 */
export function resolveInstallersSmokeLifecycleSteps({ platform }) {
  if (platform === 'win32') {
    return ['install', 'version', 'help'];
  }
  return ['install', 'version', 'help', 'check', 'reinstall', 'check', 'uninstall'];
}

/**
 * @param {{
 *   platform: 'linux' | 'darwin' | 'win32';
 *   installDir: string;
 *   requestedBinDir: string;
 *   binaryName: string;
 * }} params
 */
export function resolveInstallersSmokeBinaryPath({ platform, installDir, requestedBinDir, binaryName }) {
  if (platform === 'win32') {
    return pathWin32.join(requestedBinDir, binaryName);
  }
  return join(requestedBinDir, binaryName);
}

/**
 * @param {{ tag: string; repoSlug: string; token?: string }} params
 */
async function checkGitHubReleaseTagExists({ tag, repoSlug, token }) {
  const url = `https://api.github.com/repos/${repoSlug}/releases/tags/${tag}`;
  const headers = {
    'X-GitHub-Api-Version': '2022-11-28',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
  const response = await fetch(url, { headers });
  if (response.status === 404) {
    return false;
  }
  if (!response.ok) {
    throw new Error(`failed to probe release tag ${tag}: http ${response.status}`);
  }
  return true;
}

/**
 * @param {{
 *   repoRoot: string;
 *   platform: 'linux' | 'darwin' | 'win32';
 *   source: { kind: string; ref: string } | null;
 * }} params
 */
export async function runInstallersSmokeValidation({ repoRoot, platform, source }) {
  assertNativePlatform(platform);

  const plan = resolveInstallersSmokePlan({ platform, source });
  const repoSlug = String(process.env.GITHUB_REPOSITORY ?? '').trim();
  if (!repoSlug) {
    throw new Error('GITHUB_REPOSITORY is required for installers-smoke');
  }

  const token = String(process.env.GITHUB_TOKEN ?? process.env.HAPPIER_GITHUB_TOKEN ?? '').trim() || undefined;
  const tagExists = await checkGitHubReleaseTagExists({ tag: plan.tag, repoSlug, token });
  if (!tagExists) {
    const skipped = {
      ok: true,
      skipped: true,
      reason: `release tag not found: ${plan.tag}`,
      tag: plan.tag,
      installer: plan.installer,
    };
    console.log(JSON.stringify(skipped, null, 2));
    return skipped;
  }

  const scratch = await mkdtemp(join(tmpdir(), 'happier-installers-smoke-'));
  const installDir = join(scratch, '.happier');
  const requestedBinDir = join(scratch, '.local', 'bin');
  const installerSourcePath = resolve(repoRoot, 'apps', 'website', 'public', plan.installer);
  const installerScratchPath = join(scratch, plan.installer);
  await copyFile(installerSourcePath, installerScratchPath);

  /** @type {NodeJS.ProcessEnv} */
  const env = {
    ...process.env,
    HAPPIER_GITHUB_TOKEN: token ?? process.env.HAPPIER_GITHUB_TOKEN ?? '',
    HAPPIER_NONINTERACTIVE: '1',
    HAPPIER_INSTALL_DIR: installDir,
    HAPPIER_BIN_DIR: requestedBinDir,
    ...plan.installerEnv,
  };

  const lifecycleSteps = resolveInstallersSmokeLifecycleSteps({ platform });

  /**
   * @param {string[]} args
   */
  function runInstaller(args = []) {
    if (platform === 'win32') {
      execFileSync('pwsh', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installerScratchPath, ...args], {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
      });
      return;
    }

    execFileSync('bash', [installerScratchPath, ...args], {
      cwd: repoRoot,
      env,
      stdio: 'inherit',
    });
  }

  if (platform === 'win32') {
    env.HAPPIER_NO_PATH_UPDATE = env.HAPPIER_NO_PATH_UPDATE ?? '1';
  } else {
    env.HOME = scratch;
    env.HAPPIER_NO_PATH_UPDATE = env.HAPPIER_NO_PATH_UPDATE ?? '1';
    await chmod(installerScratchPath, 0o755);
  }

  const binaryPath = resolveInstallersSmokeBinaryPath({
    platform,
    installDir,
    requestedBinDir,
    binaryName: plan.binaryName,
  });

  for (const step of lifecycleSteps) {
    if (step === 'install') {
      runInstaller();
      continue;
    }
    if (step === 'check') {
      runInstaller(['--check']);
      continue;
    }
    if (step === 'reinstall') {
      runInstaller(['--reinstall']);
      continue;
    }
    if (step === 'uninstall') {
      runInstaller(['--uninstall']);
      continue;
    }
    if (step === 'version') {
      execFileSync(binaryPath, ['--version'], {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
      });
      continue;
    }
    if (step === 'help') {
      execFileSync(binaryPath, ['--help'], {
        cwd: repoRoot,
        env,
        stdio: 'ignore',
      });
      continue;
    }
    throw new Error(`Unsupported installers-smoke lifecycle step: ${step}`);
  }

  if (lifecycleSteps.includes('uninstall')) {
    await access(binaryPath)
      .then(() => {
        throw new Error(`installers-smoke expected uninstall to remove ${binaryPath}`);
      })
      .catch((error) => {
        if (/** @type {{ code?: string }} */ (error).code !== 'ENOENT') {
          throw error;
        }
      });
  }

  const result = {
    ok: true,
    skipped: false,
    tag: plan.tag,
    installer: plan.installer,
    binaryPath,
    lifecycleSteps,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}
