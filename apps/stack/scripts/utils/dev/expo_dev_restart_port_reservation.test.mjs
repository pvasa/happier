import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, chmod, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';

import { ensureDevExpoServer } from './expo_dev.mjs';
import { getExpoStatePaths, writePidState } from '../expo/expo.mjs';
import { isPidAlive } from '../proc/pids.mjs';
import { spawnDetachedInlineNodeTestProcess, spawnDetachedTestProcess } from '../../testkit/core/spawn_test_process.mjs';

function listenEphemeralPort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('failed to resolve ephemeral port')));
        return;
      }
      const port = Number(addr.port);
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function killProcessTreeByPid(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 1) return;
  try {
    process.kill(-n, 'SIGKILL');
  } catch {
    try {
      process.kill(n, 'SIGKILL');
    } catch {
      // ignore
    }
  }
}

async function waitForPidExit(pid, timeoutMs = 2000) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 1) return true;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isPidAlive(n)) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !isPidAlive(n);
}

function listenMetroStatusServer() {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => {
      socket.once('data', () => {
        socket.write(
          'HTTP/1.1 200 OK\r\n' +
            'Content-Type: text/plain\r\n' +
            'Content-Length: 23\r\n' +
            '\r\n' +
            'packager-status:running'
        );
        socket.end();
      });
    });
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        server.close(() => reject(new Error('failed to resolve metro status server port')));
        return;
      }
      resolve({ server, port: Number(addr.port) });
    });
  });
}

