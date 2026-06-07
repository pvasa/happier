import { existsSync } from 'node:fs';
import { chmod, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { CommandInvocation } from '@happier-dev/cli-common/process';
import { resolveWindowsCommandInvocation } from '@happier-dev/cli-common/process';
import { HAPPIER_BASE_SYSTEM_PROMPT_V1 } from '@happier-dev/protocol';

import { resolveClaudeSdkPermissionModeFromEnhancedMode } from '../utils/permissionMode';
import { getClaudeSystemPrompt } from '../utils/systemPrompt';
import { isClaudeCliJavaScriptFile, resolveClaudeCliPath } from '../utils/resolveClaudeCliPath';
import { ensureClaudeJsRuntimeExecutable } from '../utils/ensureClaudeJsRuntimeExecutable';
import { buildClaudeSubprocessEnv } from '../spawn/buildClaudeSubprocessEnv';
import { stripNestedSessionDetectionEnv } from '@/utils/processEnv/stripNestedSessionDetectionEnv';
import { buildMissingJavaScriptRuntimeMessage } from '@/runtime/js/buildMissingJavaScriptRuntimeMessage';
import { isEmbeddedBunBundlePath } from '@/runtime/js/isEmbeddedBunBundlePath';
import { resolveCliRuntimeAssetPath } from '@/runtime/assets/resolveCliRuntimeAssetPath';
import { isAllowedExactEnvKey } from '@/utils/env/isAllowedExactEnvKey';
import {
  readConnectedServiceMaterializedEnvKeysFromEnv,
} from '@/daemon/connectedServices/connectedServiceChildEnvironment';
import type { EnhancedMode } from '../loop';
import {
  resolveClaudeTerminalCliOptions,
  type ClaudeTerminalCliOptionsDiagnostic,
} from '../cli/terminalOptions';
import { claudeCliFlagCanConsumeValue } from '../cli/flagArity';

export type ClaudeUnifiedTerminalSpawn = Readonly<{
  spawnArgv: readonly string[];
  spawnEnv: Readonly<Record<string, string>>;
  launchSpecPath?: string | undefined;
}>;

export class ClaudeUnifiedTerminalUnsupportedOptionError extends Error {
  readonly code = 'claude_unified_terminal_unsupported_option';
  readonly diagnostics: readonly ClaudeTerminalCliOptionsDiagnostic[];

  constructor(diagnostics: readonly ClaudeTerminalCliOptionsDiagnostic[]) {
    super('Claude unified terminal options include values that cannot be mapped safely to the terminal runtime.');
    this.name = 'ClaudeUnifiedTerminalUnsupportedOptionError';
    this.diagnostics = diagnostics;
  }
}

type ClaudeUnifiedTerminalSpawnDeps = Readonly<{
  resolveClaudeCliPath: () => string;
  isClaudeCliJavaScriptFile: (path: string) => boolean;
  ensureClaudeJsRuntimeExecutable: () => Promise<string | null>;
  claudeLocalLauncherPath: string;
  terminalLaunchSpecRunnerPath: string;
  resolveCommandInvocation: (params: Readonly<{
    command: string;
    args: readonly string[];
    env: NodeJS.ProcessEnv;
  }>) => CommandInvocation;
}>;

type ClaudeUnifiedTerminalSpawnInput<Mode extends EnhancedMode = EnhancedMode> = Readonly<{
  path: string;
  first: Readonly<{ message: string; mode: Mode }>;
  claudeArgs?: readonly string[] | undefined;
  hookSettingsPath?: string | undefined;
  hookPluginDir?: string | null | undefined;
  happierMcpConfigJson?: string | undefined;
  envOverlay?: Readonly<Record<string, string>> | undefined;
  systemPromptText?: string | null | undefined;
  deps?: Partial<ClaudeUnifiedTerminalSpawnDeps> | undefined;
}>;

function resolveFallbackSystemPrompt(): string {
  const providerBlocks = getClaudeSystemPrompt();
  return providerBlocks.trim().length > 0
    ? `${HAPPIER_BASE_SYSTEM_PROMPT_V1}\n\n${providerBlocks}`
    : HAPPIER_BASE_SYSTEM_PROMPT_V1;
}

const managedClaudeArgFlagsWithValue = new Set([
  '--model',
  '--effort',
  '--fallback-model',
  '--system-prompt',
  '--append-system-prompt',
]);

const managedClaudeArgFlagsWithoutValue = new Set([
  '--strict-mcp-config',
]);

function appendClaudeArgsWithoutManagedPromptAndSpawnMode(
  target: string[],
  claudeArgs: readonly string[] | undefined,
): void {
  const input = claudeArgs ?? [];
  for (let index = 0; index < input.length; index += 1) {
    const arg = input[index];
    if (typeof arg !== 'string') continue;
    if (arg === '--dangerously-skip-permissions') continue;
    if (arg === '--print' || arg === '-p') {
      const next = index + 1 < input.length ? input[index + 1] : undefined;
      if (typeof next === 'string' && !next.startsWith('-')) index += 1;
      continue;
    }
    if (arg.startsWith('--print=') || arg.startsWith('-p=')) continue;
    if (arg === '--permission-mode') {
      if (index + 1 < input.length) index += 1;
      continue;
    }
    if (arg.startsWith('--permission-mode=')) continue;
    if (managedClaudeArgFlagsWithoutValue.has(arg)) continue;
    if ([...managedClaudeArgFlagsWithValue].some((flag) => arg.startsWith(`${flag}=`))) continue;
    if (managedClaudeArgFlagsWithValue.has(arg)) {
      if (index + 1 < input.length) index += 1;
      continue;
    }
    if (!arg.startsWith('-')) continue;
    target.push(arg);
    if (claudeCliFlagCanConsumeValue(arg) && index + 1 < input.length) {
      const value = input[index + 1];
      if (typeof value === 'string') {
        target.push(value);
        index += 1;
      }
    }
  }
}

function buildClaudeArgs<Mode extends EnhancedMode>(input: ClaudeUnifiedTerminalSpawnInput<Mode>): string[] {
  const args: string[] = [];
  const terminalOptions = resolveClaudeTerminalCliOptions({
    mode: input.first.mode,
    claudeArgs: input.claudeArgs,
  });
  if (terminalOptions.diagnostics.length > 0) {
    throw new ClaudeUnifiedTerminalUnsupportedOptionError(terminalOptions.diagnostics);
  }
  const systemPromptText = typeof input.systemPromptText === 'string' ? input.systemPromptText.trim() : '';
  const appendSystemPrompt = terminalOptions.appendSystemPrompt.trim();
  if (terminalOptions.customSystemPrompt.trim()) {
    args.push('--system-prompt', terminalOptions.customSystemPrompt.trim());
  }
  args.push(
    '--append-system-prompt',
    [systemPromptText || resolveFallbackSystemPrompt(), appendSystemPrompt].filter(Boolean).join('\n\n'),
  );
  appendClaudeArgsWithoutManagedPromptAndSpawnMode(args, input.claudeArgs);
  args.push(...terminalOptions.extraArgs);

  if (input.hookPluginDir) {
    args.push('--plugin-dir', input.hookPluginDir);
  }
  if (input.hookSettingsPath) {
    args.push('--settings', input.hookSettingsPath);
  }
  if (typeof input.happierMcpConfigJson === 'string' && input.happierMcpConfigJson.trim().length > 0) {
    args.push('--mcp-config', input.happierMcpConfigJson.trim());
  }

  const permissionMode = resolveClaudeSdkPermissionModeFromEnhancedMode(input.first.mode);
  if (permissionMode !== 'default') {
    args.push('--permission-mode', permissionMode);
  }
  return args;
}

function readMaterializedEnvKeySet(env: Pick<NodeJS.ProcessEnv, string>): Set<string> {
  return new Set(readConnectedServiceMaterializedEnvKeysFromEnv(env));
}

function buildClaudeEnv(envOverlay: Readonly<Record<string, string>> | undefined): Record<string, string> {
  const env = stripNestedSessionDetectionEnv(buildClaudeSubprocessEnv({
    envOverlay: {
      DISABLE_AUTOUPDATER: '1',
      IS_DEMO: '1',
      ...(envOverlay ?? {}),
    },
  }));
  return Object.fromEntries(
    Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function buildTerminalLauncherProcessEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const allowExact = new Set([
    'PATH',
    'HOME',
    'USER',
    'LOGNAME',
    'SHELL',
    'TERM',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TMPDIR',
    'TEMP',
    'TMP',
    'FORCE_COLOR',
    'NO_COLOR',
    'COLORTERM',
    '__CF_USER_TEXT_ENCODING',
  ]);
  if (process.platform === 'win32') {
    for (const key of ['USERPROFILE', 'USERNAME', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'ComSpec', 'PATHEXT', 'WINDIR']) {
      allowExact.add(key);
    }
  }

  const allowPrefixes = ['LC_', 'TERM_', 'XDG_', 'HAPPIER_E2E_', 'HAPPY_E2E_'];
  const out: Record<string, string> = Object.create(null);
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value !== 'string') continue;
    if (isAllowedExactEnvKey(key, allowExact) || allowPrefixes.some((prefix) => key.startsWith(prefix))) {
      out[key] = value;
    }
  }
  return out;
}

