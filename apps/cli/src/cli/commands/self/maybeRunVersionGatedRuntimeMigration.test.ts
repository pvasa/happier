import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type MockDaemonServiceListEntry = {
  serverId: string;
  name: string;
  installed: boolean;
  path: string;
  platform: string;
  mode: 'user' | 'system';
  releaseChannel: string;
  label: string;
  targetMode: string;
};

const {
  handleServiceRepairCliCommandMock,
  resolveDaemonServiceCliRuntimeFromEnvMock,
  resolveDaemonServiceListEntriesMock,
} = vi.hoisted(() => ({
  handleServiceRepairCliCommandMock: vi.fn(async (_params: unknown) => undefined),
  resolveDaemonServiceCliRuntimeFromEnvMock: vi.fn((_params?: unknown) => ({
    platform: 'linux',
    mode: 'user',
    systemUser: '',
    channel: 'preview',
    targetMode: 'default-following',
    instanceId: 'default',
    uid: 1000,
    userHomeDir: '/tmp/user',
    happierHomeDir: '/tmp/user/.happier',
    serverUrl: 'https://company.example.test',
    publicServerUrl: 'https://company.example.test',
    webappUrl: 'https://company.example.test',
  })),
  resolveDaemonServiceListEntriesMock: vi.fn<(_runtime: unknown, _options?: unknown) => Promise<MockDaemonServiceListEntry[]>>(async (_runtime: unknown, _options?: unknown) => []),
}));

vi.mock('@/daemon/service/cli', () => ({
  resolveDaemonServiceCliRuntimeFromEnv: (params?: unknown) => resolveDaemonServiceCliRuntimeFromEnvMock(params),
  resolveDaemonServiceListEntries: (runtime: unknown, options?: unknown) => resolveDaemonServiceListEntriesMock(runtime, options),
}));

vi.mock('../serviceRepair/handleServiceRepairCliCommand', () => ({
  handleServiceRepairCliCommand: (params: unknown) => handleServiceRepairCliCommandMock(params),
}));