test('ensureDevExpoServer does not reserve prior metro port when restart cannot kill previous pid but the port is free', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-reserve-port-'));
  const children = [];
  let foreignPid = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(
      expoBin,
      [
        '#!/usr/bin/env node',
        "setInterval(() => {}, 1000);",
      ].join('\n') + '\n',
      'utf-8'
    );
    await chmod(expoBin, 0o755);

    const foreign = spawnDetachedInlineNodeTestProcess('setInterval(() => {}, 1000)', {
      stdio: 'ignore',
    });
    foreignPid = foreign.pid;

    const priorPort = await listenEphemeralPort();
    const projectDir = uiDir;
    const paths = getExpoStatePaths({
      baseDir: tmp,
      kind: 'expo-dev',
      projectDir,
      stateFileName: 'expo.state.json',
    });
    await writePidState(paths.statePath, {
      pid: foreignPid,
      port: priorPort,
      uiDir,
      projectDir,
      startedAt: new Date().toISOString(),
      webEnabled: true,
      devClientEnabled: false,
      host: 'lan',
    });

    const result = await ensureDevExpoServer({
      startUi: true,
      startMobile: false,
      uiDir,
      autostart: { baseDir: tmp },
      baseEnv: {
        ...process.env,
        HAPPIER_STACK_EXPO_DEV_PORT: String(priorPort),
        HAPPIER_STACK_EXPO_DEV_PORT_STRATEGY: 'ephemeral',
      },
      apiServerUrl: 'http://127.0.0.1:1',
      restart: true,
      stackMode: true,
      runtimeStatePath: null,
      stackName: 'dev2',
      envPath: join(tmp, 'stack.env'),
      children,
      quiet: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.port, priorPort);
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    killProcessTreeByPid(foreignPid);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('ensureDevExpoServer restarts when running Expo state targets a different API server URL', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-restart-api-url-'));
  const children = [];
  let metro = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(
      expoBin,
      [
        '#!/usr/bin/env node',
        "setInterval(() => {}, 1000);",
      ].join('\n') + '\n',
      'utf-8'
    );
    await chmod(expoBin, 0o755);

    const status = await listenMetroStatusServer();
    metro = status.server;
    const priorPort = status.port;

    const projectDir = uiDir;
    const paths = getExpoStatePaths({
      baseDir: tmp,
      kind: 'expo-dev',
      projectDir,
      stateFileName: 'expo.state.json',
    });
    await writePidState(paths.statePath, {
      pid: 999999,
      port: priorPort,
      uiDir,
      projectDir,
      startedAt: new Date().toISOString(),
      webEnabled: true,
      devClientEnabled: false,
      host: 'lan',
      apiServerUrl: 'http://localhost:3012',
    });

    const result = await ensureDevExpoServer({
      startUi: true,
      startMobile: false,
      uiDir,
      autostart: { baseDir: tmp },
      baseEnv: {
        ...process.env,
        HAPPIER_STACK_EXPO_DEV_PORT: String(priorPort),
        HAPPIER_STACK_EXPO_DEV_PORT_STRATEGY: 'ephemeral',
      },
      apiServerUrl: 'http://localhost:3014',
      restart: false,
      stackMode: true,
      runtimeStatePath: null,
      stackName: 'qa-agent-1',
      envPath: join(tmp, 'stack.env'),
      children,
      quiet: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.notEqual(result.port, priorPort);

    const nextState = JSON.parse(await readFile(paths.statePath, 'utf-8'));
    assert.equal(nextState.apiServerUrl, 'http://localhost:3014');
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    await new Promise((resolve) => metro?.close(() => resolve())).catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  }
});

test('ensureDevExpoServer restarts mobile dev-client when running Expo state targets a different API server URL', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-restart-mobile-api-url-'));
  const children = [];
  let previousExpoPid = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(
      expoBin,
      [
        '#!/usr/bin/env node',
        "setInterval(() => {}, 1000);",
      ].join('\n') + '\n',
      'utf-8'
    );
    await chmod(expoBin, 0o755);

    const projectDir = uiDir;
    const paths = getExpoStatePaths({
      baseDir: tmp,
      kind: 'expo-dev',
      projectDir,
      stateFileName: 'expo.state.json',
    });
    const stackName = 'qa-agent-mobile-api-url';
    const envPath = join(tmp, 'stack.env');
    const cliHomeDir = join(tmp, 'cli');
    await mkdir(cliHomeDir, { recursive: true });
    const previousExpo = spawnDetachedInlineNodeTestProcess('setInterval(() => {}, 1000)', {
      stdio: 'ignore',
      env: {
        ...process.env,
        __UNSAFE_EXPO_HOME_DIRECTORY: paths.expoHomeDir,
        HAPPIER_STACK_STACK: stackName,
        HAPPIER_STACK_ENV_FILE: envPath,
        HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
      },
    });
    previousExpoPid = previousExpo.pid;

    const priorPort = await listenEphemeralPort();
    await writePidState(paths.statePath, {
      pid: previousExpoPid,
      port: priorPort,
      uiDir,
      projectDir,
      startedAt: new Date().toISOString(),
      webEnabled: false,
      devClientEnabled: true,
      host: 'lan',
      apiServerUrl: 'http://192.168.1.20:3012',
    });

    const result = await ensureDevExpoServer({
      startUi: false,
      startMobile: true,
      uiDir,
      autostart: { baseDir: tmp },
      baseEnv: {
        ...process.env,
        HAPPIER_STACK_EXPO_DEV_PORT: String(priorPort),
        HAPPIER_STACK_MOBILE_SCHEME: 'happier-dev',
        HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
      },
      apiServerUrl: 'http://192.168.1.20:3014',
      restart: false,
      stackMode: true,
      runtimeStatePath: null,
      stackName,
      envPath,
      children,
      quiet: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (process.platform !== 'win32') {
      assert.equal(await waitForPidExit(previousExpoPid), true, 'expected automatic API mismatch restart to stop prior owned Expo pid');
    }

    const nextState = JSON.parse(await readFile(paths.statePath, 'utf-8'));
    assert.equal(nextState.apiServerUrl, 'http://192.168.1.20:3014');
    assert.equal(nextState.devClientEnabled, true);
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    killProcessTreeByPid(previousExpoPid);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('ensureDevExpoServer stops prior stack-owned Expo process for automatic Tailscale mismatch restart', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-restart-tailscale-'));
  const children = [];
  let previousExpoPid = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(
      expoBin,
      [
        '#!/usr/bin/env node',
        "setInterval(() => {}, 1000);",
      ].join('\n') + '\n',
      'utf-8'
    );
    await chmod(expoBin, 0o755);

    const tailscaleBin = join(tmp, 'tailscale');
    await writeFile(
      tailscaleBin,
      [
        `#!${process.execPath}`,
        "if (process.argv.slice(2).join(' ') === 'ip -4') {",
        "  console.log('127.0.0.1');",
        '  process.exit(0);',
        '}',
        'process.exit(1);',
      ].join('\n') + '\n',
      'utf-8'
    );
    await chmod(tailscaleBin, 0o755);

    const projectDir = uiDir;
    const paths = getExpoStatePaths({
      baseDir: tmp,
      kind: 'expo-dev',
      projectDir,
      stateFileName: 'expo.state.json',
    });
    const stackName = 'qa-agent-tailscale-restart';
    const envPath = join(tmp, 'stack.env');
    const cliHomeDir = join(tmp, 'cli');
    await mkdir(cliHomeDir, { recursive: true });
    const previousExpo = spawnDetachedInlineNodeTestProcess('setInterval(() => {}, 1000)', {
      stdio: 'ignore',
      env: {
        ...process.env,
        __UNSAFE_EXPO_HOME_DIRECTORY: paths.expoHomeDir,
        HAPPIER_STACK_STACK: stackName,
        HAPPIER_STACK_ENV_FILE: envPath,
        HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
      },
    });
    previousExpoPid = previousExpo.pid;

    const priorPort = await listenEphemeralPort();
    await writePidState(paths.statePath, {
      pid: previousExpoPid,
      port: priorPort,
      uiDir,
      projectDir,
      startedAt: new Date().toISOString(),
      webEnabled: false,
      devClientEnabled: true,
      host: 'localhost',
      apiServerUrl: 'http://127.0.0.1:3016',
      scheme: 'happier-dev',
      tailscaleEnabled: false,
    });

    const result = await ensureDevExpoServer({
      startUi: false,
      startMobile: true,
      uiDir,
      autostart: { baseDir: tmp },
      baseEnv: {
        ...process.env,
        HAPPIER_TAILSCALE_BIN: tailscaleBin,
        HAPPIER_STACK_EXPO_DEV_PORT: String(priorPort),
        HAPPIER_STACK_EXPO_HOST: 'localhost',
        HAPPIER_STACK_MOBILE_SCHEME: 'happier-dev',
        HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
      },
      apiServerUrl: 'http://localhost:3016',
      restart: false,
      stackMode: true,
      runtimeStatePath: null,
      stackName,
      envPath,
      children,
      expoTailscale: true,
      quiet: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    if (process.platform !== 'win32') {
      assert.equal(await waitForPidExit(previousExpoPid), true, 'expected automatic Tailscale mismatch restart to stop prior owned Expo pid');
    }

    const nextState = JSON.parse(await readFile(paths.statePath, 'utf-8'));
    assert.equal(nextState.tailscaleEnabled, true);
    assert.equal(nextState.tailscaleIp, '127.0.0.1');
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    killProcessTreeByPid(previousExpoPid);
    await rm(tmp, { recursive: true, force: true });
  }
});

test('ensureDevExpoServer in stack mode does not adopt port-only fallback as already running', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-port-fallback-stack-mode-'));
  const children = [];
  let metro = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(
      expoBin,
      [
        '#!/usr/bin/env node',
        "setInterval(() => {}, 1000);",
      ].join('\n') + '\n',
      'utf-8'
    );
    await chmod(expoBin, 0o755);

    const status = await listenMetroStatusServer();
    metro = status.server;
    const priorPort = status.port;

    const projectDir = uiDir;
    const paths = getExpoStatePaths({
      baseDir: tmp,
      kind: 'expo-dev',
      projectDir,
      stateFileName: 'expo.state.json',
    });
    await writePidState(paths.statePath, {
      pid: 999999,
      port: priorPort,
      uiDir,
      projectDir,
      startedAt: new Date().toISOString(),
      webEnabled: true,
      devClientEnabled: false,
      host: 'lan',
      apiServerUrl: 'http://localhost:3014',
    });

    const result = await ensureDevExpoServer({
      startUi: true,
      startMobile: false,
      uiDir,
      autostart: { baseDir: tmp },
      baseEnv: {
        ...process.env,
        HAPPIER_STACK_EXPO_DEV_PORT: String(priorPort),
        HAPPIER_STACK_EXPO_DEV_PORT_STRATEGY: 'ephemeral',
      },
      apiServerUrl: 'http://localhost:3014',
      restart: false,
      stackMode: true,
      runtimeStatePath: null,
      stackName: 'qa-agent-4',
      envPath: join(tmp, 'stack.env'),
      children,
      quiet: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.skipped, false);
    assert.notEqual(result.port, priorPort);
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    await new Promise((resolve) => metro?.close(() => resolve())).catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  }
});

test('ensureDevExpoServer fails closed in stable port mode when forced expo port is occupied (does not rewrite envPath)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-update-env-port-'));
  const children = [];
  let metro = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(
      expoBin,
      ['#!/usr/bin/env node', "setInterval(() => {}, 1000);"].join('\n') + '\n',
      'utf-8'
    );
    await chmod(expoBin, 0o755);

    const status = await listenMetroStatusServer();
    metro = status.server;
    const occupiedPort = status.port;

    const envPath = join(tmp, 'stack.env');
    await writeFile(envPath, `CUSTOM_KEY=1\nHAPPIER_STACK_EXPO_DEV_PORT=${occupiedPort}\n`, 'utf-8');

    await assert.rejects(
      () =>
        ensureDevExpoServer({
          startUi: true,
          startMobile: false,
          uiDir,
          autostart: { baseDir: tmp },
          baseEnv: {
            ...process.env,
            HAPPIER_STACK_EXPO_DEV_PORT: String(occupiedPort),
            HAPPIER_STACK_EXPO_DEV_PORT_STRATEGY: 'stable',
            HAPPIER_STACK_EXPO_DEV_PORT_BASE: '51000',
            HAPPIER_STACK_EXPO_DEV_PORT_RANGE: '2000',
          },
          apiServerUrl: 'http://127.0.0.1:1',
          restart: false,
          stackMode: true,
          runtimeStatePath: null,
          stackName: 'qa-agent-update-env',
          envPath,
          children,
          quiet: true,
        }),
      /expo port/i
    );

    const updated = await readFile(envPath, 'utf-8');
    assert.match(updated, /\bCUSTOM_KEY=1\b/);
    assert.match(updated, new RegExp(`\\bHAPPIER_STACK_EXPO_DEV_PORT=${occupiedPort}\\b`));
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    await new Promise((resolve) => metro?.close(() => resolve())).catch(() => {});
    await rm(tmp, { recursive: true, force: true });
  }
});

