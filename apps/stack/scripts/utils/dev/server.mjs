import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ensureDepsInstalled, pmSpawnScript } from '../proc/pm.mjs';
import { run } from '../proc/proc.mjs';
import { applyHappyServerMigrations, ensureHappyServerManagedInfra } from '../server/infra/happy_server_infra.mjs';
import { applyServerLightEnvDefaults } from '../server/apply_server_light_env_defaults.mjs';
import { resolveServerDevScript } from '../server/flavor_scripts.mjs';
import { applyStackServerLoggingDefaults } from '../server/logging_env.mjs';
import { resolveServerReadyTimeoutMs, waitForServerReady } from '../server/server.mjs';
import { isTcpPortFree, pickNextFreeTcpPort } from '../net/ports.mjs';
import { readStackRuntimeStateFile, recordStackRuntimeUpdate } from '../stack/runtime_state.mjs';
import { killProcessGroupOwnedByStack } from '../proc/ownership.mjs';
import { watchDebounced } from '../proc/watch.mjs';
import { pickMetroPort, resolveStablePortStart } from '../expo/metro_ports.mjs';

function readPackageScripts(dir) {
  try {
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'));
    return pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : {};
  } catch {
    return {};
  }
}

function hasPackageScript(dir, scriptName) {
  const script = readPackageScripts(dir)?.[scriptName];
  return typeof script === 'string' && script.trim().length > 0;
}

function resolveDevServerWatchPaths({ serverDir, existsSyncImpl = existsSync }) {
  const repoRoot = resolve(serverDir, '..', '..');
  const sharedPackages = ['agents', 'cli-common', 'protocol'];
  const serverPaths = [
    join(serverDir, 'sources'),
    join(serverDir, 'scripts'),
    join(serverDir, 'prisma'),
    join(serverDir, 'package.json'),
    join(serverDir, 'tsconfig.json'),
    join(serverDir, 'tsconfig.build.json'),
  ];
  const sharedPaths = sharedPackages.flatMap((pkg) => ([
    join(repoRoot, 'packages', pkg, 'src'),
    join(repoRoot, 'packages', pkg, 'package.json'),
    join(repoRoot, 'packages', pkg, 'tsconfig.json'),
  ]));

  return [...serverPaths, ...sharedPaths].filter((p) => existsSyncImpl(p));
}

function appendWatchSignatureEntries(path, entries) {
  let stats;
  try {
    stats = lstatSync(path);
  } catch {
    entries.push(`${path}\0missing`);
    return false;
  }

  if (stats.isDirectory()) {
    entries.push(`${path}\0dir`);
    let names = [];
    try {
      names = readdirSync(path, { withFileTypes: true })
        .map((entry) => entry.name)
        .sort();
    } catch {
      return true;
    }
    for (const name of names) {
      appendWatchSignatureEntries(join(path, name), entries);
    }
    return true;
  }

  if (stats.isFile() || stats.isSymbolicLink()) {
    entries.push(`${path}\0file\0${stats.size}\0${Math.trunc(stats.mtimeMs)}`);
    return true;
  }

  entries.push(`${path}\0other\0${Math.trunc(stats.mtimeMs)}`);
  return true;
}

function readDevServerWatchChangeSignature(paths) {
  const entries = [];
  let observed = false;
  for (const path of paths) {
    observed = appendWatchSignatureEntries(path, entries) || observed;
  }
  return observed ? entries.join('\n') : null;
}

export async function preflightDevServerRestart(
  { serverDir, serverEnv = {}, logger = console },
  { runImpl = run } = {},
) {
  const enabled = String(serverEnv.HAPPIER_STACK_SERVER_RESTART_PREFLIGHT ?? '').trim() !== '0';
  if (!enabled) return { ran: false, reason: 'disabled' };
  if (String(serverEnv.HAPPIER_STACK_SERVER_RESTART_PREFLIGHT_ALREADY_DONE ?? '').trim() === '1') {
    return { ran: false, reason: 'already-done' };
  }
  if (!hasPackageScript(serverDir, 'build')) return { ran: false, reason: 'missing-build-script' };

  logger.log('[local] watch: server changed → preflight build...');
  await runImpl('yarn', ['-s', 'build'], {
    cwd: serverDir,
    env: {
      ...serverEnv,
      HAPPIER_STACK_SKIP_REFRESH_DEPS: serverEnv.HAPPIER_STACK_SKIP_REFRESH_DEPS ?? '1',
    },
    stdio: 'inherit',
  });
  return { ran: true, reason: 'build-ok' };
}

