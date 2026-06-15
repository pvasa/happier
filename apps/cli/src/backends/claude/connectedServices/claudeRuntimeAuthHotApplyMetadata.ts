import { isAbsolute, relative, resolve } from 'node:path';

export type ClaudeRuntimeAuthHotApplyMetadata = Readonly<{
  mode: 'group_runtime_config_rewrite';
  runtimeClaudeConfigDir: string;
  runtimeMaterializedRoot: string;
  sourceClaudeConfigDir: string;
}>;

export const CLAUDE_RUNTIME_AUTH_HOT_APPLY_METADATA_KEY = 'claudeRuntimeAuthHotApply';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function buildClaudeRuntimeAuthHotApplyMetadata(params: Readonly<{
  runtimeClaudeConfigDir: string | null | undefined;
  runtimeMaterializedRoot: string | null | undefined;
  sourceClaudeConfigDir: string | null | undefined;
}>): ClaudeRuntimeAuthHotApplyMetadata | null {
  const runtimeClaudeConfigDir = readString(params.runtimeClaudeConfigDir);
  const runtimeMaterializedRoot = readString(params.runtimeMaterializedRoot);
  const sourceClaudeConfigDir = readString(params.sourceClaudeConfigDir);
  if (!runtimeClaudeConfigDir || !runtimeMaterializedRoot || !sourceClaudeConfigDir) return null;
  if (!isPathInside(runtimeMaterializedRoot, runtimeClaudeConfigDir)) return null;
  return {
    mode: 'group_runtime_config_rewrite',
    runtimeClaudeConfigDir,
    runtimeMaterializedRoot,
    sourceClaudeConfigDir,
  };
}

export function readClaudeRuntimeAuthHotApplyMetadata(
  selection: unknown,
): ClaudeRuntimeAuthHotApplyMetadata | null {
  const selectionRecord = readRecord(selection);
  const metadata = readRecord(selectionRecord?.[CLAUDE_RUNTIME_AUTH_HOT_APPLY_METADATA_KEY]);
  if (metadata?.mode !== 'group_runtime_config_rewrite') return null;
  return buildClaudeRuntimeAuthHotApplyMetadata({
    runtimeClaudeConfigDir: readString(metadata.runtimeClaudeConfigDir),
    runtimeMaterializedRoot: readString(metadata.runtimeMaterializedRoot),
    sourceClaudeConfigDir: readString(metadata.sourceClaudeConfigDir),
  });
}
