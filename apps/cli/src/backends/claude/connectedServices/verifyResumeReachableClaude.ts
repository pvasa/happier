import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { VerifyResumeReachableResult } from '@/backends/connectedServices/verifyResumeReachableTypes';
import { resolveConfiguredClaudeConfigDir } from '@/backends/claude/utils/resolveConfiguredClaudeConfigDir';

export const CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV =
  'HAPPIER_CONNECTED_SERVICES_LEGACY_CLAUDE_RESTART_SAME_HOME' as const;

function isLegacyClaudeConnectedServicesRollbackEnabled(env: NodeJS.ProcessEnv): boolean {
  return env[CLAUDE_CONNECTED_SERVICES_LEGACY_RESTART_SAME_HOME_ENV] === '1';
}

function normalizeVendorResumeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.includes('/') || trimmed.includes('\\')) return null;
  return trimmed;
}

export async function verifyResumeReachableClaude(params: Readonly<{
  vendorResumeId: string | null | undefined;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<VerifyResumeReachableResult> {
  const processEnv = params.processEnv ?? process.env;
  if (isLegacyClaudeConnectedServicesRollbackEnabled(processEnv)) {
    return { ok: true, resolvedPath: null };
  }

  const vendorResumeId = normalizeVendorResumeId(params.vendorResumeId);
  if (!vendorResumeId) {
    return { ok: false, reason: 'claude_session_not_in_native_store' };
  }

  const claudeConfigDir = resolveConfiguredClaudeConfigDir({ env: processEnv });
  const projectsDir = join(claudeConfigDir, 'projects');

  try {
    const projectEntries = await readdir(projectsDir, { withFileTypes: true });
    for (const entry of projectEntries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      const projectName = String(entry.name);
      const sessionPath = join(projectsDir, projectName, `${vendorResumeId}.jsonl`);
      try {
        const metadata = await stat(sessionPath);
        if (metadata.isFile()) {
          return { ok: true, resolvedPath: sessionPath };
        }
      } catch {
        // Ignore missing/unreadable file for this project and continue scanning others.
      }
    }
  } catch {
    return { ok: false, reason: 'claude_native_store_unreachable' };
  }

  return { ok: false, reason: 'claude_session_not_in_native_store' };
}
