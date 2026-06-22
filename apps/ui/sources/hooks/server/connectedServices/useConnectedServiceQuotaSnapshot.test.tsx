import * as React from 'react';
import { act } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ConnectedServiceQuotaSnapshotV1Schema } from '@happier-dev/protocol';
import type { ConnectedServiceId } from '@happier-dev/protocol';
import type { fetchAccountEncryptionMode } from '@/sync/api/account/apiAccountEncryptionMode';
import type {
  getConnectedServiceQuotaSnapshotSealed,
  requestConnectedServiceQuotaSnapshotRefresh,
} from '@/sync/api/account/apiConnectedServicesQuotasV2';
import type {
  getConnectedServiceQuotaSnapshotPlain,
  requestConnectedServiceQuotaSnapshotRefreshV3,
} from '@/sync/api/account/apiConnectedServicesQuotasV3';

import { flushHookEffects, renderHook, renderScreen } from '@/dev/testkit';
import { useConnectedServiceQuotaSnapshot } from './useConnectedServiceQuotaSnapshot';
import { __resetConnectedServiceQuotaSnapshotStore } from './connectedServiceQuotaSnapshotStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stableCredentials = { token: 't', secret: Buffer.from(new Uint8Array(32).fill(3)).toString('base64url') } as const;
let currentCredentials: Readonly<{ token: string; secret: string }> = stableCredentials;
vi.mock('@/auth/context/AuthContext', () => ({
  useAuth: () => ({ credentials: currentCredentials }),
}));

const {
  fetchAccountEncryptionModeSpy,
  getConnectedServiceQuotaSnapshotPlainSpy,
  getConnectedServiceQuotaSnapshotSealedSpy,
  requestConnectedServiceQuotaSnapshotRefreshSpy,
  requestConnectedServiceQuotaSnapshotRefreshV3Spy,
  machineState,
  consumeQuotaRecoveryCreditSpy,
} = vi.hoisted(() => ({
  fetchAccountEncryptionModeSpy: vi.fn<
    (...args: Parameters<typeof fetchAccountEncryptionMode>) => ReturnType<typeof fetchAccountEncryptionMode>
  >(async () => ({ mode: 'e2ee', updatedAt: 0 })),
  getConnectedServiceQuotaSnapshotPlainSpy: vi.fn<
    (...args: Parameters<typeof getConnectedServiceQuotaSnapshotPlain>) => ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>
  >(async () => null),
  getConnectedServiceQuotaSnapshotSealedSpy: vi.fn<
    (...args: Parameters<typeof getConnectedServiceQuotaSnapshotSealed>) => ReturnType<typeof getConnectedServiceQuotaSnapshotSealed>
  >(async () => null),
  requestConnectedServiceQuotaSnapshotRefreshSpy: vi.fn<
    (...args: Parameters<typeof requestConnectedServiceQuotaSnapshotRefresh>) => ReturnType<typeof requestConnectedServiceQuotaSnapshotRefresh>
  >(async () => true),
  requestConnectedServiceQuotaSnapshotRefreshV3Spy: vi.fn<
    (...args: Parameters<typeof requestConnectedServiceQuotaSnapshotRefreshV3>) => ReturnType<typeof requestConnectedServiceQuotaSnapshotRefreshV3>
  >(async () => false),
  machineState: { machines: [{ id: 'machine-1', active: true }] },
  consumeQuotaRecoveryCreditSpy: vi.fn(async () => ({ ok: true, snapshot: null })),
}));
vi.mock('@/sync/api/account/apiAccountEncryptionMode', () => ({
  fetchAccountEncryptionMode: fetchAccountEncryptionModeSpy,
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV2', () => ({
  getConnectedServiceQuotaSnapshotSealed: getConnectedServiceQuotaSnapshotSealedSpy,
  requestConnectedServiceQuotaSnapshotRefresh: requestConnectedServiceQuotaSnapshotRefreshSpy,
}));
vi.mock('@/sync/api/account/apiConnectedServicesQuotasV3', () => ({
  getConnectedServiceQuotaSnapshotPlain: getConnectedServiceQuotaSnapshotPlainSpy,
  requestConnectedServiceQuotaSnapshotRefreshV3: requestConnectedServiceQuotaSnapshotRefreshV3Spy,
}));
vi.mock('@/sync/domains/state/storage', async () => {
  const actual = await vi.importActual<typeof import('@/sync/domains/state/storage')>('@/sync/domains/state/storage');
  return { ...actual, useAllMachines: () => machineState.machines };
});
vi.mock('@/sync/ops/connectedServiceQuotaRecoveryCredits', () => ({
  connectedServiceQuotaRecoveryCreditConsume: consumeQuotaRecoveryCreditSpy,
}));

