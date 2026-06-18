/**
 * The Hermes local/remote run loop. In local mode the native `hermes chat` TUI
 * drives (mirrored to the phone); a phone takeover hands off to remote ACP, and
 * an RPC switch hands back. Session + message queue are bootstrapped upstream by
 * the shared backend command path and threaded in via runLocal/runRemote, so
 * the switching logic stays decoupled and testable (mirrors codex/loop.ts, but
 * parameterized on startingMode so a no-TTY launch can begin in remote mode).
 */
import type { HermesLauncherResult } from './hermesLocalLauncher';

type Mode = 'local' | 'remote';

export async function hermesModeLoop(opts: Readonly<{
  startingMode: Mode;
  onModeChange: (mode: Mode) => void;
  session: { keepAlive: (thinking: boolean, mode: Mode) => void };
  runLocal: () => Promise<HermesLauncherResult>;
  runRemote: () => Promise<'exit' | 'switch'>;
}>): Promise<number> {
  let mode: Mode = opts.startingMode;

  for (;;) {
    if (mode === 'local') {
      const result: HermesLauncherResult = await opts.runLocal();
      if (result.type === 'exit') {
        return result.code;
      }
      mode = 'remote';
      opts.onModeChange(mode);
      opts.session.keepAlive(false, mode);
      continue;
    }

    const reason = await opts.runRemote();
    if (reason === 'exit') {
      return 0;
    }
    mode = 'local';
    opts.onModeChange(mode);
    opts.session.keepAlive(false, mode);
  }
}
