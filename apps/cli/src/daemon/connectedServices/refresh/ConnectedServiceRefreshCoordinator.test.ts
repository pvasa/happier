import { lstat, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';

import { sealAccountScopedBlobCiphertext } from '@happier-dev/protocol';
import { openConnectedServiceCredentialCiphertext } from '@happier-dev/protocol';
import { ConnectedServiceCredentialRecordV1Schema } from '@happier-dev/protocol';

import type { Credentials } from '@/persistence';
import type { ApiClient } from '@/api/api';
import { logger } from '@/ui/logger';
import { buildConnectedServiceCredentialRecord } from '@happier-dev/protocol';
import { ConnectedServiceRefreshCoordinator } from './ConnectedServiceRefreshCoordinator';
import { HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY } from '../connectedServiceChildEnvironment';
import { resolveConnectedServiceGroupHomeDir } from '../homes/resolveConnectedServiceHomeDir';

describe('ConnectedServiceRefreshCoordinator', () => {
  it('refreshes an expiring openai-codex credential and re-materializes for active spawn targets', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');
    const legacySecret = credentials.encryption.secret;

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

	    const api = {
	      getConnectedServiceCredentialSealed: vi.fn(async () => ({
	        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
	        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 30_000 },
	      })),
	      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
	      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
	        sealedCiphertext = params.sealed.ciphertext;
	      }),
	      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
	    } as unknown as ApiClient;

	    const fetchMock = vi.fn(async () => ({
	      ok: true,
	      json: async () => ({
	        access_token: 'new-access',
	        refresh_token: 'new-refresh',
	        id_token: 'new-id',
	        expires_in: 3600,
	      }),
	    }));
	    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
      logRefreshDiagnostic: vi.fn(),
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-1',
    });

    await coordinator.tickOnce();

    expect(api.acquireConnectedServiceRefreshLease).toHaveBeenCalledTimes(1);
    expect(api.registerConnectedServiceCredentialSealed).toHaveBeenCalledTimes(1);

    const codexHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex', 'codex-home');
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('new-access');
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      health: {
        v: 1,
        status: 'connected',
        reconnectRequired: false,
        lastRefreshAttemptAt: now,
        lastRefreshSuccessAt: now,
      },
    });
  });

  it('refreshes plaintext credentials through the plaintext credential endpoint', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-plain-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-plain-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const now = 1_000_000;
    let storedRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => 'plain' as const),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: storedRecord } })),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialPlain: vi.fn(async (params: { content: { v: typeof storedRecord } }) => {
        storedRecord = params.content.v;
      }),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'new-id',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-plain',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    coordinator.registerSpawnTarget({
      pid: 456,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-plain',
    });

    await coordinator.tickOnce();

    const typedApi = api as unknown as {
      getConnectedServiceCredentialPlain: ReturnType<typeof vi.fn>;
      getConnectedServiceCredentialSealed: ReturnType<typeof vi.fn>;
      registerConnectedServiceCredentialPlain: ReturnType<typeof vi.fn>;
      registerConnectedServiceCredentialSealed: ReturnType<typeof vi.fn>;
    };
    expect(typedApi.getConnectedServiceCredentialPlain).toHaveBeenCalled();
    expect(typedApi.getConnectedServiceCredentialSealed).not.toHaveBeenCalled();
    expect(typedApi.registerConnectedServiceCredentialPlain).toHaveBeenCalledTimes(1);
    expect(typedApi.registerConnectedServiceCredentialSealed).not.toHaveBeenCalled();
    expect(storedRecord.oauth?.accessToken).toBe('new-access');

    const codexHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex', 'codex-home');
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('new-access');
  });

  it('falls back to plaintext credentials when the account-mode probe errors', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-plain-fallback-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-plain-fallback-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };

    const now = 1_000_000;
    let storedRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('mode probe failed');
      }),
      getConnectedServiceCredentialPlain: vi.fn(async () => ({ content: { t: 'plain' as const, v: storedRecord } })),
      getConnectedServiceCredentialSealed: vi.fn(async () => null),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialPlain: vi.fn(async (params: { content: { v: typeof storedRecord } }) => {
        storedRecord = params.content.v;
      }),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'new-id',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-plain-fallback',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    coordinator.registerSpawnTarget({
      pid: 456,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-plain-fallback',
    });

    await coordinator.tickOnce();

    const typedApi = api as unknown as {
      getConnectedServiceCredentialPlain: ReturnType<typeof vi.fn>;
      getConnectedServiceCredentialSealed: ReturnType<typeof vi.fn>;
      registerConnectedServiceCredentialPlain: ReturnType<typeof vi.fn>;
      registerConnectedServiceCredentialSealed: ReturnType<typeof vi.fn>;
    };
    expect(typedApi.getConnectedServiceCredentialPlain).toHaveBeenCalled();
    expect(typedApi.getConnectedServiceCredentialSealed).not.toHaveBeenCalled();
    expect(typedApi.registerConnectedServiceCredentialPlain).toHaveBeenCalledTimes(1);
    expect(typedApi.registerConnectedServiceCredentialSealed).not.toHaveBeenCalled();
    expect(storedRecord.oauth?.accessToken).toBe('new-access');

    const codexHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex', 'codex-home');
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('new-access');
  });

  it('falls back to sealed credentials when the account-mode probe errors and plaintext read fails', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-sealed-fallback-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-sealed-fallback-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');
    const legacySecret = credentials.encryption.secret;

    const now = 1_000_000;
    let storedRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: storedRecord,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getAccountEncryptionMode: vi.fn(async () => {
        throw new Error('mode probe failed');
      }),
      getConnectedServiceCredentialPlain: vi.fn(async () => {
        throw new Error('plain read failed');
      }),
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1' as const, ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 30_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialPlain: vi.fn(async () => {}),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
        const opened = openConnectedServiceCredentialCiphertext({
          material: { type: 'legacy', secret: legacySecret },
          ciphertext: params.sealed.ciphertext,
        });
        if (!opened?.value) throw new Error('expected opened record');
        storedRecord = ConnectedServiceCredentialRecordV1Schema.parse(opened.value);
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'new-id',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-sealed-fallback',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    coordinator.registerSpawnTarget({
      pid: 456,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-sealed-fallback',
    });

    await coordinator.tickOnce();

    const typedApi = api as unknown as {
      getConnectedServiceCredentialPlain: ReturnType<typeof vi.fn>;
      getConnectedServiceCredentialSealed: ReturnType<typeof vi.fn>;
      registerConnectedServiceCredentialPlain: ReturnType<typeof vi.fn>;
      registerConnectedServiceCredentialSealed: ReturnType<typeof vi.fn>;
    };
    expect(typedApi.getConnectedServiceCredentialPlain).toHaveBeenCalled();
    expect(typedApi.getConnectedServiceCredentialSealed).toHaveBeenCalled();
    expect(typedApi.registerConnectedServiceCredentialPlain).not.toHaveBeenCalled();
    expect(typedApi.registerConnectedServiceCredentialSealed).toHaveBeenCalledTimes(1);
    expect(storedRecord.oauth?.accessToken).toBe('new-access');

    const codexHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex', 'codex-home');
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('new-access');
  });

  it('uses active account settings when refresh re-materializes Codex auth', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));
    const sourceCodexHome = await mkdtemp(join(tmpdir(), 'happier-source-codex-home-refresh-'));
    await writeFile(join(sourceCodexHome, 'config.toml'), 'model = "gpt-5.2-codex"\n');

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 30_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'new-id',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const previousCodexHome = process.env.CODEX_HOME;
    process.env.CODEX_HOME = sourceCodexHome;
    try {
      const coordinatorParams = {
        api,
        credentials,
        machineIdProvider: () => 'machine-1',
        activeServerDir,
        baseDir,
        refreshWindowMs: 60_000,
        refreshLeaseMs: 30_000,
        now: () => now,
        accountSettingsProvider: () => ({
          connectedServicesProviderStateSharingSettingsV1: {
            v: 1,
            defaults: {
              configMode: 'isolated',
              stateMode: 'isolated',
            },
            byAgentId: {},
            acknowledgedRisksByAgentId: {},
          },
        }),
        processEnv: process.env,
      };
      const coordinator = new ConnectedServiceRefreshCoordinator(coordinatorParams);

      coordinator.registerSpawnTarget({
        pid: 123,
        agentId: 'codex',
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
        },
        materializationKey: 'session-1',
      });

      await coordinator.tickOnce();

      const codexHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex', 'codex-home');
      const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'));
      expect(auth.access_token).toBe('new-access');
      await expect(lstat(join(codexHome, 'config.toml'))).rejects.toThrow();
    } finally {
      if (previousCodexHome === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = previousCodexHome;
      }
    }
  });

  it('invokes onAuthUpdated callback with affected targets after refresh', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

	    const api = {
	      getConnectedServiceCredentialSealed: vi.fn(async () => ({
	        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
	        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 30_000 },
	      })),
	      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
	      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
	        sealedCiphertext = params.sealed.ciphertext;
	      }),
	    } as unknown as ApiClient;

	    const fetchMock = vi.fn(async () => ({
	      ok: true,
	      json: async () => ({
	        access_token: 'new-access',
	        refresh_token: 'new-refresh',
	        id_token: 'new-id',
	        expires_in: 3600,
	      }),
	    }));
	    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const onAuthUpdated = vi.fn();
    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
      onAuthUpdated,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      agentId: 'pi',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-1',
    });

    await coordinator.tickOnce();

    expect(onAuthUpdated).toHaveBeenCalledWith(expect.objectContaining({
      binding: { serviceId: 'openai-codex', profileId: 'work' },
      affectedTargets: [expect.objectContaining({ pid: 123, agentId: 'pi' })],
    }));
  });

  it('rematerializes affected local targets when an external credential update is observed', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-external-update-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-external-update-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'reconnected-access',
        refreshToken: 'reconnected-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1' as const, ciphertext: sealedCiphertext },
        metadata: {
          kind: 'oauth',
          providerEmail: 'user@example.com',
          providerAccountId: 'acct',
          expiresAt: now + 3_600_000,
        },
      })),
    } as unknown as ApiClient;

    const onAuthUpdated = vi.fn();
    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
      onAuthUpdated,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-openai',
    });

    const externalUpdate = coordinator as unknown as {
      handleExternalCredentialUpdate?: (input: Readonly<{ serviceId: 'openai-codex'; profileId: string }>) => Promise<void>;
    };
    expect(externalUpdate.handleExternalCredentialUpdate).toBeTypeOf('function');

    await externalUpdate.handleExternalCredentialUpdate!({ serviceId: 'openai-codex', profileId: 'work' });

    const codexHome = join(activeServerDir, 'daemon', 'connected-services', 'homes', 'openai-codex', 'work', 'codex', 'codex-home');
    const auth = JSON.parse(await readFile(join(codexHome, 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('reconnected-access');
    expect(onAuthUpdated).toHaveBeenCalledWith(expect.objectContaining({
      binding: { serviceId: 'openai-codex', profileId: 'work' },
      affectedTargets: [expect.objectContaining({ pid: 123, agentId: 'codex' })],
    }));
  });

  it('clears a stale id token but preserves friendly account email when the refresh response omits id_token', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: 'stale-id-token',
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'known-user@example.test',
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: 'known-user@example.test', providerAccountId: 'acct', expiresAt: now + 30_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-1',
    });

    await coordinator.tickOnce();

    const opened = openConnectedServiceCredentialCiphertext({
      material: { type: 'legacy', secret: credentials.encryption.secret },
      ciphertext: sealedCiphertext,
    });
    expect(opened?.value).toMatchObject({
      kind: 'oauth',
      oauth: expect.objectContaining({
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        idToken: null,
        providerEmail: 'known-user@example.test',
      }),
    });
  });

  it('directly refreshes a Codex group active profile and updates only the group-home bridge response', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'backup',
      kind: 'oauth',
      expiresAt: now + 90_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: 'old-id',
        scope: null,
        tokenType: 'Bearer',
        providerAccountId: 'chatgpt-account',
        providerEmail: 'alice@example.com',
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: 'alice@example.com', providerAccountId: 'chatgpt-account', expiresAt: now + 90_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'rotated-refresh',
        id_token: 'new-id',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });
    const result = await coordinator.refreshOpenAiCodexChatGptTokensForBridge({
      selection: {
        kind: 'group',
        serviceId: 'openai-codex',
        groupId: 'main',
        activeProfileId: 'backup',
        fallbackProfileId: 'work',
        generation: 7,
      },
      chatgptPlanType: 'plus',
    });

    expect(result).toEqual({
      accessToken: 'new-access',
      chatgptAccountId: 'chatgpt-account',
      chatgptPlanType: 'plus',
    });
    expect(result).not.toHaveProperty('refreshToken');
    expect(api.acquireConnectedServiceRefreshLease).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'backup',
      machineId: 'machine-1',
      ownerId: 'machine-1:daemon-a',
      leaseMs: 30_000,
    });

    const opened = openConnectedServiceCredentialCiphertext({
      material: { type: 'legacy', secret: credentials.encryption.secret },
      ciphertext: sealedCiphertext,
    });
    expect(opened?.value).toMatchObject({
      kind: 'oauth',
      oauth: expect.objectContaining({
        accessToken: 'new-access',
        refreshToken: 'rotated-refresh',
      }),
    });

    const codexHome = resolveConnectedServiceGroupHomeDir({
      activeServerDir,
      serviceId: 'openai-codex',
      groupId: 'main',
      agentId: 'codex',
    });
    const auth = JSON.parse(await readFile(join(codexHome, 'codex-home', 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('new-access');
    expect(auth.refresh_token).toBe('rotated-refresh');
  });

  it('waits and re-reads credentials when another daemon owns the refresh lease for spawn preflight', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-lease-wait-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-lease-wait-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(15) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const staleRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10_000,
      oauth: {
        accessToken: 'stale-access',
        refreshToken: 'stale-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const refreshedRecord = buildConnectedServiceCredentialRecord({
      now: now + 50,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 3_600_000,
      oauth: {
        accessToken: 'other-daemon-access',
        refreshToken: 'other-daemon-refresh',
        idToken: 'other-daemon-id',
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: 'user@example.com',
      },
    });
    const staleCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: staleRecord,
      randomBytes: (length) => randomBytes(length),
    });
    const refreshedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: refreshedRecord,
      randomBytes: (length) => randomBytes(length),
    });

    let credentialReads = 0;
    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => {
        credentialReads += 1;
        const ciphertext = credentialReads === 1 ? staleCiphertext : refreshedCiphertext;
        const expiresAt = credentialReads === 1 ? staleRecord.expiresAt : refreshedRecord.expiresAt;
        return {
          sealed: { format: 'account_scoped_v1', ciphertext },
          metadata: { kind: 'oauth', providerEmail: 'user@example.com', providerAccountId: 'acct', expiresAt },
        };
      }),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: false, leaseUntil: now + 50 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as ApiClient;
    const sleepMs = vi.fn(async () => {});
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      leaseContentionWaitMaxMs: 100,
      sleepMs,
      now: () => now,
    });

    const result = await coordinator.refreshConnectedServiceCredentialForSpawnPreflight({
      serviceId: 'openai-codex',
      profileId: 'work',
    });

    expect(result.status).toBe('refreshed');
    expect(result.credential).toMatchObject({
      kind: 'oauth',
      oauth: expect.objectContaining({ accessToken: 'other-daemon-access' }),
    });
    expect(sleepMs).toHaveBeenCalledWith(50);
    expect(api.getConnectedServiceCredentialSealed).toHaveBeenCalledTimes(2);
    expect(api.registerConnectedServiceCredentialSealed).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('serializes forced refreshes for the same binding inside one daemon process', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-singleflight-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-singleflight-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 30_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        ok: true,
        json: async () => ({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      ownerIdProvider: () => 'machine-1:daemon-a',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    const first = coordinator.refreshConnectedServiceCredentialForQuota({
      serviceId: 'openai-codex',
      profileId: 'work',
      force: true,
    });
    const second = coordinator.refreshConnectedServiceCredentialForQuota({
      serviceId: 'openai-codex',
      profileId: 'work',
      force: true,
    });

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.acquireConnectedServiceRefreshLease).toHaveBeenCalledTimes(1);
    expect(firstResult?.oauth?.accessToken).toBe('new-access');
    expect(secondResult?.oauth?.accessToken).toBe('new-access');
  });

  it('does not satisfy a forced refresh from an in-flight non-forced not-needed refresh', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-force-class-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-force-class-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10 * 60_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    let releaseCredentialRead: () => void = () => {};
    const credentialReadReleased = new Promise<void>((resolve) => {
      releaseCredentialRead = resolve;
    });
    let resolveCredentialReadStarted: () => void = () => {};
    const credentialReadStarted = new Promise<void>((resolve) => {
      resolveCredentialReadStarted = resolve;
    });
    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => {
        resolveCredentialReadStarted();
        await credentialReadReleased;
        return {
          sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
          metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 10 * 60_000 },
        };
      }),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'forced-access',
        refresh_token: 'forced-refresh',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-1',
    });

    const nonForced = coordinator.tickOnce();
    await credentialReadStarted;
    const forced = coordinator.refreshConnectedServiceCredentialForQuota({
      serviceId: 'openai-codex',
      profileId: 'work',
      force: true,
    });
    releaseCredentialRead();

    const [, forcedResult] = await Promise.all([nonForced, forced]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(api.acquireConnectedServiceRefreshLease).toHaveBeenCalledTimes(1);
    expect(forcedResult?.oauth?.accessToken).toBe('forced-access');
  });

  it('persists reauth-required credential health for invalid provider refresh grants without raw provider bodies', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-invalid-grant-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-invalid-grant-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10 * 60_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'secret-refresh-token',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const updateConnectedServiceCredentialHealth = vi.fn(async () => {});
    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 10 * 60_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth,
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: 'bad request',
      text: async () => JSON.stringify({ error: 'invalid_grant', refresh_token: 'secret-refresh-token' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const logRefreshDiagnostic = vi.fn();
    const onCredentialHealthNotification = vi.fn(async () => {
      throw new AxiosError('notification unavailable Authorization: Bearer SECRET', 'ECONNRESET', {
        method: 'post',
        url: 'https://api.example.test/health?token=SECRET',
        headers: new AxiosHeaders({ Authorization: 'Bearer SECRET' }),
        data: { refresh_token: 'secret-refresh-token' },
      });
    });
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    let result: Awaited<ReturnType<ConnectedServiceRefreshCoordinator['refreshConnectedServiceCredentialForQuota']>> | undefined;
    try {
      const coordinator = new ConnectedServiceRefreshCoordinator({
        api,
        credentials,
        machineIdProvider: () => 'machine-1',
        activeServerDir,
        baseDir,
        refreshWindowMs: 60_000,
        refreshLeaseMs: 30_000,
        now: () => now,
        logRefreshDiagnostic,
        onCredentialHealthNotification,
      } as unknown as ConstructorParameters<typeof ConnectedServiceRefreshCoordinator>[0]);

      const targetRegistration = {
        pid: 123,
        agentId: 'codex',
        connectedServicesBindingsRaw: {
          v: 1,
          bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
        },
        materializationKey: 'materialization-identity-1',
        sessionId: 'happy-session-1',
      } as Parameters<ConnectedServiceRefreshCoordinator['registerSpawnTarget']>[0] & {
        sessionId: string;
      };
      coordinator.registerSpawnTarget(targetRegistration);

      result = await coordinator.refreshConnectedServiceCredentialForQuota({
        serviceId: 'openai-codex',
        profileId: 'work',
        force: true,
      });

      expect(warn).toHaveBeenCalledWith(
        '[DAEMON RUN] Failed to dispatch connected-service credential health notification',
        expect.objectContaining({
          serviceId: 'openai-codex',
          profileId: 'work',
          status: 'refresh_failed',
          category: 'invalid_grant',
        }),
      );
      expect(debug).not.toHaveBeenCalledWith(
        '[DAEMON RUN] Failed to dispatch connected-service credential health notification',
        expect.anything(),
      );
      const warned = JSON.stringify(warn.mock.calls);
      expect(warned).not.toContain('Bearer SECRET');
      expect(warned).not.toContain('secret-refresh-token');
      expect(warned).not.toContain('"headers"');
      expect(warned).not.toContain('"data"');
    } finally {
      warn.mockRestore();
      debug.mockRestore();
    }

    expect(result).toBeNull();
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      health: {
        v: 1,
        status: 'needs_reauth',
        reconnectRequired: true,
        lastRefreshAttemptAt: now,
        lastRefreshFailureAt: now,
        lastRefreshFailureKind: 'invalid_grant',
        providerHttpStatus: 400,
        providerErrorCode: 'invalid_grant',
      },
    });
    expect(logRefreshDiagnostic).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 'openai-codex',
      profileId: 'work',
      reason: 'quota_bridge',
      status: 'refresh_failed',
      category: 'invalid_grant',
      providerStatus: 400,
      providerErrorCode: 'invalid_grant',
      expiryAgeMs: -600_000,
      refreshWindowMs: 60_000,
    }));
    expect(onCredentialHealthNotification).toHaveBeenCalledWith(expect.objectContaining({
      diagnostic: expect.objectContaining({
        serviceId: 'openai-codex',
        profileId: 'work',
        status: 'refresh_failed',
        category: 'invalid_grant',
        providerStatus: 400,
        providerErrorCode: 'invalid_grant',
      }),
      healthStatus: 'reconnect_required',
      affectedTargets: [expect.objectContaining({
        pid: 123,
        agentId: 'codex',
        sessionId: 'happy-session-1',
      })],
    }));
    expect(JSON.stringify(updateConnectedServiceCredentialHealth.mock.calls)).not.toContain('secret-refresh-token');
    expect(JSON.stringify(logRefreshDiagnostic.mock.calls)).not.toContain('secret-refresh-token');
    expect(JSON.stringify(onCredentialHealthNotification.mock.calls)).not.toContain('secret-refresh-token');
  });

  it('warns when credential health persistence fails after refresh', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-health-warn-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-health-warn-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10 * 60_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'secret-refresh-token',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 10 * 60_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {
        throw new AxiosError('health write unavailable Authorization: Bearer SECRET', 'ECONNRESET', {
          method: 'post',
          url: 'https://api.example.test/health?token=SECRET',
          headers: new AxiosHeaders({ Authorization: 'Bearer SECRET' }),
          data: { refresh_token: 'secret-refresh-token' },
        });
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      statusText: 'bad request',
      text: async () => JSON.stringify({ error: 'invalid_grant', refresh_token: 'secret-refresh-token' }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    const debug = vi.spyOn(logger, 'debug').mockImplementation(() => {});
    try {
      const coordinator = new ConnectedServiceRefreshCoordinator({
        api,
        credentials,
        machineIdProvider: () => 'machine-1',
        activeServerDir,
        baseDir,
        refreshWindowMs: 60_000,
        refreshLeaseMs: 30_000,
        now: () => now,
      } as unknown as ConstructorParameters<typeof ConnectedServiceRefreshCoordinator>[0]);

      await expect(coordinator.refreshConnectedServiceCredentialForQuota({
        serviceId: 'openai-codex',
        profileId: 'work',
        force: true,
      })).resolves.toBeNull();

      expect(warn).toHaveBeenCalledWith(
        '[DAEMON RUN] Failed to update connected-service credential health after refresh',
        expect.objectContaining({
          serviceId: 'openai-codex',
          profileId: 'work',
          status: 'refresh_failed',
          category: 'invalid_grant',
        }),
      );
      expect(debug).not.toHaveBeenCalledWith(
        '[DAEMON RUN] Failed to update connected-service credential health after refresh',
        expect.anything(),
      );
      const warned = JSON.stringify(warn.mock.calls);
      expect(warned).not.toContain('Bearer SECRET');
      expect(warned).not.toContain('secret-refresh-token');
      expect(warned).not.toContain('"headers"');
      expect(warned).not.toContain('"data"');
    } finally {
      warn.mockRestore();
      debug.mockRestore();
    }
  });

  it('does not retry scheduled refresh for profiles already marked reconnect-required', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-needs-reauth-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-needs-reauth-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'invalid-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 30_000 },
      })),
      listConnectedServiceProfiles: vi.fn(async () => ({
        serviceId: 'openai-codex',
        profiles: [{
          profileId: 'work',
          status: 'needs_reauth' as const,
          kind: 'oauth' as const,
          providerEmail: null,
          providerAccountId: 'acct',
          expiresAt: now + 30_000,
        }],
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => {
      throw new Error('scheduled refresh should not reach provider for reconnect-required credentials');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    coordinator.registerSpawnTarget({
      pid: 123,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-1',
    });

    await expect(coordinator.tickOnce()).resolves.toBeUndefined();

    expect(api.listConnectedServiceProfiles).toHaveBeenCalledWith({ serviceId: 'openai-codex' });
    expect(api.acquireConnectedServiceRefreshLease).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(api.updateConnectedServiceCredentialHealth).not.toHaveBeenCalled();
  });

  it('returns reconnect-required from spawn preflight before the expiry-window shortcut', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-spawn-health-gate-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-spawn-health-gate-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10 * 60_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'invalid-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 10 * 60_000 },
      })),
      listConnectedServiceProfiles: vi.fn(async () => ({
        serviceId: 'openai-codex',
        profiles: [{
          profileId: 'work',
          status: 'needs_reauth' as const,
          kind: 'oauth' as const,
          providerEmail: null,
          providerAccountId: 'acct',
          expiresAt: now + 10 * 60_000,
        }],
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => {
      throw new Error('spawn preflight should not reach provider for reconnect-required credentials');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    const result = await coordinator.refreshConnectedServiceCredentialForSpawnPreflight({
      serviceId: 'openai-codex',
      profileId: 'work',
    });

    expect(result.status).toBe('refresh_failed');
    expect(result.diagnostic).toEqual(expect.objectContaining({
      serviceId: 'openai-codex',
      profileId: 'work',
      reason: 'spawn_preflight',
      category: 'invalid_grant',
      expiresAt: now + 10 * 60_000,
    }));
    expect(api.listConnectedServiceProfiles).toHaveBeenCalledWith({ serviceId: 'openai-codex' });
    expect(api.acquireConnectedServiceRefreshLease).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redacts profile-health read failures before refresh', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-spawn-health-read-redaction-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-spawn-health-read-redaction-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10 * 60_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });
    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 10 * 60_000 },
      })),
      listConnectedServiceProfiles: vi.fn(async () => {
        throw new AxiosError('Request failed with Authorization: Bearer MESSAGE_SECRET', 'ERR_BAD_RESPONSE', {
          method: 'get',
          url: 'https://api.example.test/v3/connect/openai-codex/profiles?token=QUERY_SECRET',
          headers: new AxiosHeaders({ Authorization: 'Bearer HEADER_SECRET' }),
          data: { access_token: 'BODY_SECRET' },
        });
      }),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    await expect(coordinator.refreshConnectedServiceCredentialForSpawnPreflight({
      serviceId: 'openai-codex',
      profileId: 'work',
    })).resolves.toEqual(expect.objectContaining({ status: 'not_needed' }));

    const payload = JSON.stringify(warnSpy.mock.calls.at(-1)?.[1]);
    expect(payload).toContain('https://api.example.test/v3/connect/openai-codex/profiles');
    expect(payload).not.toContain('MESSAGE_SECRET');
    expect(payload).not.toContain('QUERY_SECRET');
    expect(payload).not.toContain('HEADER_SECRET');
    expect(payload).not.toContain('BODY_SECRET');
    expect(payload).not.toContain('"headers"');
    expect(payload).not.toContain('"data"');
  });

  it('does not quota-bridge refresh cached reconnect-required credentials when forced', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-quota-health-gate-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-quota-health-gate-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 10 * 60_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'invalid-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });

    const sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async () => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: 'acct', expiresAt: now + 10 * 60_000 },
      })),
      listConnectedServiceProfiles: vi.fn(async () => ({
        serviceId: 'openai-codex',
        profiles: [{
          profileId: 'work',
          status: 'needs_reauth' as const,
          kind: 'oauth' as const,
          providerEmail: null,
          providerAccountId: 'acct',
          expiresAt: now + 10 * 60_000,
        }],
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async () => {}),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => {
      throw new Error('quota bridge should not reach provider for reconnect-required credentials');
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    await expect(coordinator.refreshConnectedServiceCredentialForQuota({
      serviceId: 'openai-codex',
      profileId: 'work',
      force: true,
    })).resolves.toBeNull();

    expect(api.listConnectedServiceProfiles).toHaveBeenCalledWith({ serviceId: 'openai-codex' });
    expect(api.acquireConnectedServiceRefreshLease).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refreshes the active group profile and re-materializes the selected group home for tracked group spawn targets', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const record = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'backup',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: 'old-id',
        scope: null,
        tokenType: 'Bearer',
        providerAccountId: 'acct',
        providerEmail: 'alice@example.com',
      },
    });

    let sealedCiphertext = sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: record,
      randomBytes: (length) => randomBytes(length),
    });

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async (params: { serviceId: string; profileId: string }) => {
        if (params.serviceId !== 'openai-codex' || params.profileId !== 'backup') {
          return null;
        }
        return {
          sealed: { format: 'account_scoped_v1', ciphertext: sealedCiphertext },
          metadata: {
            kind: 'oauth',
            providerEmail: 'alice@example.com',
            providerAccountId: 'acct',
            expiresAt: now + 30_000,
          },
        };
      }),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { sealed: { ciphertext: string } }) => {
        sealedCiphertext = params.sealed.ciphertext;
      }),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        id_token: 'new-id',
        expires_in: 3600,
      }),
    }));
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
    });

    const targetRegistration = {
      pid: 123,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: {
          'openai-codex': {
            source: 'connected',
            selection: 'group',
            profileId: 'work',
            groupId: 'main',
          },
        },
      },
      materializationKey: 'session-1',
      connectedServiceSelectionsEnv: {
        [HAPPIER_CONNECTED_SERVICE_SELECTIONS_ENV_KEY]: JSON.stringify([{
          kind: 'group',
          serviceId: 'openai-codex',
          groupId: 'main',
          activeProfileId: 'backup',
          fallbackProfileId: 'work',
          generation: 7,
        }]),
      },
    } as Parameters<ConnectedServiceRefreshCoordinator['registerSpawnTarget']>[0] & {
      connectedServiceSelectionsEnv: Record<string, string>;
    };

    coordinator.registerSpawnTarget(targetRegistration);

    await coordinator.tickOnce();

    expect(api.getConnectedServiceCredentialSealed).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'backup',
    });

    const codexHome = resolveConnectedServiceGroupHomeDir({
      activeServerDir,
      serviceId: 'openai-codex',
      groupId: 'main',
      agentId: 'codex',
    });
    const auth = JSON.parse(await readFile(join(codexHome, 'codex-home', 'auth.json'), 'utf8'));
    expect(auth.access_token).toBe('new-access');
    expect(auth.refresh_token).toBe('new-refresh');
  });

  it('continues refreshing other bindings when one binding refresh fails', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-refresh-'));
    const activeServerDir = await mkdtemp(join(tmpdir(), 'happier-connected-services-server-refresh-'));

    const credentials: Credentials = {
      token: 'happy-token',
      encryption: { type: 'legacy', secret: new Uint8Array(32).fill(9) },
    };
    if (credentials.encryption.type !== 'legacy') throw new Error('fixture');

    const now = 1_000_000;
    const openaiRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'openai-codex',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'old-access',
        refreshToken: 'old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: 'acct',
        providerEmail: null,
      },
    });
    const geminiRecord = buildConnectedServiceCredentialRecord({
      now,
      serviceId: 'gemini',
      profileId: 'work',
      kind: 'oauth',
      expiresAt: now + 30_000,
      oauth: {
        accessToken: 'g-old-access',
        refreshToken: 'g-old-refresh',
        idToken: null,
        scope: null,
        tokenType: null,
        providerAccountId: null,
        providerEmail: null,
      },
    });

    const sealedByServiceId = new Map<string, string>();
    sealedByServiceId.set('openai-codex', sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: openaiRecord,
      randomBytes: (length) => randomBytes(length),
    }));
    sealedByServiceId.set('gemini', sealAccountScopedBlobCiphertext({
      kind: 'connected_service_credential',
      material: { type: 'legacy', secret: credentials.encryption.secret },
      payload: geminiRecord,
      randomBytes: (length) => randomBytes(length),
    }));

    const api = {
      getConnectedServiceCredentialSealed: vi.fn(async (params: { serviceId: string }) => ({
        sealed: { format: 'account_scoped_v1', ciphertext: sealedByServiceId.get(params.serviceId)! },
        metadata: { kind: 'oauth', providerEmail: null, providerAccountId: null, expiresAt: now + 30_000 },
      })),
      acquireConnectedServiceRefreshLease: vi.fn(async () => ({ acquired: true, leaseUntil: now + 60_000 })),
      registerConnectedServiceCredentialSealed: vi.fn(async (params: { serviceId: string; sealed: { ciphertext: string } }) => {
        sealedByServiceId.set(params.serviceId, params.sealed.ciphertext);
      }),
      updateConnectedServiceCredentialHealth: vi.fn(async () => {}),
    } as unknown as ApiClient;

    const fetchMock = vi.fn(async (input: any) => {
      const url = String(input);
      if (url.includes('auth.openai.com')) {
        return { ok: false, status: 500, statusText: 'fail', text: async () => 'boom' } as any;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'g-new-access',
          refresh_token: 'g-new-refresh',
          expires_in: 3600,
        }),
        text: async () => '',
      } as any;
    });
    vi.stubGlobal('fetch', fetchMock as unknown as typeof fetch);

    const logRefreshDiagnostic = vi.fn();
    const coordinator = new ConnectedServiceRefreshCoordinator({
      api,
      credentials,
      machineIdProvider: () => 'machine-1',
      activeServerDir,
      baseDir,
      refreshWindowMs: 60_000,
      refreshLeaseMs: 30_000,
      now: () => now,
      logRefreshDiagnostic,
    });

    coordinator.registerSpawnTarget({
      pid: 1,
      agentId: 'codex',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { 'openai-codex': { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-openai',
    });
    coordinator.registerSpawnTarget({
      pid: 2,
      agentId: 'gemini',
      connectedServicesBindingsRaw: {
        v: 1,
        bindingsByServiceId: { gemini: { source: 'connected', profileId: 'work' } },
      },
      materializationKey: 'session-gemini',
    });

    await expect(coordinator.tickOnce()).rejects.toThrow();

    // Even though OpenAI refresh failed, Gemini should still have been refreshed and registered.
    expect(api.registerConnectedServiceCredentialSealed).toHaveBeenCalledWith(expect.objectContaining({ serviceId: 'gemini' }));
    expect(api.updateConnectedServiceCredentialHealth).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      health: {
        v: 1,
        status: 'refresh_failed_retryable',
        reconnectRequired: false,
        lastRefreshAttemptAt: now,
        lastRefreshFailureAt: now,
        lastRefreshFailureKind: 'unknown',
        providerHttpStatus: 500,
      },
    });
    expect(logRefreshDiagnostic).toHaveBeenCalledWith({
      serviceId: 'openai-codex',
      profileId: 'work',
      reason: 'scheduled',
      status: 'refresh_failed',
      category: 'unknown',
      providerStatus: 500,
      providerErrorCode: null,
      expiresAt: now + 30_000,
      expiryAgeMs: -30_000,
      refreshWindowMs: 60_000,
    });
    expect(JSON.stringify(logRefreshDiagnostic.mock.calls)).not.toContain('old-refresh');
  });
});
