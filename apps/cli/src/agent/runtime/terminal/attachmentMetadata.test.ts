import { describe, expect, it } from 'vitest';

import type { TerminalHostHandle } from '@/integrations/terminalHost/_types';

import { buildTerminalAttachmentMetadataFromHostHandle } from './attachmentMetadata';

describe('buildTerminalAttachmentMetadataFromHostHandle', () => {
  it('builds tmux terminal metadata from a host handle', () => {
    const handle: TerminalHostHandle = {
      kind: 'tmux',
      sessionName: 'happy',
      paneId: 'unified-window',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        liveProbe: 'required',
      },
    };

    expect(buildTerminalAttachmentMetadataFromHostHandle(handle)).toEqual({
      mode: 'tmux',
      tmux: { target: 'happy:unified-window' },
    });
  });

  it('builds zellij terminal metadata from a host handle', () => {
    const handle: TerminalHostHandle = {
      kind: 'zellij',
      sessionName: 'happy-zellij',
      paneId: 'terminal_7',
      socketDir: '/tmp/happier-zellij-a',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        liveProbe: 'required',
      },
    };

    expect(buildTerminalAttachmentMetadataFromHostHandle(handle)).toEqual({
      mode: 'zellij',
      zellij: {
        sessionName: 'happy-zellij',
        paneId: 'terminal_7',
      },
    });
  });

  it('builds non-focusable Windows console metadata from a PTY host handle', () => {
    const handle: TerminalHostHandle = {
      kind: 'windows_console',
      sessionName: 'happy-windows-pty',
      paneId: 'happy-windows-pty',
      attachMetadata: {
        attachStrategy: 'terminal_host',
        topology: 'shared',
        locality: 'same_machine',
        liveProbe: 'required',
        requiresLocalAttachmentInfo: false,
      },
    };

    expect(buildTerminalAttachmentMetadataFromHostHandle(handle)).toEqual({
      mode: 'windows_console',
      requested: 'console',
      windows: {
        host: 'console',
      },
    });
  });
});