describe('maybeRunVersionGatedRuntimeMigration', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    handleServiceRepairCliCommandMock.mockClear();
    resolveDaemonServiceCliRuntimeFromEnvMock.mockClear();
    resolveDaemonServiceListEntriesMock.mockClear();
  });

  it('delegates to one aggregated repair pass when an update crosses the 0.2.3 migration boundary and repair work exists', async () => {
    resolveDaemonServiceListEntriesMock.mockImplementation(async (_runtime: unknown, options?: unknown) => {
      const normalizedOptions = options as { mode?: 'user' | 'system' } | undefined;
      if (normalizedOptions?.mode === 'user') {
        return [{
          serverId: 'company',
          name: 'Company',
          installed: true,
          path: '/tmp/user/.config/systemd/user/happier-daemon.preview.company.service',
          platform: 'linux',
          mode: 'user',
          releaseChannel: 'preview',
          label: 'happier-daemon.preview.company',
          targetMode: 'pinned',
        }];
      }
      return [];
    });

    const { maybeRunVersionGatedRuntimeMigration } = await import('./maybeRunVersionGatedRuntimeMigration');

    await expect(maybeRunVersionGatedRuntimeMigration({
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      argv: ['repair'],
      commandPath: 'happier self migrate',
    })).resolves.toBe(true);

    expect(resolveDaemonServiceCliRuntimeFromEnvMock).toHaveBeenCalled();
    expect(resolveDaemonServiceListEntriesMock).toHaveBeenCalled();
    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledWith({
      argv: ['repair'],
      commandPath: 'happier self migrate',
    });
  });

  it('skips repair when the version change did not cross the migration boundary', async () => {
    const { maybeRunVersionGatedRuntimeMigration } = await import('./maybeRunVersionGatedRuntimeMigration');

    await expect(maybeRunVersionGatedRuntimeMigration({
      fromVersion: '0.2.3',
      toVersion: '0.2.4',
      argv: ['repair'],
      commandPath: 'happier self migrate',
    })).resolves.toBe(false);

    expect(resolveDaemonServiceCliRuntimeFromEnvMock).not.toHaveBeenCalled();
    expect(handleServiceRepairCliCommandMock).not.toHaveBeenCalled();
  });

  it('skips automatic migration when aggregated repair would require system-mode actions without root', async () => {
    resolveDaemonServiceListEntriesMock.mockImplementation(async (_runtime: unknown, options?: unknown) => {
      const normalizedOptions = options as { mode?: 'user' | 'system' } | undefined;
      if (normalizedOptions?.mode === 'system') {
        return [{
          serverId: 'company',
          name: 'Company',
          installed: true,
          path: '/etc/systemd/system/happier-daemon.preview.company.service',
          platform: 'linux',
          mode: 'system',
          releaseChannel: 'preview',
          label: 'happier-daemon.preview.company',
          targetMode: 'pinned',
        }];
      }
      return [];
    });

    const { maybeRunVersionGatedRuntimeMigration } = await import('./maybeRunVersionGatedRuntimeMigration');

    await expect(maybeRunVersionGatedRuntimeMigration({
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      argv: ['repair'],
      commandPath: 'happier self migrate',
    })).resolves.toBe(false);

    expect(handleServiceRepairCliCommandMock).not.toHaveBeenCalled();
  });

  it('aggregates user and system services into one repair invocation when root is available', async () => {
    resolveDaemonServiceCliRuntimeFromEnvMock.mockImplementation((params?: unknown) => {
      const normalizedParams = params as { mode?: 'user' | 'system' } | undefined;
      return {
        platform: 'linux',
        mode: normalizedParams?.mode ?? 'user',
        systemUser: '',
        channel: 'preview',
        targetMode: 'default-following',
        instanceId: 'default',
        uid: 0,
        userHomeDir: '/tmp/user',
        happierHomeDir: '/tmp/user/.happier',
        serverUrl: 'https://company.example.test',
        publicServerUrl: 'https://company.example.test',
        webappUrl: 'https://company.example.test',
      };
    });

    resolveDaemonServiceListEntriesMock.mockImplementation(async (_runtime: unknown, options?: unknown) => {
      const normalizedOptions = options as { mode?: 'user' | 'system' } | undefined;
      if (normalizedOptions?.mode === 'system') {
        return [{
          serverId: 'default',
          name: 'Default background service',
          installed: true,
          path: '/etc/systemd/system/happier-daemon.default.service',
          platform: 'linux',
          mode: 'system',
          releaseChannel: 'preview',
          label: 'happier-daemon.default',
          targetMode: 'default-following',
        }];
      }
      return [{
        serverId: 'default',
        name: 'Default background service',
        installed: true,
        path: '/home/test/.config/systemd/user/happier-daemon.default.service',
        platform: 'linux',
        mode: 'user',
        releaseChannel: 'preview',
        label: 'happier-daemon.default',
        targetMode: 'default-following',
        }];
    });

    const { maybeRunVersionGatedRuntimeMigration } = await import('./maybeRunVersionGatedRuntimeMigration');

    await expect(maybeRunVersionGatedRuntimeMigration({
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      argv: ['repair'],
      commandPath: 'happier self migrate',
    })).resolves.toBe(true);

    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledTimes(1);
    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledWith({
      argv: ['repair'],
      commandPath: 'happier self migrate',
    });
  });

  it('skips unsupported system-scoped migration passes on non-linux platforms', async () => {
    resolveDaemonServiceCliRuntimeFromEnvMock.mockImplementation((params?: unknown) => {
      const normalizedParams = params as { mode?: 'user' | 'system' } | undefined;
      return {
        platform: 'darwin',
        mode: normalizedParams?.mode ?? 'user',
        systemUser: '',
        channel: 'preview',
        targetMode: 'default-following',
        instanceId: 'default',
        uid: 501,
        userHomeDir: '/tmp/user',
        happierHomeDir: '/tmp/user/.happier',
        serverUrl: 'https://company.example.test',
        publicServerUrl: 'https://company.example.test',
        webappUrl: 'https://company.example.test',
      };
    });

    resolveDaemonServiceListEntriesMock.mockImplementation(async (_runtime: unknown, options?: unknown) => {
      const normalizedOptions = options as { mode?: 'user' | 'system' } | undefined;
      return normalizedOptions?.mode === 'user'
        ? [{
            serverId: 'company',
            name: 'Company',
            installed: true,
            path: '/Users/test/Library/LaunchAgents/com.happier.cli.daemon.preview.company.plist',
            platform: 'darwin',
            mode: 'user',
            releaseChannel: 'preview',
            label: 'com.happier.cli.daemon.preview.company',
            targetMode: 'pinned',
          }]
        : [];
    });

    const { maybeRunVersionGatedRuntimeMigration } = await import('./maybeRunVersionGatedRuntimeMigration');

    await expect(maybeRunVersionGatedRuntimeMigration({
      fromVersion: '0.2.2',
      toVersion: '0.2.3',
      argv: ['repair'],
      commandPath: 'happier self migrate',
    })).resolves.toBe(true);

    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledTimes(1);
    expect(handleServiceRepairCliCommandMock).toHaveBeenCalledWith({
      argv: ['repair'],
      commandPath: 'happier self migrate',
    });
  });
});
