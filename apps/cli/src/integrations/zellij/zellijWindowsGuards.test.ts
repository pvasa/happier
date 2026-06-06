import { describe, expect, it } from 'vitest';

import { resolveZellijWindowsGuard } from './zellijWindowsGuards';

describe('resolveZellijWindowsGuard', () => {
  it('disables Windows arm64 because zellij has no upstream binary', () => {
    expect(resolveZellijWindowsGuard({ platform: 'win32', arch: 'arm64', env: {} })).toMatchObject({
      status: 'disabled',
      reason: 'windows_arm64_unsupported',
    });
  });

  it('refuses legacy Windows Console Host with an actionable reason', () => {
    expect(
      resolveZellijWindowsGuard({
        platform: 'win32',
        arch: 'x64',
        env: { WT_SESSION: '', TERM_PROGRAM: '' },
        parentProcessName: 'conhost.exe',
      }),
    ).toMatchObject({ status: 'disabled', reason: 'windows_console_host_unsupported' });
  });

  it('fails closed on Windows when no supported terminal host marker is present', () => {
    expect(
      resolveZellijWindowsGuard({
        platform: 'win32',
        arch: 'x64',
        env: { WT_SESSION: '', TERM_PROGRAM: '' },
      }),
    ).toMatchObject({ status: 'disabled', reason: 'windows_console_host_unsupported' });
  });

  it('fails closed for native Windows zellij TUI hosts even inside Windows Terminal', () => {
    expect(resolveZellijWindowsGuard({ platform: 'win32', arch: 'x64', env: { WT_SESSION: 'abc' } })).toMatchObject({
      status: 'disabled',
      reason: 'windows_zellij_tui_unsupported',
    });
  });
});
