import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export type CodexAuthStoreProviderAccountIdProof =
  | Readonly<{ status: 'resolved'; accountId: string }>
  | Readonly<{ status: 'missing' }>
  | Readonly<{ status: 'conflict'; accountIds: readonly string[] }>;

export function readCodexAuthStoreProviderAccountIdFromJson(value: unknown): CodexAuthStoreProviderAccountIdProof {
  const record = readRecord(value);
  if (!record) return { status: 'missing' };
  const tokens = readRecord(record.tokens);
  const tokenIdToken = readRecord(tokens?.id_token);
  const ids = [
    readString(record.account_id),
    readString(record.accountId),
    readString(record.chatgptAccountId),
    readString(tokens?.account_id),
    readString(tokenIdToken?.chatgpt_account_id),
  ].filter((id): id is string => Boolean(id));
  if (ids.length === 0) return { status: 'missing' };
  const first = ids[0];
  if (ids.every((id) => id === first)) return { status: 'resolved', accountId: first };
  return { status: 'conflict', accountIds: Array.from(new Set(ids)) };
}

export async function readCodexAuthStoreProviderAccountId(
  codexHome: string,
): Promise<CodexAuthStoreProviderAccountIdProof> {
  const normalizedCodexHome = codexHome.trim();
  if (!normalizedCodexHome) return { status: 'missing' };
  let raw: string;
  try {
    raw = await readFile(join(normalizedCodexHome, 'auth.json'), 'utf8');
  } catch {
    return { status: 'missing' };
  }
  try {
    return readCodexAuthStoreProviderAccountIdFromJson(JSON.parse(raw));
  } catch {
    return { status: 'missing' };
  }
}
