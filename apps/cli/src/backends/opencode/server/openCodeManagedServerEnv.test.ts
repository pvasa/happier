import { describe, expect, it } from 'vitest';

import {
  resolveOpenCodeManagedServerChildEnv,
  resolveOpenCodeManagedServerLaunchFingerprint,
} from './openCodeManagedServerEnv';

describe('resolveOpenCodeManagedServerChildEnv', () => {
  it('defaults OPENCODE_CONFIG_CONTENT when missing and does not override XDG dirs when no xdgRootDir is provided', () => {
    const env = resolveOpenCodeManagedServerChildEnv({
      baseEnv: { PATH: '/bin', XDG_CONFIG_HOME: '/cfg' },
      xdgRootDir: null,
      isolateConfig: false,
    });

    expect(env.PATH).toBe('/bin');
    expect(env.OPENCODE_CONFIG_CONTENT).toBe('{}');
    expect(env.XDG_CONFIG_HOME).toBe('/cfg');
    expect(env.XDG_DATA_HOME).toBeUndefined();
    expect(env.XDG_STATE_HOME).toBeUndefined();
    expect(env.XDG_CACHE_HOME).toBeUndefined();
  });

  it('does not synthesize OpenCode config paths from the Happier stack home', () => {
    const env = resolveOpenCodeManagedServerChildEnv({
      baseEnv: {
        PATH: '/bin',
        HOME: '/Users/example',
        HAPPIER_HOME_DIR: '/tmp/happier-home',
      },
      xdgRootDir: null,
      isolateConfig: false,
    });

    expect(env.HOME).toBe('/Users/example');
    expect(env.HAPPIER_HOME_DIR).toBe('/tmp/happier-home');
    expect(env.XDG_CONFIG_HOME).toBeUndefined();
    expect(env.XDG_DATA_HOME).toBeUndefined();
    expect(env.XDG_STATE_HOME).toBeUndefined();
    expect(env.XDG_CACHE_HOME).toBeUndefined();
  });

  it('preserves user home and config env when a Happier stack home is configured', () => {
    const env = resolveOpenCodeManagedServerChildEnv({
      baseEnv: {
        PATH: '/bin',
        HOME: '/Users/example',
        USERPROFILE: '/Users/example-profile',
        HAPPIER_HOME_DIR: '/tmp/happier-home',
        XDG_CONFIG_HOME: '/Users/example/.config',
        XDG_DATA_HOME: '/Users/example/.local/share',
        XDG_STATE_HOME: '/Users/example/.local/state',
        XDG_CACHE_HOME: '/Users/example/.cache',
      },
      xdgRootDir: null,
      isolateConfig: false,
    });

    expect(env.HOME).toBe('/Users/example');
    expect(env.USERPROFILE).toBe('/Users/example-profile');
    expect(env.HAPPIER_HOME_DIR).toBe('/tmp/happier-home');
    expect(env.XDG_CONFIG_HOME).toBe('/Users/example/.config');
    expect(env.XDG_DATA_HOME).toBe('/Users/example/.local/share');
    expect(env.XDG_STATE_HOME).toBe('/Users/example/.local/state');
    expect(env.XDG_CACHE_HOME).toBe('/Users/example/.cache');
  });

  it('preserves inherited XDG_CONFIG_HOME instead of replacing it with the Happier stack home', () => {
    const env = resolveOpenCodeManagedServerChildEnv({
      baseEnv: {
        PATH: '/bin',
        HOME: '/Users/example',
        HAPPIER_HOME_DIR: '/tmp/happier-home',
        XDG_CONFIG_HOME: '/Users/example/.config',
      },
      xdgRootDir: null,
      isolateConfig: false,
    });

    expect(env.HOME).toBe('/Users/example');
    expect(env.XDG_CONFIG_HOME).toBe('/Users/example/.config');
  });

  it('sets XDG data/state/cache directories under xdgRootDir and preserves existing config dir by default', () => {
    const env = resolveOpenCodeManagedServerChildEnv({
      baseEnv: { XDG_CONFIG_HOME: '/cfg', OPENCODE_CONFIG_CONTENT: '{"ok":true}' },
      xdgRootDir: '/xdg-root',
      isolateConfig: false,
    });

    expect(env.OPENCODE_CONFIG_CONTENT).toBe('{"ok":true}');
    expect(env.XDG_DATA_HOME).toBe('/xdg-root/data');
    expect(env.XDG_STATE_HOME).toBe('/xdg-root/state');
    expect(env.XDG_CACHE_HOME).toBe('/xdg-root/cache');
    expect(env.XDG_CONFIG_HOME).toBe('/cfg');
  });

  it('can isolate config directory under xdgRootDir when requested', () => {
    const env = resolveOpenCodeManagedServerChildEnv({
      baseEnv: { XDG_CONFIG_HOME: '/cfg' },
      xdgRootDir: '/xdg-root',
      isolateConfig: true,
    });

    expect(env.XDG_CONFIG_HOME).toBe('/xdg-root/config');
  });

  it('changes the launch fingerprint when auth-relevant provider env changes', () => {
    const fingerprintA = resolveOpenCodeManagedServerLaunchFingerprint({
      baseEnv: {
        HOME: '/Users/example',
        OPENAI_API_KEY: 'key-a',
        OPENCODE_SERVER_USERNAME: 'user-a',
      },
      xdgRootDir: '/xdg-root',
      isolateConfig: true,
    });

    const fingerprintB = resolveOpenCodeManagedServerLaunchFingerprint({
      baseEnv: {
        HOME: '/Users/example',
        OPENAI_API_KEY: 'key-b',
        OPENCODE_SERVER_USERNAME: 'user-a',
      },
      xdgRootDir: '/xdg-root',
      isolateConfig: true,
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });

  it('changes the launch fingerprint when USERPROFILE changes without HOME', () => {
    const fingerprintA = resolveOpenCodeManagedServerLaunchFingerprint({
      baseEnv: {
        USERPROFILE: 'C:\\Users\\alice',
      },
      xdgRootDir: null,
      isolateConfig: false,
    });

    const fingerprintB = resolveOpenCodeManagedServerLaunchFingerprint({
      baseEnv: {
        USERPROFILE: 'C:\\Users\\bob',
      },
      xdgRootDir: null,
      isolateConfig: false,
    });

    expect(fingerprintA).not.toBe(fingerprintB);
  });

  it('changes the launch fingerprint when OPENCODE_AUTH_CONTENT changes without exposing the raw auth content', () => {
    const authContentA = JSON.stringify({ openai: { type: 'api', key: 'sk-account-a' } });
    const authContentB = JSON.stringify({ openai: { type: 'api', key: 'sk-account-b' } });

    const fingerprintA = resolveOpenCodeManagedServerLaunchFingerprint({
      baseEnv: {
        HOME: '/Users/example',
        OPENCODE_AUTH_CONTENT: authContentA,
      },
      xdgRootDir: '/xdg-root',
      isolateConfig: true,
    });

    const fingerprintB = resolveOpenCodeManagedServerLaunchFingerprint({
      baseEnv: {
        HOME: '/Users/example',
        OPENCODE_AUTH_CONTENT: authContentB,
      },
      xdgRootDir: '/xdg-root',
      isolateConfig: true,
    });

    expect(fingerprintA).not.toBe(fingerprintB);
    expect(fingerprintA).not.toContain('sk-account-a');
    expect(fingerprintA).not.toContain(authContentA);
  });
});
