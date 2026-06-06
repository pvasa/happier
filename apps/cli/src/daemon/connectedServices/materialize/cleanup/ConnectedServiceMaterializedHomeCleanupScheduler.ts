import { rm } from 'node:fs/promises';

import type { CatalogAgentId } from '@/backends/types';
import {
  listMaterializedAttemptTargets,
  listMaterializedHomeTargets,
  type ConnectedServiceMaterializedCleanupTarget,
} from './connectedServiceMaterializedHomeTargets';

export type ConnectedServiceMaterializedHomeCleanupResult = Readonly<{
  cleaned: boolean;
  pending?: boolean;
  kind: 'home' | 'attempt';
  path: string;
}>;

type RetainedIdentityIds = ReadonlySet<string> | ReadonlyArray<string>;

type PendingMaterializedCleanupTarget = ConnectedServiceMaterializedCleanupTarget & Readonly<{
  cleanupAttempts?: number;
}>;

const defaultRootTtlMs = 30 * 24 * 60 * 60_000;
const defaultAttemptsTtlMs = 60 * 60_000;

function targetKey(target: ConnectedServiceMaterializedCleanupTarget): string {
  return [
    target.kind,
    target.materializationIdentityId,
    target.agentId,
    target.path,
  ].join('\0');
}

function normalizeRetainedIdentityIds(ids: RetainedIdentityIds | null | undefined): ReadonlySet<string> {
  if (!ids) return new Set();
  return ids instanceof Set ? ids : new Set(ids);
}

function isStale(input: Readonly<{
  nowMs: number;
  mtimeMs: number;
  ttlMs: number;
}>): boolean {
  if (!Number.isFinite(input.mtimeMs)) return false;
  return input.nowMs - input.mtimeMs >= input.ttlMs;
}

export class ConnectedServiceMaterializedHomeCleanupScheduler {
  private readonly pendingTargetsByKey = new Map<string, PendingMaterializedCleanupTarget>();
  private readonly rootTtlMs: number;
  private readonly attemptsTtlMs: number;
  private readonly maxCleanupRetries: number;
  private readonly removePath: typeof rm;

  constructor(private readonly deps: Readonly<{
    baseDir: string;
    nowMs: () => number;
    rootTtlMs?: number;
    attemptsTtlMs?: number;
    maxCleanupRetries?: number;
    removePath?: typeof rm;
    hasLiveTarget(input: Readonly<{
      kind: 'home' | 'attempt';
      materializationIdentityId: string;
      agentId: CatalogAgentId;
      path: string;
    }>): boolean;
    listRetainedIdentityIds?: () => Promise<RetainedIdentityIds> | RetainedIdentityIds;
  }>) {
    this.rootTtlMs = Math.max(0, Math.trunc(deps.rootTtlMs ?? defaultRootTtlMs));
    this.attemptsTtlMs = Math.max(0, Math.trunc(deps.attemptsTtlMs ?? defaultAttemptsTtlMs));
    this.maxCleanupRetries = Math.max(0, Math.trunc(deps.maxCleanupRetries ?? 3));
    this.removePath = deps.removePath ?? rm;
  }

  private hasLiveTarget(target: ConnectedServiceMaterializedCleanupTarget): boolean {
    return this.deps.hasLiveTarget({
      kind: target.kind,
      materializationIdentityId: target.materializationIdentityId,
      agentId: target.agentId,
      path: target.path,
    });
  }

  private async removeTarget(target: PendingMaterializedCleanupTarget): Promise<void> {
    const key = targetKey(target);
    try {
      await this.removePath(target.path, { recursive: true, force: true });
      this.pendingTargetsByKey.delete(key);
    } catch (error) {
      const cleanupAttempts = (target.cleanupAttempts ?? 0) + 1;
      if (cleanupAttempts <= this.maxCleanupRetries) {
        this.pendingTargetsByKey.set(key, { ...target, cleanupAttempts });
      } else {
        this.pendingTargetsByKey.delete(key);
      }
      throw error;
    }
  }

  private async scheduleCleanup(
    target: ConnectedServiceMaterializedCleanupTarget,
  ): Promise<ConnectedServiceMaterializedHomeCleanupResult> {
    if (this.hasLiveTarget(target)) {
      this.pendingTargetsByKey.set(targetKey(target), target);
      return {
        cleaned: false,
        pending: true,
        kind: target.kind,
        path: target.path,
      };
    }
    await this.removeTarget(target);
    return {
      cleaned: true,
      kind: target.kind,
      path: target.path,
    };
  }

  async reconcileMaterializedHomes(): Promise<ReadonlyArray<ConnectedServiceMaterializedHomeCleanupResult>> {
    const nowMs = this.deps.nowMs();
    const retainedIdentityIds = normalizeRetainedIdentityIds(await this.deps.listRetainedIdentityIds?.());
    const results: ConnectedServiceMaterializedHomeCleanupResult[] = [];

    for (const target of await listMaterializedHomeTargets(this.deps.baseDir)) {
      if (!isStale({ nowMs, mtimeMs: target.mtimeMs, ttlMs: this.rootTtlMs })) continue;
      if (retainedIdentityIds.has(target.materializationIdentityId)) continue;
      const result = await this.scheduleCleanup(target);
      if (result.cleaned) results.push(result);
    }

    for (const target of await listMaterializedAttemptTargets(this.deps.baseDir)) {
      if (!isStale({ nowMs, mtimeMs: target.mtimeMs, ttlMs: this.attemptsTtlMs })) continue;
      const result = await this.scheduleCleanup(target);
      if (result.cleaned) results.push(result);
    }

    return results;
  }

  async cleanupPendingMaterializedHomes(): Promise<ReadonlyArray<Readonly<{
    cleaned: true;
    kind: 'home' | 'attempt';
    path: string;
  }>>> {
    const cleaned: Array<Readonly<{ cleaned: true; kind: 'home' | 'attempt'; path: string }>> = [];
    const retainedIdentityIds = normalizeRetainedIdentityIds(await this.deps.listRetainedIdentityIds?.());
    for (const [key, target] of this.pendingTargetsByKey.entries()) {
      if (target.kind === 'home' && retainedIdentityIds.has(target.materializationIdentityId)) {
        this.pendingTargetsByKey.delete(key);
        continue;
      }
      if (this.hasLiveTarget(target)) continue;
      if (target.cleanupAttempts !== undefined && target.cleanupAttempts >= this.maxCleanupRetries) {
        this.pendingTargetsByKey.delete(key);
        continue;
      }
      await this.removeTarget(target);
      cleaned.push({
        cleaned: true,
        kind: target.kind,
        path: target.path,
      });
    }
    return cleaned;
  }
}