type TerminalLaunchSpec = Readonly<{
  command: string;
  args: readonly string[];
  cwd: string;
  env: Readonly<Record<string, string>>;
  envPassthroughKeys?: readonly string[] | undefined;
}>;

type SplitTerminalLaunchEnv = Readonly<{
  persistedEnv: Record<string, string>;
  passthroughEnv: Record<string, string>;
  passthroughKeys: string[];
}>;

const terminalLaunchSpecSecretEnvKeyPattern =
  /(?:^ANTHROPIC_|^CLAUDE_CODE_|(?:^|_)(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|AUTHORIZATION|BEARER|CREDENTIAL)(?:_|$))/i;

function splitTerminalLaunchSpecEnv(env: Readonly<Record<string, string>>): SplitTerminalLaunchEnv {
  const persistedEnv: Record<string, string> = Object.create(null);
  const passthroughEnv: Record<string, string> = Object.create(null);
  const passthroughKeys: string[] = [];

  for (const [key, value] of Object.entries(env)) {
    if (terminalLaunchSpecSecretEnvKeyPattern.test(key)) {
      passthroughEnv[key] = value;
      passthroughKeys.push(key);
      continue;
    }
    persistedEnv[key] = value;
  }

  return { persistedEnv, passthroughEnv, passthroughKeys };
}

