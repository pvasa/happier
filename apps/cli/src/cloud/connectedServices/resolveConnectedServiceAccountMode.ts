import type { ApiClient } from '@/api/api';
import { createConnectedServiceAccountModeCache } from './createConnectedServiceAccountModeCache';
import type { ConnectedServiceAccountMode } from './createConnectedServiceAccountModeCache';

export type { ConnectedServiceAccountMode } from './createConnectedServiceAccountModeCache';

const accountModeCache = createConnectedServiceAccountModeCache();

export async function resolveConnectedServiceAccountMode(
  api: Partial<Pick<ApiClient, 'getAccountEncryptionMode'>>,
  options?: Readonly<{ refresh?: boolean }>,
): Promise<ConnectedServiceAccountMode> {
  if (options?.refresh) return await accountModeCache.refresh(api);
  return await accountModeCache.resolve(api);
}

export function invalidateConnectedServiceAccountMode(
  api?: Partial<Pick<ApiClient, 'getAccountEncryptionMode'>>,
): void {
  if (api) {
    accountModeCache.invalidate(api);
    return;
  }
  accountModeCache.clear();
}