export function resolveStackUiDevPortStart({ env = process.env, stackName }) {
  return resolveStablePortStart({
    env: {
      ...env,
      HAPPIER_STACK_UI_DEV_PORT_BASE: (env.HAPPIER_STACK_UI_DEV_PORT_BASE ?? '8081').toString(),
      HAPPIER_STACK_UI_DEV_PORT_RANGE: (env.HAPPIER_STACK_UI_DEV_PORT_RANGE ?? '1000').toString(),
    },
    stackName,
    baseKey: 'HAPPIER_STACK_UI_DEV_PORT_BASE',
    rangeKey: 'HAPPIER_STACK_UI_DEV_PORT_RANGE',
    defaultBase: 8081,
    defaultRange: 1000,
  });
}

export async function pickDevMetroPort({ startPort, reservedPorts = new Set(), host = '127.0.0.1' } = {}) {
  const forcedPort = (process.env.HAPPIER_STACK_UI_DEV_PORT ?? '').toString().trim();
  return await pickMetroPort({ startPort, forcedPort, reservedPorts, host });
}

export async function startDevServer({
  serverComponentName,
  serverDir,
  autostart,
  baseEnv,
  serverPort,
  internalServerUrl,
  publicServerUrl,
  envPath,
  stackMode,
  runtimeStatePath,
  serverAlreadyRunning,
  restart,
  children,
  spawnOptions = {},
  quiet = false,
}) {
  const serverEnv = {
    ...baseEnv,
    PORT: String(serverPort),
    PUBLIC_URL: publicServerUrl,
    // Avoid noisy failures if a previous run left the metrics port busy.
    METRICS_ENABLED: baseEnv.METRICS_ENABLED ?? 'false',
  };
  applyStackServerLoggingDefaults({ baseEnv, serverEnv });

  if (serverComponentName === 'happier-server-light') {
    applyServerLightEnvDefaults({ baseEnv, serverEnv, baseDir: autostart.baseDir });
  }

  if (serverComponentName === 'happier-server') {
    const managed = (baseEnv.HAPPIER_STACK_MANAGED_INFRA ?? '1') !== '0';
    if (managed) {
      const infra = await ensureHappyServerManagedInfra({
        stackName: autostart.stackName,
        baseDir: autostart.baseDir,
        serverPort,
        publicServerUrl,
        envPath,
        env: baseEnv,
      });
      Object.assign(serverEnv, infra.env);
    }

    const autoMigrate = (baseEnv.HAPPIER_STACK_PRISMA_MIGRATE ?? '1') !== '0';
    if (autoMigrate) {
      await applyHappyServerMigrations({ serverDir, env: serverEnv });
    }
  }

  // Ensure server deps exist before any Prisma/docker work.
  await ensureDepsInstalled(serverDir, serverComponentName, { quiet, env: serverEnv });

  const prismaPush = (baseEnv.HAPPIER_STACK_PRISMA_PUSH ?? '1').toString().trim() !== '0';
  const serverScript = resolveServerDevScript({ serverComponentName, serverDir, prismaPush });

  // Restart behavior (stack-safe): only kill when we can prove ownership via runtime state.
  if (restart && stackMode && runtimeStatePath && serverAlreadyRunning) {
    await preflightDevServerRestart({ serverDir, serverComponentName, serverEnv, logger: console });
    const st = await readStackRuntimeStateFile(runtimeStatePath);
    const pid = Number(st?.processes?.serverPid);
    if (pid > 1) {
      const res = await killProcessGroupOwnedByStack(pid, { stackName: autostart.stackName, envPath, label: 'server', json: true });
      if (!res.killed) {
        // Fail-closed if the port is still occupied.
        const free = await isTcpPortFree(serverPort, { host: '127.0.0.1' });
        if (!free) {
          throw new Error(
            `[local] restart refused: server port ${serverPort} is occupied and the PID is not provably stack-owned.\n` +
              `[local] Fix: run 'hstack stack stop ${autostart.stackName}' then re-run, or re-run without --restart.`
          );
        }
      }
    }
  }

  if (serverAlreadyRunning && !restart) {
    return { serverEnv, serverScript, serverProc: null };
  }

  const server = await pmSpawnScript({
    label: 'server',
    dir: serverDir,
    script: serverScript,
    env: serverEnv,
    options: spawnOptions,
    quiet,
  });
  children.push(server);
  if (stackMode && runtimeStatePath) {
    await recordStackRuntimeUpdate(runtimeStatePath, { processes: { serverPid: server.pid } }).catch(() => {});
  }
  await waitForServerReady(internalServerUrl, {
    timeoutMs: resolveServerReadyTimeoutMs({ serverComponentName, env: serverEnv }),
    childProcess: server,
  });
  return { serverEnv, serverScript, serverProc: server };
}