// Reactive settings boundary: the apply spy persists to a fixture that the
// mocked `useSetting` reads back, so the hook's pin-ownership round-trips
// without the native settings-writer path.
const { pinnedFixture, applySettingsSpy } = vi.hoisted(() => {
  const pinnedFixture: { value: Record<string, ReadonlyArray<string>> } = { value: {} };
  const applySettingsSpy = vi.fn((delta: { connectedServicesQuotaPinnedMeterIdsByKey?: Record<string, ReadonlyArray<string>> }) => {
    if (delta.connectedServicesQuotaPinnedMeterIdsByKey) {
      pinnedFixture.value = delta.connectedServicesQuotaPinnedMeterIdsByKey;
    }
  });
  return { pinnedFixture, applySettingsSpy };
});
vi.mock('@/sync/store/settingsWriters', () => ({ useApplySettings: () => applySettingsSpy }));
vi.mock('@/sync/store/hooks', async () => {
  const actual = await vi.importActual<typeof import('@/sync/store/hooks')>('@/sync/store/hooks');
  return {
    ...actual,
    useSetting: ((key: string) => (
      key === 'connectedServicesQuotaPinnedMeterIdsByKey'
        ? pinnedFixture.value
        : (actual.useSetting as (k: string) => unknown)(key)
    )) as typeof actual.useSetting,
  };
});

function createDeferredAccountMode() {
  let resolve!: (value: Awaited<ReturnType<typeof fetchAccountEncryptionMode>>) => void;
  const promise = new Promise<Awaited<ReturnType<typeof fetchAccountEncryptionMode>>>((next) => { resolve = next; });
  return { promise, resolve } as const;
}

function snapshotFor(
  profileId: string,
  fetchedAt: number,
  planLabel: string | null = null,
  overrides: Record<string, unknown> = {},
) {
  return ConnectedServiceQuotaSnapshotV1Schema.parse({
    v: 1,
    serviceId: 'anthropic',
    profileId,
    fetchedAt,
    staleAfterMs: 60_000,
    planLabel,
    accountLabel: null,
    meters: [],
    ...overrides,
  });
}

type HookProps = Readonly<{ serviceId: ConnectedServiceId; profileId: string }>;

async function mountHook(props: HookProps) {
  return await renderHook((p: HookProps) => useConnectedServiceQuotaSnapshot(p), {
    initialProps: props,
    flushOptions: { turns: 3 },
  });
}

