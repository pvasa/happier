import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname } from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { reloadConfiguration } from '@/configuration';
import { writeCredentialsLegacy } from '@/persistence';
import { addServerProfile, useServerProfile } from '@/server/serverProfiles';
import { captureConsoleLogAndMuteStdout } from '@/testkit/logger/captureOutput';
import { buildLaunchAgentPlistXml } from '@/daemon/service/darwin';
import { resolveDaemonServiceCliRuntimeFromEnv, resolveDaemonServicePaths, type DaemonServiceListEntry } from '@/daemon/service/cli';
import { renderSystemdServiceUnit, renderWindowsScheduledTaskWrapperPs1 } from '@happier-dev/cli-common/service';

const promptAnswers: string[] = [];
const promptQuestions: string[] = [];
const { spawnHappyCLIMock, resolveInstalledDaemonServiceInventoryForCurrentRelayMock } = vi.hoisted(() => ({
    spawnHappyCLIMock: vi.fn(),
    resolveInstalledDaemonServiceInventoryForCurrentRelayMock: vi.fn<(...args: unknown[]) => Promise<readonly DaemonServiceListEntry[]>>(async () => []),
}));

vi.mock('node:readline', () => ({
    createInterface: () => ({
        question: (prompt: string, cb: (answer: string) => void) => {
            promptQuestions.push(prompt);
            cb(promptAnswers.shift() ?? '');
        },
        close: () => {},
    }),
}));

vi.mock('@/utils/spawnHappyCLI', () => ({
    spawnHappyCLI: (...args: unknown[]) => spawnHappyCLIMock(...args),
}));

vi.mock('@/daemon/ownership/daemonServiceInventory', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/daemon/ownership/daemonServiceInventory')>();
    return {
        ...actual,
        resolveInstalledDaemonServiceInventoryForCurrentRelay: (...args: Parameters<typeof actual.resolveInstalledDaemonServiceInventoryForCurrentRelay>) =>
            resolveInstalledDaemonServiceInventoryForCurrentRelayMock(...args),
    };
});

function installDefaultFollowingServiceFixture(homeDir: string): void {
    process.env.HAPPIER_DAEMON_SERVICE_PLATFORM = process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
        ? process.platform
        : 'linux';
    process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR = homeDir;
    process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR = join(homeDir, '.happier');
    process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE = 'default-following';
    reloadConfiguration();

    const runtime = resolveDaemonServiceCliRuntimeFromEnv({ processEnv: process.env });
    const paths = resolveDaemonServicePaths(runtime);
    mkdirSync(dirname(paths.installedPath), { recursive: true });

    if (runtime.platform === 'darwin') {
        writeFileSync(
            paths.installedPath,
            buildLaunchAgentPlistXml({
                label: paths.label,
                programArgs: [runtime.nodePath, runtime.entryPath, 'daemon', 'start-sync'].filter(Boolean),
                env: {
                    HAPPIER_HOME_DIR: join(homeDir, '.happier'),
                    HAPPIER_PUBLIC_RELEASE_CHANNEL: runtime.channel,
                    HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
                    HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
                },
                stdoutPath: paths.stdoutPath,
                stderrPath: paths.stderrPath,
                workingDirectory: '/tmp',
            }),
            'utf8',
        );
        return;
    }

    if (runtime.platform === 'linux') {
        writeFileSync(
            paths.installedPath,
            renderSystemdServiceUnit({
                description: 'Happier Daemon',
                execStart: [runtime.nodePath, runtime.entryPath, 'daemon', 'start-sync'].filter(Boolean),
                env: {
                    HAPPIER_HOME_DIR: join(homeDir, '.happier'),
                    HAPPIER_PUBLIC_RELEASE_CHANNEL: runtime.channel,
                    HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
                    HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
                },
                wantedBy: 'default.target',
            }),
            'utf8',
        );
        return;
    }

    writeFileSync(
        paths.installedPath,
        renderWindowsScheduledTaskWrapperPs1({
            programArgs: [runtime.nodePath, runtime.entryPath, 'daemon', 'start-sync'].filter(Boolean),
            env: {
                HAPPIER_HOME_DIR: join(homeDir, '.happier'),
                HAPPIER_PUBLIC_RELEASE_CHANNEL: runtime.channel,
                HAPPIER_DAEMON_STARTUP_SOURCE: 'background-service',
                HAPPIER_DAEMON_SERVICE_TARGET_MODE: 'default-following',
            },
        }),
        'utf8',
    );
}

function setTtyMode(stdinIsTTY: boolean, stdoutIsTTY: boolean): () => void {
    const stdinDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: stdinIsTTY });
    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: stdoutIsTTY });

    return () => {
        if (stdinDescriptor) Object.defineProperty(process.stdin, 'isTTY', stdinDescriptor);
        else delete (process.stdin as { isTTY?: boolean }).isTTY;
        if (stdoutDescriptor) Object.defineProperty(process.stdout, 'isTTY', stdoutDescriptor);
        else delete (process.stdout as { isTTY?: boolean }).isTTY;
    };
}

