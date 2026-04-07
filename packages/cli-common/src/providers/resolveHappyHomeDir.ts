import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, resolve as resolvePath } from 'node:path';

export function resolveHappyHomeDirFromEnvironment(processEnv: NodeJS.ProcessEnv = process.env): string {
  const override = typeof processEnv.HAPPIER_HOME_DIR === 'string' ? processEnv.HAPPIER_HOME_DIR.trim() : '';
  if (override) {
    const envHome =
      process.platform === 'win32'
        ? (processEnv.USERPROFILE || processEnv.HOME)
        : processEnv.HOME;
    const normalizedHome = typeof envHome === 'string' ? envHome.trim() : '';
    const expandedOverride =
      override === '~'
        ? (normalizedHome || homedir())
        : override.startsWith('~/') || override.startsWith('~\\')
          ? join(normalizedHome || homedir(), override.slice(2))
          : override;
    return isAbsolute(expandedOverride) ? expandedOverride : resolvePath(expandedOverride);
  }

  const envHome = (processEnv.HOME ?? processEnv.USERPROFILE ?? '').trim();
  let baseHome = envHome;
  if (!baseHome) {
    try {
      baseHome = homedir();
    } catch {
      baseHome = '';
    }
  }

  if (!baseHome) {
    baseHome = tmpdir();
  }

  return join(baseHome, '.happier');
}