describe('useConnectedServiceQuotaSnapshot', () => {
  beforeEach(() => {
    __resetConnectedServiceQuotaSnapshotStore();
    pinnedFixture.value = {};
    currentCredentials = stableCredentials;
    vi.clearAllMocks();
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'e2ee', updatedAt: 0 });
    getConnectedServiceQuotaSnapshotPlainSpy.mockResolvedValue(null);
    getConnectedServiceQuotaSnapshotSealedSpy.mockResolvedValue(null);
    requestConnectedServiceQuotaSnapshotRefreshSpy.mockResolvedValue(true);
    requestConnectedServiceQuotaSnapshotRefreshV3Spy.mockResolvedValue(false);
    consumeQuotaRecoveryCreditSpy.mockResolvedValue({ ok: true, snapshot: null });
    machineState.machines = [{ id: 'machine-1', active: true }];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not restart an equivalent automatic load while the first quota request is unresolved', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    let resolvePlain!: (value: Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>) => void;
    const pendingPlain = new Promise<Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>>((r) => { resolvePlain = r; });
    getConnectedServiceQuotaSnapshotPlainSpy.mockReturnValue(pendingPlain);

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });
    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenCalledTimes(1);

    currentCredentials = { ...stableCredentials };
    await hook.rerender({ serviceId: 'anthropic', profileId: 'work' });

    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenCalledTimes(1);

    await act(async () => { resolvePlain(snapshotFor('work', 1)); });
  });

  it('performs exactly one network read when the same account is mounted in two blocks', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    getConnectedServiceQuotaSnapshotPlainSpy.mockResolvedValue(snapshotFor('work', 1));

    function Block(props: HookProps) {
      useConnectedServiceQuotaSnapshot(props);
      return null;
    }

    await renderScreen(
      <>
        <Block serviceId="anthropic" profileId="work" />
        <Block serviceId="anthropic" profileId="work" />
      </>,
    );
    await flushHookEffects({ turns: 3 });

    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenCalledTimes(1);
  });

  it('does not let a stale account-mode response choose the manual refresh endpoint after credentials change', async () => {
    const oldMode = createDeferredAccountMode();
    const newMode = createDeferredAccountMode();
    fetchAccountEncryptionModeSpy.mockReturnValueOnce(oldMode.promise).mockReturnValueOnce(newMode.promise);
    getConnectedServiceQuotaSnapshotPlainSpy.mockResolvedValue(snapshotFor('work', 1));
    requestConnectedServiceQuotaSnapshotRefreshV3Spy.mockResolvedValue(true);

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });
    expect(fetchAccountEncryptionModeSpy).toHaveBeenCalledTimes(1);
    expect(getConnectedServiceQuotaSnapshotPlainSpy).not.toHaveBeenCalled();

    currentCredentials = { ...stableCredentials, token: 't2' };
    await hook.rerender({ serviceId: 'anthropic', profileId: 'work' });
    expect(fetchAccountEncryptionModeSpy).toHaveBeenCalledTimes(2);

    await act(async () => { newMode.resolve({ mode: 'plain', updatedAt: 2 }); });
    await flushHookEffects({ turns: 5 });
    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenCalledTimes(1);

    await act(async () => { oldMode.resolve({ mode: 'e2ee', updatedAt: 1 }); });
    await flushHookEffects({ turns: 5 });
    expect(getConnectedServiceQuotaSnapshotSealedSpy).not.toHaveBeenCalled();

    // A newer reload lets the manual-refresh poll stop on its first iteration.
    getConnectedServiceQuotaSnapshotPlainSpy.mockResolvedValue(snapshotFor('work', 2));
    await act(async () => { await hook.getCurrent().refresh(); });
    await flushHookEffects({ turns: 3 });

    expect(requestConnectedServiceQuotaSnapshotRefreshV3Spy).toHaveBeenCalledWith(
      expect.objectContaining({ token: 't2' }),
      { serviceId: 'anthropic', profileId: 'work' },
    );
    expect(requestConnectedServiceQuotaSnapshotRefreshSpy).not.toHaveBeenCalled();
  });

  it('does not fall back to the sealed quota endpoint after credentials change while a plaintext miss is pending', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    let resolveOldPlain!: (value: Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>) => void;
    const pendingOldPlain = new Promise<Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>>((r) => { resolveOldPlain = r; });
    getConnectedServiceQuotaSnapshotPlainSpy
      .mockReturnValueOnce(pendingOldPlain)
      .mockResolvedValue(snapshotFor('work', 2, 'New account'));

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });
    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenCalledTimes(1);

    currentCredentials = { ...stableCredentials, token: 't2' };
    await hook.rerender({ serviceId: 'anthropic', profileId: 'work' });
    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenCalledTimes(2);

    await act(async () => { resolveOldPlain(null); });
    await flushHookEffects({ turns: 5 });

    expect(getConnectedServiceQuotaSnapshotSealedSpy).not.toHaveBeenCalled();
    expect(getConnectedServiceQuotaSnapshotPlainSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ token: 't2' }),
      { serviceId: 'anthropic', profileId: 'work' },
    );
  });

  it('ignores stale automatic load results after the quota profile changes', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    let resolveWork!: (value: Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>) => void;
    const pendingWork = new Promise<Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>>((r) => { resolveWork = r; });
    const personalSnapshot = snapshotFor('personal', 2, 'Personal');
    getConnectedServiceQuotaSnapshotPlainSpy.mockImplementation(async (_creds, request) => (
      request.profileId === 'work' ? await pendingWork : personalSnapshot
    ));

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });
    await hook.rerender({ serviceId: 'anthropic', profileId: 'personal' });

    expect(hook.getCurrent().snapshot?.profileId).toBe('personal');

    await act(async () => { resolveWork(snapshotFor('work', 1, 'Work')); });
    await flushHookEffects({ turns: 3 });

    expect(hook.getCurrent().snapshot?.profileId).toBe('personal');
  });

  it('clears the current snapshot when the quota profile changes before the next load resolves', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    const workSnapshot = snapshotFor('work', 1, 'Work');
    let resolvePersonal!: (value: Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>) => void;
    const pendingPersonal = new Promise<Awaited<ReturnType<typeof getConnectedServiceQuotaSnapshotPlain>>>((r) => { resolvePersonal = r; });
    getConnectedServiceQuotaSnapshotPlainSpy.mockImplementation(async (_creds, request) => (
      request.profileId === 'work' ? workSnapshot : await pendingPersonal
    ));

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });
    expect(hook.getCurrent().snapshot?.profileId).toBe('work');

    await hook.rerender({ serviceId: 'anthropic', profileId: 'personal' });
    expect(hook.getCurrent().snapshot).toBeNull();

    await act(async () => { resolvePersonal(snapshotFor('personal', 2, 'Personal')); });
    await flushHookEffects({ turns: 3 });
    expect(hook.getCurrent().snapshot?.profileId).toBe('personal');
  });

  it('redacts secret-bearing quota load failures before surfacing the error', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    getConnectedServiceQuotaSnapshotPlainSpy.mockRejectedValueOnce(
      new Error('request failed: https://admin:secret@custom.example.test:9443/path/?token=abc (Authorization: Bearer very-secret-token)'),
    );

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });

    const error = String(hook.getCurrent().error ?? '');
    expect(error).toContain('https://custom.example.test:9443/path');
    expect(error).toContain('Authorization: Bearer [REDACTED]');
    expect(error).not.toContain('admin:secret@');
    expect(error).not.toContain('?token=abc');
    expect(error).not.toContain('very-secret-token');
  });

  it('owns the pinned-meter preference, namespaced by profile, with delete-when-empty', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    getConnectedServiceQuotaSnapshotPlainSpy.mockResolvedValue(snapshotFor('pin-profile', 1));

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'pin-profile' });
    expect(hook.getCurrent().pinnedMeterIds).toEqual([]);

    await act(async () => { hook.getCurrent().togglePinnedMeter('weekly'); });
    expect(applySettingsSpy).toHaveBeenLastCalledWith({
      connectedServicesQuotaPinnedMeterIdsByKey: { 'anthropic/pin-profile': ['weekly'] },
    });

    await hook.rerender();
    expect(hook.getCurrent().pinnedMeterIds).toEqual(['weekly']);

    await act(async () => { hook.getCurrent().togglePinnedMeter('weekly'); });
    // Removing the last pinned meter deletes the namespaced key (sparse map).
    expect(applySettingsSpy).toHaveBeenLastCalledWith({
      connectedServicesQuotaPinnedMeterIdsByKey: {},
    });

    await hook.rerender();
    expect(hook.getCurrent().pinnedMeterIds).toEqual([]);
  });

  it('clears transient recovery-credit action errors after a successful manual refresh', async () => {
    fetchAccountEncryptionModeSpy.mockResolvedValue({ mode: 'plain', updatedAt: 0 });
    const recoveryCredits = {
      kind: 'usage_limit_resets',
      availableCount: 1,
      totalCount: 1,
      credits: [{
        kind: 'usage_limit_reset',
        status: 'available',
        providerCreditId: 'pc-1',
      }],
    };
    getConnectedServiceQuotaSnapshotPlainSpy
      .mockResolvedValueOnce(snapshotFor('work', 1, null, { recoveryCredits }))
      .mockResolvedValue(snapshotFor('work', 2, null, { recoveryCredits }));
    requestConnectedServiceQuotaSnapshotRefreshV3Spy.mockResolvedValue(true);
    machineState.machines = [];

    const hook = await mountHook({ serviceId: 'anthropic', profileId: 'work' });
    await act(async () => { await hook.getCurrent().consumeRecoveryCredit('pc-1'); });
    expect(hook.getCurrent().error).toBeTruthy();

    machineState.machines = [{ id: 'machine-1', active: true }];
    await hook.rerender();
    await act(async () => { await hook.getCurrent().refresh(); });
    await flushHookEffects({ turns: 3 });

    expect(hook.getCurrent().error).toBeNull();
  });
});
