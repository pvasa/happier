import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureConsoleText } from '@/testkit/logger/captureOutput';

const {
  buildDoctorSnapshotMock,
  checkIfDaemonRunningAndCleanupStaleStateMock,
  findAllHappyProcessesMock,
  findRunawayHappyProcessesMock,
  readCredentialsMock,
  readDaemonStateMock,
  readSettingsMock,
} = vi.hoisted(() => ({
  buildDoctorSnapshotMock: vi.fn(async () => ({
    capturedAt: '2026-04-09T00:00:00.000Z',
    server: {
      activeServerId: 'cloud',
      serverUrl: 'https://relay.example.test',
      publicServerUrl: 'https://relay.example.test',
      webappUrl: 'https://app.example.test',
    },
    accountId: 'acct_123',
    settings: {
      activeServerId: 'cloud',
      servers: [
        {
          id: 'cloud',
          name: 'Happier Cloud',
          serverUrl: 'https://relay.example.test',
          publicServerUrl: 'https://relay.example.test',
          webappUrl: 'https://app.example.test',
          createdAt: 0,
          updatedAt: 0,
          lastUsedAt: 0,
        },
      ],
      knownAccountIds: ['acct_123'],
    },
  })),
  checkIfDaemonRunningAndCleanupStaleStateMock: vi.fn(async () => true),
  findAllHappyProcessesMock: vi.fn(async () => []),
  findRunawayHappyProcessesMock: vi.fn(async () => []),
  readCredentialsMock: vi.fn(async () => ({ token: 'header.payload.sig' })),
  readDaemonStateMock: vi.fn(async () => ({
    pid: 4321,
    httpPort: 7777,
    startedAt: Date.now(),
    startedWithCliVersion: '0.0.0-other',
    startedWithPublicReleaseChannel: 'preview',
    startupSource: 'background-service',
    serviceManaged: true,
    serviceLabel: 'com.happier.cli.daemon.default',
    runtimeId: 'runtime-123',
  })),
  readSettingsMock: vi.fn(async () => ({
    schemaVersion: 5,
    onboardingCompleted: true,
    activeServerId: 'cloud',
    servers: {
      cloud: {
        id: 'cloud',
        name: 'Happier Cloud',
        serverUrl: 'https://relay.example.test',
        publicServerUrl: 'https://relay.example.test',
        webappUrl: 'https://app.example.test',
        createdAt: 0,
        updatedAt: 0,
        lastUsedAt: 0,
      },
    },
  })),
}));

vi.mock('@/configuration', () => ({
  configuration: {
    activeServerId: 'cloud',
    serverUrl: 'https://relay.example.test',
    publicServerUrl: 'https://relay.example.test',
    webappUrl: 'https://app.example.test',
    publicReleaseRing: 'stable',
    happyHomeDir: '/tmp/user/.happier',
    logsDir: '/tmp/user/.happier/logs',
    daemonStateFile: '/tmp/user/.happier/daemon.state.json',
    currentCliVersion: '9.9.9',
  },
}));

vi.mock('@/persistence', () => ({
  readCredentials: () => readCredentialsMock(),
  readDaemonState: () => readDaemonStateMock(),
  readSettings: () => readSettingsMock(),
}));

vi.mock('@/daemon/controlClient', () => ({
  checkIfDaemonRunningAndCleanupStaleState: () => checkIfDaemonRunningAndCleanupStaleStateMock(),
}));

vi.mock('@/daemon/doctor', () => ({
  findAllHappyProcesses: () => findAllHappyProcessesMock(),
  findRunawayHappyProcesses: () => findRunawayHappyProcessesMock(),
}));

vi.mock('@/ui/doctorSnapshot', () => ({
  buildDoctorSnapshot: () => buildDoctorSnapshotMock(),
}));

import { runDoctorCommand } from './doctor';

describe('doctor cleanup ownership summary', () => {
  afterEach(() => {
    buildDoctorSnapshotMock.mockClear();
    checkIfDaemonRunningAndCleanupStaleStateMock.mockClear();
    findAllHappyProcessesMock.mockClear();
    findRunawayHappyProcessesMock.mockClear();
    readCredentialsMock.mockClear();
    readDaemonStateMock.mockClear();
    readSettingsMock.mockClear();
    vi.restoreAllMocks();
  });

  it('shows an ownership summary for cleanup guidance when the current relay owner differs from this installation', async () => {
    const output = captureConsoleText();

    try {
      await runDoctorCommand('all');

      expect(output.text()).toContain('Cleanup ownership summary');
      expect(output.text()).toContain('Current owner:');
      expect(output.text()).toContain('happier service restart');
    } finally {
      output.restore();
    }
  });
});