test('ensureDevExpoServer in stable port mode stops stack-owned leftover Expo processes holding the forced port (no bump)', async () => {
  const tmp = await mkdtemp(join(tmpdir(), 'hstack-expo-stable-stop-leftovers-'));
  const children = [];
  let holderPid = null;
  try {
    const uiDir = join(tmp, 'ui');
    await mkdir(join(uiDir, 'node_modules', '.bin'), { recursive: true });
    await mkdir(join(uiDir, 'node_modules'), { recursive: true });
    await writeFile(join(uiDir, 'package.json'), JSON.stringify({ name: 'fake-ui', private: true }) + '\n', 'utf-8');

    const expoBin = join(uiDir, 'node_modules', '.bin', 'expo');
    await writeFile(expoBin, ['#!/usr/bin/env node', "setInterval(() => {}, 1000);"].join('\n') + '\n', 'utf-8');
    await chmod(expoBin, 0o755);

    const occupiedPort = await listenEphemeralPort();
    const projectDir = uiDir;
    const paths = getExpoStatePaths({
      baseDir: tmp,
      kind: 'expo-dev',
      projectDir,
      stateFileName: 'expo.state.json',
    });

    const stackName = 'qa-owned-expo-leftover';
    const cliHomeDir = join(tmp, 'cli');
    await mkdir(cliHomeDir, { recursive: true });

    // Spawn a process that (1) holds the port and (2) carries the same Expo isolation env marker,
    // so ensureDevExpoServer can identify and stop it without bumping the stable port.
    const holder = spawnDetachedTestProcess(
      process.execPath,
      [
        '-e',
        [
          "const net = require('net');",
          'const port = Number(process.env.TEST_PORT);',
          "const srv = net.createServer(() => {});",
          "srv.listen(port, '127.0.0.1');",
          "setInterval(() => {}, 1000);",
        ].join(''),
      ],
      {
        stdio: 'ignore',
        env: {
          ...process.env,
          TEST_PORT: String(occupiedPort),
          __UNSAFE_EXPO_HOME_DIRECTORY: paths.expoHomeDir,
          HAPPIER_STACK_STACK: stackName,
          HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
        },
      }
    );
    holderPid = holder.pid;

    const envPath = join(tmp, 'stack.env');
    await writeFile(envPath, `HAPPIER_STACK_EXPO_DEV_PORT=${occupiedPort}\n`, 'utf-8');

    const result = await ensureDevExpoServer({
      startUi: true,
      startMobile: false,
      uiDir,
      autostart: { baseDir: tmp },
      baseEnv: {
        ...process.env,
        HAPPIER_STACK_EXPO_DEV_PORT: String(occupiedPort),
        HAPPIER_STACK_EXPO_DEV_PORT_STRATEGY: 'stable',
        HAPPIER_STACK_CLI_HOME_DIR: cliHomeDir,
      },
      apiServerUrl: 'http://127.0.0.1:1',
      restart: false,
      stackMode: true,
      runtimeStatePath: null,
      stackName,
      envPath,
      children,
      quiet: true,
    });

    assert.equal(result.ok, true);
    assert.equal(result.port, occupiedPort);
  } finally {
    for (const child of children) {
      killProcessTreeByPid(child?.pid);
    }
    killProcessTreeByPid(holderPid);
    await rm(tmp, { recursive: true, force: true });
  }
});
