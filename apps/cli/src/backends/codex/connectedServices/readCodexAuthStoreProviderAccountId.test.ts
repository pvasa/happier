import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withTempDir } from '@/testkit/fs/tempDir';
import {
  readCodexAuthStoreProviderAccountId,
  readCodexAuthStoreProviderAccountIdFromJson,
} from './readCodexAuthStoreProviderAccountId';

describe('readCodexAuthStoreProviderAccountId', () => {
  it('reads the connected-service flat Codex auth account id', () => {
    expect(readCodexAuthStoreProviderAccountIdFromJson({
      auth_mode: 'chatgpt',
      account_id: 'acct_flat',
      tokens: {
        account_id: 'acct_flat',
      },
    })).toEqual({ status: 'resolved', accountId: 'acct_flat' });
  });

  it('returns a conflict when auth-store account-id aliases disagree', () => {
    expect(readCodexAuthStoreProviderAccountIdFromJson({
      auth_mode: 'chatgpt',
      account_id: 'acct_flat',
      tokens: {
        account_id: 'acct_tokens',
      },
    })).toEqual({
      status: 'conflict',
      accountIds: ['acct_flat', 'acct_tokens'],
    });
  });

  it('reads the upstream Codex token account id', async () => {
    await withTempDir('happier-codex-auth-store-', async (root) => {
      const codexHome = join(root, 'codex-home');
      await mkdir(codexHome, { recursive: true });
      await writeFile(join(codexHome, 'auth.json'), JSON.stringify({
        auth_mode: 'chatgptAuthTokens',
        tokens: {
          access_token: 'redacted',
          refresh_token: 'redacted',
          account_id: 'acct_tokens',
        },
      }));

      await expect(readCodexAuthStoreProviderAccountId(codexHome)).resolves.toEqual({
        status: 'resolved',
        accountId: 'acct_tokens',
      });
    });
  });
});
