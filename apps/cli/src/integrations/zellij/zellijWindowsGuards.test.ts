import { describe, expect, it } from 'vitest';

import { resolveZellijWindowsGuard } from './zellijWindowsGuards';

describe('resolveZellijWindowsGuard', () => {
  it('disables Windows arm64 because zellij has no upstream binary', () => {
    expect(resolveZellijWindowsGuard({ platform: 'win32', arch: 'arm64', env: {} })).toMatchObject({
      status: 'disabled',
      reason: 'windows_arm64_unsupported',
    });
  });

  it('uses a foreground Windows Terminal launch strategy from legacy Windows Console Host', () => {
    expect(
      resolveZellijWindowsGuard({
        platform: 'win32',
        arch: 'x64',
        env: { WT_SESSION: '', TERM_PROGRAM: '' },
        parentProcessName: 'conhost.exe',
      }),
    ).toMatchObject({ status: 'ok', shell: 'cmd.exe', launchStrategy: 'foreground_windows_terminal' });
  });

  it('uses a foreground Windows Terminal launch strategy when no terminal host marker is present', () => {
    expect(
      resolveZellijWindowsGuard({
        platform: 'win32',
        arch: 'x64',
        env: { WT_SESSION: '', TERM_PROGRAM: '' },
      }),
    ).toMatchObject({ status: 'ok', shell: 'cmd.exe', launchStrategy: 'foreground_windows_terminal' });
  });

  it('uses the same foreground launch strategy inside Windows Terminal instead of the background TUI host shape', () => {
    expect(resolveZellijWindowsGuard({ platform: 'win32', arch: 'x64', env: { WT_SESSION: 'abc' } })).toMatchObject({
      status: 'ok',
      shell: 'cmd.exe',
      launchStrategy: 'foreground_windows_terminal',
    });
  });
});
