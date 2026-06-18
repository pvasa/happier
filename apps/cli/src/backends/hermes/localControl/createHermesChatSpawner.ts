/**
 * Produces the `spawnChat` boundary the local launcher needs: spawns the native
 * `hermes chat` TUI as a managed child with the host terminal attached
 * (`stdio:'inherit'`), reusing the canonical `hermes` binary resolution. Adapts
 * the managed child's termination into the launcher's `onExit(code)` shape.
 */
import { spawn } from 'node:child_process';

import { requireProviderCliLaunchSpec } from '@/runtime/managedTools/requireProviderCliLaunchSpec';
import { createManagedChildProcess } from '@/subprocess/supervision/managedChildProcess';
import type { TerminationEvent } from '@/subprocess/supervision/types';

import type { HermesLauncherChild } from './hermesLocalLauncher';

export function hermesChatExitCode(event: TerminationEvent): number {
  switch (event.type) {
    case 'exited':
      return event.code;
    case 'signaled':
      // A signal is how we tear down the TUI to hand off to remote — treat as clean.
      return 0;
    default:
      return 1;
  }
}

export function createHermesChatSpawner(params: Readonly<{
  cwd: string;
  env?: NodeJS.ProcessEnv;
}>): (chatArgs: readonly string[]) => HermesLauncherChild {
  const env = params.env ?? process.env;
  return (chatArgs) => {
    const launch = requireProviderCliLaunchSpec('hermes', { processEnv: env });
    const child = spawn(launch.command, [...launch.args, ...chatArgs], {
      cwd: params.cwd,
      env,
      stdio: 'inherit',
      windowsHide: true,
    });
    const managed = createManagedChildProcess(child);
    return {
      onExit: (cb) => {
        void managed.waitForTermination().then((event) => cb(hermesChatExitCode(event)));
      },
      kill: (signal) => {
        try {
          child.kill(signal ?? 'SIGTERM');
        } catch {
          // The child may already have exited; nothing to do.
        }
      },
    };
  };
}
