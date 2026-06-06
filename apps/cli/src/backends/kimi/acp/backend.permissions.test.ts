import { afterEach, describe, expect, it } from 'vitest';
import { delimiter, dirname } from 'node:path';

import type { PermissionMode } from '@/api/types';
import { createEnvKeyScope } from '@/testkit/env/envScope';
import { writeExecutableShimSync } from '@/testkit/fs/executableShim';
import { createTempDirSync, removeTempDirSync } from '@/testkit/fs/tempDir';
import { createKimiBackend } from './backend';

type AcpBackendLike = {
  options: {
    args: string[];
  };
};

const envKeys = [
  'HOME',
  'PATH',
  'PYTHONPATH',
  'HAPPIER_HOME_DIR',
  'HAPPIER_KIMI_PATH',
  'HAPPIER_KIMI_ACP_SELECTOR',
  'HAPPIER_TEST_SECRET',
] as const;
const TEMP_DIRS = new Set<string>();
let envScope = createEnvKeyScope(envKeys);

function createFakeBin(name: string): string {
  const dir = createTempDirSync('happier-kimi-backend-');
  TEMP_DIRS.add(dir);
  const isWindows = process.platform === 'win32';
  return writeExecutableShimSync({
    dir,
    fileName: isWindows ? `${name}.cmd` : name,
    contents: isWindows ? '@echo off\r\necho ok\r\n' : '#!/bin/sh\necho ok\n',
  });
}

afterEach(() => {
  envScope.restore();
  envScope = createEnvKeyScope(envKeys);
  for (const dir of TEMP_DIRS) removeTempDirSync(dir);
  TEMP_DIRS.clear();
});

function getArgs(permissionMode: PermissionMode): string[] {
  process.env.PATH = '';
  process.env.HAPPIER_KIMI_PATH = createFakeBin('kimi');
  const backend = createKimiBackend({
    cwd: '/tmp',
    env: {},
    permissionMode,
  }) as unknown as AcpBackendLike;
  return backend.options.args;
}

function readAgentFilePath(args: string[]): string | null {
  const index = args.indexOf('--agent-file');
  if (index < 0) return null;
  return args[index + 1] ?? null;
}

describe('Kimi ACP backend permissions', () => {
  it('fails closed when the Kimi CLI is unavailable', () => {
    const homeDir = createTempDirSync('happier-kimi-empty-home-');
    TEMP_DIRS.add(homeDir);
    process.env.HOME = homeDir;
    process.env.HAPPIER_HOME_DIR = homeDir;
    process.env.PATH = '';
    delete process.env.HAPPIER_KIMI_PATH;

    expect(() => createKimiBackend({ cwd: '/tmp', env: {} })).toThrow(/system install/i);
  });

  it.each([
    { mode: 'default', hasYolo: false, hasAgentFile: false },
    { mode: 'acceptEdits', hasYolo: false, hasAgentFile: false },
    { mode: 'safe-yolo', hasYolo: false, hasAgentFile: false },
    { mode: 'yolo', hasYolo: true, hasAgentFile: false },
    { mode: 'bypassPermissions', hasYolo: true, hasAgentFile: false },
    { mode: 'read-only', hasYolo: false, hasAgentFile: true },
    { mode: 'plan', hasYolo: false, hasAgentFile: true },
  ])('maps permissionMode="$mode" to expected Kimi CLI args', ({ mode, hasYolo, hasAgentFile }) => {
    const args = getArgs(mode as PermissionMode);

    expect(args.slice(0, 2)).toEqual(['--work-dir', '/tmp']);
    expect(args.includes('--yolo')).toBe(hasYolo);
    expect(args.includes('--agent-file')).toBe(hasAgentFile);
    expect(args[args.length - 1]).toBe('acp');

    const agentFilePath = readAgentFilePath(args);
    if (hasAgentFile) {
      expect(agentFilePath).toBeTruthy();
      expect(agentFilePath).toContain('readonly-agent.yaml');
    } else {
      expect(agentFilePath).toBeNull();
    }
  });

  it('resolves the CLI from options.env PATH when process PATH is empty', () => {
    process.env.PATH = '';
    delete process.env.HAPPIER_KIMI_PATH;
    const binPath = createFakeBin('kimi');

    const backend = createKimiBackend({
      cwd: '/tmp',
      env: { PATH: dirname(binPath) },
      permissionMode: 'default',
    }) as unknown as { options: { command: string } };

    expect(backend.options.command).toBe(binPath);
  });

  it('preserves inherited PYTHONPATH when the poll selector shim is enabled', () => {
    const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    expect(originalPlatformDescriptor).toBeDefined();

    try {
      Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'linux' });
      process.env.PATH = '';
      process.env.PYTHONPATH = '/inherited/pythonpath';
      process.env.HAPPIER_TEST_SECRET = 'do-not-forward';
      process.env.HAPPIER_KIMI_PATH = createFakeBin('kimi');

      const backend = createKimiBackend({
        cwd: '/tmp',
        env: {},
        permissionMode: 'default',
        kimiAcpPythonSelector: 'poll',
      }) as unknown as { options: { env: NodeJS.ProcessEnv } };

      const pythonPathEntries = backend.options.env.PYTHONPATH?.split(delimiter) ?? [];
      expect(pythonPathEntries[0]).toContain('kimi-acp-poll-selector');
      expect(pythonPathEntries).toContain('/inherited/pythonpath');
      expect(backend.options.env.HAPPIER_TEST_SECRET).toBeUndefined();
    } finally {
      if (originalPlatformDescriptor) {
        Object.defineProperty(process, 'platform', originalPlatformDescriptor);
      }
    }
  });

  it('does not attach MCP servers (Kimi ACP does not support MCP servers)', () => {
    process.env.PATH = '';
    process.env.HAPPIER_KIMI_PATH = createFakeBin('kimi');
    const backend = createKimiBackend({
      cwd: '/tmp',
      env: {},
      permissionMode: 'default',
      mcpServers: {
        happier: { command: '/bin/echo', args: ['noop'] },
      },
    }) as unknown as { options: { mcpServers?: Record<string, unknown> } };

    expect(backend.options.mcpServers).toBeUndefined();
  });
});