export function watchDevServerAndRestart({
  enabled,
  stackMode,
  serverComponentName,
  serverDir,
  serverPort,
  internalServerUrl,
  serverScript,
  serverEnv,
  runtimeStatePath,
  stackName,
  envPath,
  children,
  serverProcRef,
  isShuttingDown,
}, {
  watchDebouncedImpl = watchDebounced,
  killProcessGroupOwnedByStackImpl = killProcessGroupOwnedByStack,
  isTcpPortFreeImpl = isTcpPortFree,
  pmSpawnScriptImpl = pmSpawnScript,
  recordStackRuntimeUpdateImpl = recordStackRuntimeUpdate,
  waitForServerReadyImpl = waitForServerReady,
  preflightDevServerRestartImpl = preflightDevServerRestart,
  readWatchChangeSignatureImpl = readDevServerWatchChangeSignature,
  existsSyncImpl = existsSync,
  logger = console,
} = {}) {
  if (!enabled) return null;

  // Both server flavors are spawned through plain tsx dev scripts; stack watch owns source-change restarts.
  if (serverComponentName !== 'happier-server' && serverComponentName !== 'happier-server-light') return null;

  let inFlight = false;
  let pending = false;
  const watchPaths = resolveDevServerWatchPaths({ serverDir, existsSyncImpl });
  let lastWatchSignature = readWatchChangeSignatureImpl(watchPaths);

  const hasRealWatchedChange = () => {
    const nextWatchSignature = readWatchChangeSignatureImpl(watchPaths);
    if (lastWatchSignature && nextWatchSignature && nextWatchSignature === lastWatchSignature) {
      return false;
    }
    if (nextWatchSignature) {
      lastWatchSignature = nextWatchSignature;
    }
    return true;
  };

  const restartOnce = async () => {
    const pid = Number(serverProcRef?.current?.pid);
    if (!Number.isFinite(pid) || pid <= 1) return false;

    await preflightDevServerRestartImpl({ serverDir, serverComponentName, serverEnv, logger });

    logger.log('[local] watch: server preflight passed → restarting...');
    const killResult = await killProcessGroupOwnedByStackImpl(pid, { stackName, envPath, label: 'server', json: false });
    if (!killResult.killed) {
      const free = await isTcpPortFreeImpl(serverPort, { host: '127.0.0.1' });
      if (!free) {
        throw new Error(
          `[local] watch restart refused: server port ${serverPort} is occupied and the PID is not provably stack-owned.\n` +
            `[local] Fix: run 'hstack stack stop ${stackName}' then re-run.`
        );
      }
    }

    const next = await pmSpawnScriptImpl({ label: 'server', dir: serverDir, script: serverScript, env: serverEnv });
    children.push(next);
    serverProcRef.current = next;
    if (stackMode && runtimeStatePath) {
      await recordStackRuntimeUpdateImpl(runtimeStatePath, { processes: { serverPid: next.pid } }).catch(() => {});
    }
    await waitForServerReadyImpl(internalServerUrl, {
      timeoutMs: resolveServerReadyTimeoutMs({ serverComponentName, env: serverEnv }),
      childProcess: next,
    });
    logger.log(`[local] watch: server restarted (pid=${next.pid}, port=${serverPort})`);
    return true;
  };

  return watchDebouncedImpl({
    paths: (watchPaths.length ? watchPaths : [serverDir]).map((p) => resolve(p)),
    debounceMs: 600,
    onChange: async () => {
      if (isShuttingDown?.()) return;
      if (!hasRealWatchedChange()) return;
      if (inFlight) {
        pending = true;
        return;
      }

      inFlight = true;
      try {
        do {
          pending = false;
          if (isShuttingDown?.()) return;
          try {
            const restarted = await restartOnce();
            if (!restarted) break;
          } catch (e) {
            const msg = e instanceof Error ? e.stack || e.message : String(e);
            logger.error('[local] watch: server restart failed; keeping existing process as-is (will retry on next change).');
            logger.error(msg);
            if (pending) continue;
            break;
          }
        } while (pending);
      } finally {
        inFlight = false;
      }
    },
  });
}
