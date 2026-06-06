import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { normalizeKimiAcpPythonSelector, type KimiAcpPythonSelector } from '@happier-dev/agents';

const KIMI_ACP_POLL_SELECTOR_SHIM_DIR_PREFIX = 'kimi-acp-poll-selector-';

const KIMI_ACP_POLL_SELECTOR_SITE_CUSTOMIZE = [
  'import selectors',
  '',
  '# Force asyncio SelectorEventLoop to use poll() instead of epoll().',
  'selectors.DefaultSelector = selectors.PollSelector',
  '',
].join('\n');

function ensureKimiAcpPollSelectorShimDir(baseDir: string): string {
  mkdirSync(baseDir, { recursive: true, mode: 0o700 });
  const shimDir = mkdtempSync(join(baseDir, KIMI_ACP_POLL_SELECTOR_SHIM_DIR_PREFIX));
  chmodSync(shimDir, 0o700);
  writeFileSync(join(shimDir, 'sitecustomize.py'), KIMI_ACP_POLL_SELECTOR_SITE_CUSTOMIZE, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  return shimDir;
}

export function resolveKimiAcpPythonSelectorChildEnv(params: Readonly<{
  selector?: KimiAcpPythonSelector | string | null;
  env?: NodeJS.ProcessEnv;
  inheritedEnv?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  shimBaseDir?: string;
}>): NodeJS.ProcessEnv {
  const env = { ...(params.env ?? {}) };
  const selector = normalizeKimiAcpPythonSelector(params.selector);
  const platform = params.platform ?? process.platform;
  if (selector !== 'poll' || platform !== 'linux') return env;

  const shimDir = ensureKimiAcpPollSelectorShimDir(params.shimBaseDir ?? tmpdir());
  const envHasPythonPath = Object.prototype.hasOwnProperty.call(env, 'PYTHONPATH');
  const envPythonPath = typeof env.PYTHONPATH === 'string' && env.PYTHONPATH.length > 0
    ? env.PYTHONPATH
    : null;
  const inheritedPythonPath =
    !envHasPythonPath && typeof params.inheritedEnv?.PYTHONPATH === 'string' && params.inheritedEnv.PYTHONPATH.length > 0
      ? params.inheritedEnv.PYTHONPATH
      : null;
  const existingPythonPath = envPythonPath ?? inheritedPythonPath ?? '';
  env.PYTHONPATH = existingPythonPath ? `${shimDir}${delimiter}${existingPythonPath}` : shimDir;
  return env;
}
