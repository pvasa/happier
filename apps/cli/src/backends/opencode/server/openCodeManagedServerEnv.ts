import { createHash } from 'node:crypto';
import { join } from 'node:path';

function hashEnvSecret(value: unknown): string {
  const raw = typeof value === 'string' ? value : '';
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex');
}

export function resolveOpenCodeManagedServerChildEnv(params: Readonly<{
  baseEnv: NodeJS.ProcessEnv;
  xdgRootDir: string | null;
  isolateConfig: boolean;
}>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...params.baseEnv,
    // Ensure the subprocess has a stable, explicit config envelope.
    OPENCODE_CONFIG_CONTENT: params.baseEnv.OPENCODE_CONFIG_CONTENT ?? '{}',
  };

  const xdgRootDir = typeof params.xdgRootDir === 'string' ? params.xdgRootDir.trim() : '';
  if (!xdgRootDir) return env;

  env.XDG_DATA_HOME = join(xdgRootDir, 'data');
  env.XDG_STATE_HOME = join(xdgRootDir, 'state');
  env.XDG_CACHE_HOME = join(xdgRootDir, 'cache');
  if (params.isolateConfig) {
    env.XDG_CONFIG_HOME = join(xdgRootDir, 'config');
  }
  return env;
}

export function resolveOpenCodeManagedServerLaunchFingerprint(params: Readonly<{
  baseEnv: NodeJS.ProcessEnv;
  xdgRootDir: string | null;
  isolateConfig: boolean;
}>): string {
  const env = resolveOpenCodeManagedServerChildEnv(params);
  const relevant = {
    HOME: typeof env.HOME === 'string' ? env.HOME : '',
    USERPROFILE: typeof env.USERPROFILE === 'string' ? env.USERPROFILE : '',
    HAPPIER_HOME_DIR: typeof env.HAPPIER_HOME_DIR === 'string' ? env.HAPPIER_HOME_DIR : '',
    XDG_CONFIG_HOME: typeof env.XDG_CONFIG_HOME === 'string' ? env.XDG_CONFIG_HOME : '',
    XDG_DATA_HOME: typeof env.XDG_DATA_HOME === 'string' ? env.XDG_DATA_HOME : '',
    XDG_STATE_HOME: typeof env.XDG_STATE_HOME === 'string' ? env.XDG_STATE_HOME : '',
    XDG_CACHE_HOME: typeof env.XDG_CACHE_HOME === 'string' ? env.XDG_CACHE_HOME : '',
    OPENCODE_CONFIG_CONTENT: typeof env.OPENCODE_CONFIG_CONTENT === 'string' ? env.OPENCODE_CONFIG_CONTENT : '',
    OPENCODE_AUTH_CONTENT_SHA256: hashEnvSecret(env.OPENCODE_AUTH_CONTENT),
    OPENAI_API_KEY: typeof env.OPENAI_API_KEY === 'string' ? env.OPENAI_API_KEY : '',
    ANTHROPIC_API_KEY: typeof env.ANTHROPIC_API_KEY === 'string' ? env.ANTHROPIC_API_KEY : '',
    OPENCODE_SERVER_USERNAME: typeof env.OPENCODE_SERVER_USERNAME === 'string' ? env.OPENCODE_SERVER_USERNAME : '',
    OPENCODE_SERVER_PASSWORD: typeof env.OPENCODE_SERVER_PASSWORD === 'string' ? env.OPENCODE_SERVER_PASSWORD : '',
  };

  return createHash('sha256').update(JSON.stringify(relevant)).digest('hex');
}
