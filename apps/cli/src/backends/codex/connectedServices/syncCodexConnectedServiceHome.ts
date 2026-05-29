import { mkdir, readdir } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';

import {
  resolveConnectedServicesProviderStateSharingPolicyV1,
  type AccountSettings,
  type ConnectedServicesProviderStateSharingPolicyV1,
} from '@happier-dev/protocol';

import { codexConnectedServiceStateSharingDescriptor } from '@/backends/codex/connectedServices/codexConnectedServiceStateSharingDescriptor';
import { resolveConfiguredCodexHome } from '@/backends/codex/utils/resolveConfiguredCodexHome';
import { ConnectedServiceSharedStateLinkUnavailableError } from '@/daemon/connectedServices/stateSharing/createSharedStateLink';
import { withConnectedServiceStateSharingDestinationLock } from '@/daemon/connectedServices/stateSharing/connectedServiceStateSharingLock';
import {
  readConnectedServiceStateSharingManifest,
  removeLegacyConnectedServiceStateSharingManifest,
  writeConnectedServiceStateSharingManifest,
} from '@/daemon/connectedServices/stateSharing/connectedServiceStateSharingManifest';
import { applyConnectedServiceStateSharingDescriptor } from '@/daemon/connectedServices/stateSharing/applyConnectedServiceStateSharingDescriptor';
import type { ConnectedServiceSessionFileImportDetail } from '@/daemon/connectedServices/stateSharing/importConnectedServiceSessionFiles';

import { resolveConfiguredCodexSqliteHome } from './codexStateFileNames';

const CODEX_IMPORTABLE_SESSION_HOME_ENTRIES = Object.freeze([
  'sessions',
  'archived_sessions',
] as const);

type CodexStateMode = 'shared' | 'isolated';

export type CodexConnectedServiceStateSharingDiagnostic = Readonly<{
  code: 'state_symlink_unavailable';
  providerId: 'codex';
  requestedStateMode: 'shared';
  effectiveStateMode: 'isolated';
  entryName: string;
  reason: 'symlink_unavailable';
  fsCode?: string;
}>;

export type SyncCodexConnectedServiceHomeResult = Readonly<{
  providerId: 'codex';
  requestedStateMode: CodexStateMode;
  effectiveStateMode: CodexStateMode;
  diagnostics: readonly CodexConnectedServiceStateSharingDiagnostic[];
}>;

function resolveCodexHomeSharingSettings(
  settingsLike: AccountSettings | Readonly<Record<string, unknown>> | null | undefined,
): ConnectedServicesProviderStateSharingPolicyV1 {
  return resolveConnectedServicesProviderStateSharingPolicyV1(
    settingsLike?.connectedServicesProviderStateSharingSettingsV1,
    'codex',
  );
}

function dedupeEntries(entries: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry || seen.has(entry)) continue;
    seen.add(entry);
    result.push(entry);
  }
  return result;
}

function resolveCodexStateDynamicEntryPatterns(): Readonly<Record<string, RegExp>> {
  const patterns: Record<string, RegExp> = {};
  for (const [patternId, entryPattern] of Object.entries(codexConnectedServiceStateSharingDescriptor.dynamicEntryPatterns ?? {})) {
    if (entryPattern.scope !== 'state') continue;
    try {
      patterns[patternId] = new RegExp(entryPattern.pattern);
    } catch {
      continue;
    }
  }
  return patterns;
}

async function listCodexDynamicStateEntries(
  root: string,
  dynamicPatterns: Readonly<Record<string, RegExp>>,
): Promise<readonly string[]> {
  const entries: string[] = [];
  const patterns = Object.values(dynamicPatterns);
  if (patterns.length === 0) return entries;
  let names: string[];
  try {
    names = await readdir(root);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') return entries;
    throw error;
  }
  for (const name of names) {
    if (patterns.some((pattern) => pattern.test(name))) entries.push(name);
  }
  return entries;
}

async function resolveCodexConfigEntryNames(sourceCodexHome: string): Promise<readonly string[]> {
  const names: string[] = [];
  for (const descriptorEntry of codexConnectedServiceStateSharingDescriptor.config.entries) {
    if (descriptorEntry.path !== 'skills') {
      names.push(descriptorEntry.path);
      continue;
    }
    const skillsPath = join(sourceCodexHome, 'skills');
    let childNames: string[];
    try {
      childNames = await readdir(skillsPath);
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err?.code === 'ENOENT') continue;
      throw error;
    }
    for (const childName of childNames) {
      names.push(join('skills', childName));
    }
  }
  return dedupeEntries(names);
}

function toStateSymlinkUnavailableDiagnostic(
  error: ConnectedServiceSharedStateLinkUnavailableError,
): CodexConnectedServiceStateSharingDiagnostic {
  return {
    code: 'state_symlink_unavailable',
    providerId: 'codex',
    requestedStateMode: 'shared',
    effectiveStateMode: 'isolated',
    entryName: error.entryName,
    reason: 'symlink_unavailable',
    ...(error.fsCode ? { fsCode: error.fsCode } : {}),
  };
}