async function writeTerminalLaunchSpec(spec: TerminalLaunchSpec): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'happier-terminal-launch-'));
  const path = join(dir, 'launch.json');
  await writeFile(path, JSON.stringify(spec), { mode: 0o600 });
  if (process.platform !== 'win32') {
    await chmod(path, 0o600);
  }
  return path;
}

function defaultDeps(inputDeps: Partial<ClaudeUnifiedTerminalSpawnDeps> | undefined): ClaudeUnifiedTerminalSpawnDeps {
  return {
    resolveClaudeCliPath: inputDeps?.resolveClaudeCliPath ?? resolveClaudeCliPath,
    isClaudeCliJavaScriptFile: inputDeps?.isClaudeCliJavaScriptFile ?? isClaudeCliJavaScriptFile,
    ensureClaudeJsRuntimeExecutable:
      inputDeps?.ensureClaudeJsRuntimeExecutable
      ?? (async () => (await ensureClaudeJsRuntimeExecutable()) ?? null),
    claudeLocalLauncherPath:
      inputDeps?.claudeLocalLauncherPath ?? resolveCliRuntimeAssetPath('scripts', 'claude_local_launcher.cjs'),
    terminalLaunchSpecRunnerPath:
      inputDeps?.terminalLaunchSpecRunnerPath ?? resolveCliRuntimeAssetPath('scripts', 'terminal_launch_spec_runner.cjs'),
    resolveCommandInvocation:
      inputDeps?.resolveCommandInvocation
      ?? ((params) => resolveWindowsCommandInvocation({
        command: params.command,
        args: [...params.args],
        env: params.env,
      })),
  };
}

export async function buildClaudeUnifiedTerminalSpawn<Mode extends EnhancedMode = EnhancedMode>(
  input: ClaudeUnifiedTerminalSpawnInput<Mode>,
): Promise<ClaudeUnifiedTerminalSpawn> {
  const deps = defaultDeps(input.deps);
  const resolvedClaudeCliPath = deps.resolveClaudeCliPath();
  const args = buildClaudeArgs(input);
  const env = buildClaudeEnv(input.envOverlay);

  const nodeExecutable = await deps.ensureClaudeJsRuntimeExecutable();
  if (!nodeExecutable) {
    throw new ReferenceError(buildMissingJavaScriptRuntimeMessage('Claude unified terminal launcher'));
  }
  if (
    !existsSync(deps.terminalLaunchSpecRunnerPath)
    && !isEmbeddedBunBundlePath(deps.terminalLaunchSpecRunnerPath)
    && !input.deps?.terminalLaunchSpecRunnerPath
  ) {
    throw new Error('Claude unified terminal launch-spec runner not found. Please ensure HAPPIER_PROJECT_ROOT is set correctly for development.');
  }

  let childCommand: string;
  let childArgs: readonly string[];
  if (deps.isClaudeCliJavaScriptFile(resolvedClaudeCliPath)) {
    if (
      !existsSync(deps.claudeLocalLauncherPath)
      && !isEmbeddedBunBundlePath(deps.claudeLocalLauncherPath)
      && !input.deps?.claudeLocalLauncherPath
    ) {
      throw new Error('Claude local launcher not found. Please ensure HAPPIER_PROJECT_ROOT is set correctly for development.');
    }
    if (!env.HAPPIER_CLAUDE_PATH && !env.HAPPY_CLAUDE_PATH) {
      env.HAPPIER_CLAUDE_PATH = resolvedClaudeCliPath;
    }
    childCommand = nodeExecutable;
    childArgs = [deps.claudeLocalLauncherPath, ...args];
  } else {
    const invocation = deps.resolveCommandInvocation({
      command: resolvedClaudeCliPath,
      args,
      env,
    });
    childCommand = invocation.command;
    childArgs = invocation.args;
  }

  const splitEnv = splitTerminalLaunchSpecEnv(env);
  const specPath = await writeTerminalLaunchSpec({
    command: childCommand,
    args: childArgs,
    cwd: input.path,
    env: splitEnv.persistedEnv,
    ...(splitEnv.passthroughKeys.length > 0 ? { envPassthroughKeys: splitEnv.passthroughKeys } : {}),
  });

  return {
    spawnArgv: [nodeExecutable, deps.terminalLaunchSpecRunnerPath, specPath],
    spawnEnv: {
      ...buildTerminalLauncherProcessEnv(),
      ...splitEnv.passthroughEnv,
    },
    launchSpecPath: specPath,
  };
}
