import { basename, dirname, join } from 'node:path';

import { projectPath } from '@/projectPath';

function normalizePathLike(pathLike: string): string {
  return String(pathLike ?? '').trim().replaceAll('\\', '/');
}

function isRuntimeExecutablePath(pathLike: string): boolean {
  const base = basename(normalizePathLike(pathLike)).toLowerCase();
  return base === 'node' || base === 'node.exe' || base === 'bun' || base === 'bun.exe';
}

function resolveCliInstallRootNameFromShim(executableBase: string): string | null {
  const normalizedBase = executableBase.toLowerCase().replace(/\.exe$/u, '');
  if (normalizedBase === 'happier') return 'cli';
  if (normalizedBase === 'hprev') return 'cli-preview';
  if (normalizedBase === 'hdev') return 'cli-dev';
  return null;
}

export function isSelfContainedCliBinary(execPath: string = process.execPath): boolean {
  const normalized = normalizePathLike(execPath);
  if (!normalized) return false;
  return !isRuntimeExecutablePath(normalized);
}

function resolveInstalledCliRuntimeRootPath(execPath: string): string | null {
  const normalized = normalizePathLike(execPath);
  if (!normalized || !isSelfContainedCliBinary(normalized)) {
    return null;
  }

  const installRootName = resolveCliInstallRootNameFromShim(basename(normalized));
  if (!installRootName) {
    return null;
  }

  const binaryDir = dirname(normalized);
  if (basename(binaryDir).toLowerCase() !== 'bin') {
    return null;
  }

  return join(dirname(binaryDir), installRootName, 'current');
}

export function resolveCliRuntimeRootPath(execPath: string = process.execPath): string {
  const installedCliRuntimeRoot = resolveInstalledCliRuntimeRootPath(execPath);
  if (installedCliRuntimeRoot) {
    return installedCliRuntimeRoot;
  }

  const normalizedExecPath = normalizePathLike(execPath);
  if (isSelfContainedCliBinary(normalizedExecPath)) {
    return dirname(normalizedExecPath);
  }
  return projectPath();
}

export function resolveCliRuntimeAssetPath(...segments: string[]): string {
  return join(resolveCliRuntimeRootPath(), ...segments);
}
