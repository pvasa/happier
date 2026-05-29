import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { verifyResumeReachableClaude } from './verifyResumeReachableClaude';

const CLAUDE_ROLLBACK_ENV = 'HAPPIER_CONNECTED_SERVICES_LEGACY_CLAUDE_RESTART_SAME_HOME';

const claudeEnvKeys = [
  CLAUDE_ROLLBACK_ENV,
  'CLAUDE_CONFIG_DIR',
  'HAPPIER_CLAUDE_CONFIG_DIR',
  'HOME',
  'USERPROFILE',
] as const;

const originalClaudeEnv = new Map<string, string | undefined>(
  claudeEnvKeys.map((key) => [key, process.env[key]]),
);

function restoreClaudeEnv(): void {
  for (const [key, value] of originalClaudeEnv) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe('verifyResumeReachableClaude', () => {
  afterEach(() => {
    restoreClaudeEnv();
  });

  it('returns ok=true when a matching session file exists in CLAUDE_CONFIG_DIR projects', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-reachable-'));
    try {
      await mkdir(join(claudeConfigDir, 'projects', 'project-1'), { recursive: true });
      const sessionPath = join(claudeConfigDir, 'projects', 'project-1', 'vendor-session-1.jsonl');
      await writeFile(sessionPath, '{}\n');
      process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

      await expect(verifyResumeReachableClaude({
        vendorResumeId: 'vendor-session-1',
      })).resolves.toEqual({
        ok: true,
        resolvedPath: sessionPath,
      });
    } finally {
      await rm(claudeConfigDir, { recursive: true, force: true });
    }
  });

  it('returns claude_session_not_in_native_store when no matching session file exists', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-missing-'));
    try {
      await mkdir(join(claudeConfigDir, 'projects', 'project-1'), { recursive: true });
      process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;

      await expect(verifyResumeReachableClaude({
        vendorResumeId: 'vendor-session-1',
      })).resolves.toEqual({
        ok: false,
        reason: 'claude_session_not_in_native_store',
      });
    } finally {
      await rm(claudeConfigDir, { recursive: true, force: true });
    }
  });

  it('returns claude_native_store_unreachable when the native projects directory is missing', async () => {
    const claudeConfigDir = await mkdtemp(join(tmpdir(), 'happier-claude-unreachable-'));
    try {
      process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
      await expect(verifyResumeReachableClaude({
        vendorResumeId: 'vendor-session-1',
      })).resolves.toEqual({
        ok: false,
        reason: 'claude_native_store_unreachable',
      });
    } finally {
      await rm(claudeConfigDir, { recursive: true, force: true });
    }
  });

  it('short-circuits to ok=true when the Claude rollback env flag is enabled', async () => {
    process.env[CLAUDE_ROLLBACK_ENV] = '1';
    await expect(verifyResumeReachableClaude({
      vendorResumeId: null,
    })).resolves.toEqual({
      ok: true,
      resolvedPath: null,
    });
  });
});