function resolveSourceCodexHome(params: Readonly<{
  destinationCodexHome: string;
  processEnv: NodeJS.ProcessEnv;
}>): string | null {
  const sourceCodexHome = resolve(resolveConfiguredCodexHome(params.processEnv));
  if (sourceCodexHome === resolve(params.destinationCodexHome)) return null;
  return sourceCodexHome;
}

function resolveVendorResumeIdFromImportedRollout(
  detail: ConnectedServiceSessionFileImportDetail,
): string | null {
  const candidates = [basename(detail.sourcePath), basename(detail.destinationPath), detail.relativePath];
  for (const candidate of candidates) {
    const match = /-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i.exec(candidate);
    if (match) return match[1];
  }
  return null;
}

export async function syncCodexConnectedServiceHome(params: Readonly<{
  destinationCodexHome: string;
  accountSettings?: AccountSettings | Readonly<Record<string, unknown>> | null;
  processEnv?: NodeJS.ProcessEnv;
}>): Promise<SyncCodexConnectedServiceHomeResult> {
  return await withConnectedServiceStateSharingDestinationLock(params.destinationCodexHome, async () => {
    const settings = resolveCodexHomeSharingSettings(params.accountSettings ?? null);
    const processEnv = params.processEnv ?? process.env;
    const sourceCodexHome = resolveSourceCodexHome({
      destinationCodexHome: params.destinationCodexHome,
      processEnv,
    });
    if (!sourceCodexHome) {
      return {
        providerId: 'codex',
        requestedStateMode: settings.stateMode,
        effectiveStateMode: settings.stateMode,
        diagnostics: [],
      };
    }

    const sourceSqliteHome = resolve(resolveConfiguredCodexSqliteHome(processEnv));
    const dynamicStatePatterns = resolveCodexStateDynamicEntryPatterns();
    const sqliteStatePattern = dynamicStatePatterns.sqlite ?? null;
    await mkdir(params.destinationCodexHome, { recursive: true });
    const manifest = await readConnectedServiceStateSharingManifest(params.destinationCodexHome);
    const configEntryNames = await resolveCodexConfigEntryNames(sourceCodexHome);
    const stateEntryNames = settings.stateMode === 'shared'
      ? dedupeEntries([
        ...codexConnectedServiceStateSharingDescriptor.state.entries.map((entry) => entry.path),
        ...await listCodexDynamicStateEntries(sourceSqliteHome, dynamicStatePatterns),
        ...await listCodexDynamicStateEntries(params.destinationCodexHome, dynamicStatePatterns),
      ])
      : dedupeEntries([
        ...codexConnectedServiceStateSharingDescriptor.state.entries.map((entry) => entry.path),
        ...await listCodexDynamicStateEntries(params.destinationCodexHome, dynamicStatePatterns),
      ]);

    const applyResult = await applyConnectedServiceStateSharingDescriptor({
      descriptor: codexConnectedServiceStateSharingDescriptor,
      nativeSourceContext: {
        sourceRoot: sourceCodexHome,
        sourceEnv: processEnv as Record<string, string>,
      },
      target: {
        targetMaterializedRoot: params.destinationCodexHome,
        targetMaterializedEnv: {},
      },
      configMode: settings.configMode,
      requestedStateMode: settings.stateMode,
      effectiveStateMode: settings.stateMode,
      cwd: process.cwd(),
      existingManifest: manifest,
      configEntryNames,
      stateEntryNames,
      resolveStateSourceRoot: (entryName) => sqliteStatePattern?.test(entryName) ? sourceSqliteHome : sourceCodexHome,
      mapStateSymlinkUnavailableDiagnostic: (error) => toStateSymlinkUnavailableDiagnostic(error),
      sessionImportRoots: settings.stateMode === 'shared'
        ? CODEX_IMPORTABLE_SESSION_HOME_ENTRIES.map((entryName) => ({
          sourceRoot: join(params.destinationCodexHome, entryName),
          destinationRoot: join(sourceCodexHome, entryName),
          includeFile: (relativePath: string) => relativePath.toLowerCase().endsWith('.jsonl'),
        }))
        : [],
      resolveVendorResumeIdFromImportedFile: resolveVendorResumeIdFromImportedRollout,
      providerLabel: 'Codex',
    });

    await writeConnectedServiceStateSharingManifest(params.destinationCodexHome, applyResult.manifest);
    await removeLegacyConnectedServiceStateSharingManifest(params.destinationCodexHome);

    return {
      providerId: 'codex',
      requestedStateMode: settings.stateMode,
      effectiveStateMode: applyResult.manifest.effectiveStateMode,
      diagnostics: applyResult.diagnostics as readonly CodexConnectedServiceStateSharingDiagnostic[],
    };
  }, { providerId: 'codex' });
}