describe('happier server background service follow-up', () => {
    afterEach(() => {
        vi.restoreAllMocks();
        spawnHappyCLIMock.mockReset();
        resolveInstalledDaemonServiceInventoryForCurrentRelayMock.mockReset();
        promptAnswers.length = 0;
        promptQuestions.length = 0;
    });

    it('prompts to restart a default-following background service after switching active servers', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happier-server-use-followup-'));
        const previousHome = process.env.HAPPIER_HOME_DIR;
        const prevDaemonPlatform = process.env.HAPPIER_DAEMON_SERVICE_PLATFORM;
        const prevDaemonUserHomeDir = process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR;
        const prevDaemonHappierHomeDir = process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR;
        const prevDaemonTargetMode = process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE;
        const restoreTty = setTtyMode(true, true);

        try {
            process.env.HAPPIER_HOME_DIR = home;
            reloadConfiguration();

            const serverA = await addServerProfile({
                name: 'A',
                serverUrl: 'https://a.example.test',
                webappUrl: 'https://a.example.test',
                use: true,
            });
            const serverB = await addServerProfile({
                name: 'B',
                serverUrl: 'https://b.example.test',
                webappUrl: 'https://b.example.test',
                use: false,
            });

            await useServerProfile(serverB.id);
            reloadConfiguration();
            await writeCredentialsLegacy({
                token: 'token-b',
                secret: new Uint8Array([1, 2, 3, 4]),
            });
            await useServerProfile(serverA.id);
            reloadConfiguration();

            resolveInstalledDaemonServiceInventoryForCurrentRelayMock.mockResolvedValueOnce([
                {
                    serverId: 'default',
                    name: 'Default background service',
                    installed: true,
                    path: '/tmp/happier-daemon.default.service',
                    platform: process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
                        ? process.platform
                        : 'darwin',
                    releaseChannel: 'stable',
                    label: 'happier-daemon.default',
                    targetMode: 'default-following',
                },
            ]);
            spawnHappyCLIMock.mockReturnValue({
                on: (event: string, cb: (value?: number) => void) => {
                    if (event === 'close') cb(0);
                    return undefined;
                },
            });
            promptAnswers.push('y');

            const { handleServerCommand } = await import('./server');
            await handleServerCommand(['use', serverB.id]);

            expect(spawnHappyCLIMock).toHaveBeenCalledWith(['service', 'restart'], expect.objectContaining({
                stdio: 'inherit',
            }));
        } finally {
            restoreTty();
            if (previousHome === undefined) delete process.env.HAPPIER_HOME_DIR;
            else process.env.HAPPIER_HOME_DIR = previousHome;
            if (prevDaemonPlatform === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_PLATFORM;
            else process.env.HAPPIER_DAEMON_SERVICE_PLATFORM = prevDaemonPlatform;
            if (prevDaemonUserHomeDir === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR;
            else process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR = prevDaemonUserHomeDir;
            if (prevDaemonHappierHomeDir === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR;
            else process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR = prevDaemonHappierHomeDir;
            if (prevDaemonTargetMode === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE;
            else process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE = prevDaemonTargetMode;
            reloadConfiguration();
            await rm(home, { recursive: true, force: true });
        }
    });

    it('prints manual follow-up guidance in non-interactive mode when a default-following background service exists', async () => {
        const home = await mkdtemp(join(tmpdir(), 'happier-server-use-noninteractive-followup-'));
        const previousHome = process.env.HAPPIER_HOME_DIR;
        const prevDaemonPlatform = process.env.HAPPIER_DAEMON_SERVICE_PLATFORM;
        const prevDaemonUserHomeDir = process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR;
        const prevDaemonHappierHomeDir = process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR;
        const prevDaemonTargetMode = process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE;
        const restoreTty = setTtyMode(false, false);
        const output = captureConsoleLogAndMuteStdout();

        try {
            process.env.HAPPIER_HOME_DIR = home;
            reloadConfiguration();

            await addServerProfile({
                name: 'A',
                serverUrl: 'https://a.example.test',
                webappUrl: 'https://a.example.test',
                use: true,
            });
            const serverB = await addServerProfile({
                name: 'B',
                serverUrl: 'https://b.example.test',
                webappUrl: 'https://b.example.test',
                use: false,
            });

            resolveInstalledDaemonServiceInventoryForCurrentRelayMock.mockResolvedValueOnce([
                {
                    serverId: 'default',
                    name: 'Default background service',
                    installed: true,
                    path: '/tmp/happier-daemon.default.service',
                    platform: process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
                        ? process.platform
                        : 'darwin',
                    releaseChannel: 'stable',
                    label: 'happier-daemon.default',
                    targetMode: 'default-following',
                },
            ]);

            const { handleServerCommand } = await import('./server');
            await handleServerCommand(['use', serverB.id]);

            expect(spawnHappyCLIMock).not.toHaveBeenCalled();
            const out = output.logs.join('\n');
            expect(out).toContain('happier service restart');
            expect(out).toContain('https://b.example.test');
        } finally {
            output.restore();
            restoreTty();
            if (previousHome === undefined) delete process.env.HAPPIER_HOME_DIR;
            else process.env.HAPPIER_HOME_DIR = previousHome;
            if (prevDaemonPlatform === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_PLATFORM;
            else process.env.HAPPIER_DAEMON_SERVICE_PLATFORM = prevDaemonPlatform;
            if (prevDaemonUserHomeDir === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR;
            else process.env.HAPPIER_DAEMON_SERVICE_USER_HOME_DIR = prevDaemonUserHomeDir;
            if (prevDaemonHappierHomeDir === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR;
            else process.env.HAPPIER_DAEMON_SERVICE_HAPPIER_HOME_DIR = prevDaemonHappierHomeDir;
            if (prevDaemonTargetMode === undefined) delete process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE;
            else process.env.HAPPIER_DAEMON_SERVICE_TARGET_MODE = prevDaemonTargetMode;
            reloadConfiguration();
            await rm(home, { recursive: true, force: true });
        }
    });

    it('fails closed with repair guidance when duplicate user and system default-following services exist', async () => {
        const output = captureConsoleLogAndMuteStdout();
        const home = await mkdtemp(join(tmpdir(), 'happier-server-use-duplicate-followup-'));
        const previousHome = process.env.HAPPIER_HOME_DIR;

        try {
            process.env.HAPPIER_HOME_DIR = home;
            reloadConfiguration();

            const serverA = await addServerProfile({
                name: 'A',
                serverUrl: 'https://a.example.test',
                webappUrl: 'https://a.example.test',
                use: true,
            });
            const serverB = await addServerProfile({
                name: 'B',
                serverUrl: 'https://b.example.test',
                webappUrl: 'https://b.example.test',
                use: false,
            });

            await useServerProfile(serverB.id);
            reloadConfiguration();
            await writeCredentialsLegacy({
                token: 'token-b',
                secret: new Uint8Array([1, 2, 3, 4]),
            });
            await useServerProfile(serverA.id);
            reloadConfiguration();

            resolveInstalledDaemonServiceInventoryForCurrentRelayMock.mockResolvedValueOnce([
                {
                    serverId: 'default',
                    name: 'Default background service',
                    installed: true,
                    path: '/tmp/happier-daemon.default.service',
                    platform: 'linux',
                    releaseChannel: 'stable',
                    label: 'happier-daemon.default',
                    targetMode: 'default-following',
                },
                {
                    serverId: 'default',
                    name: 'Default background service',
                    installed: true,
                    path: '/etc/systemd/system/happier-daemon.default.service',
                    platform: 'linux',
                    releaseChannel: 'stable',
                    label: 'happier-daemon.default.system',
                    targetMode: 'default-following',
                },
            ]);
            promptAnswers.push('y');

            const { handleServerCommand } = await import('./server');
            await handleServerCommand(['use', serverB.id]);

            expect(spawnHappyCLIMock).not.toHaveBeenCalled();
            expect(output.logs.join('\n')).toContain('Multiple default-following background services are installed');
            expect(output.logs.join('\n')).toContain('happier service repair --yes');
        } finally {
            output.restore();
            if (previousHome === undefined) delete process.env.HAPPIER_HOME_DIR;
            else process.env.HAPPIER_HOME_DIR = previousHome;
            reloadConfiguration();
            await rm(home, { recursive: true, force: true });
        }
    });

    it('uses the explicit service mode when rendering restart guidance', async () => {
        const { runDefaultFollowingBackgroundServiceServerChangeFollowUp, resolveInstalledDefaultFollowingDaemonServiceModes } =
            await import('./backgroundServiceFollowUp');
        const output: string[] = [];

        await runDefaultFollowingBackgroundServiceServerChangeFollowUp({
            interactive: false,
            promptInput: async () => '',
            runCliAction: vi.fn(async () => undefined),
            targetServerUrl: 'https://b.example.test',
            hasCredentials: true,
            log: (message) => output.push(message),
            services: [{
                serverId: 'default',
                name: 'Default background service',
                installed: true,
                path: '/tmp/happier-daemon.default.service',
                platform: 'linux',
                mode: 'system',
                releaseChannel: 'stable',
                label: 'happier-daemon.default',
                targetMode: 'default-following',
            }],
        });

        expect(resolveInstalledDefaultFollowingDaemonServiceModes([{
            serverId: 'default',
            name: 'Default background service',
            installed: true,
            path: '/tmp/happier-daemon.default.service',
            platform: 'linux',
            mode: 'system',
            releaseChannel: 'stable',
            label: 'happier-daemon.default',
            targetMode: 'default-following',
        }])).toEqual(['system']);
        expect(output.join('\n')).toContain('happier service restart --mode system');
    });
});
