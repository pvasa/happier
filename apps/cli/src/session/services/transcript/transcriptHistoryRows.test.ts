import { describe, expect, it } from 'vitest';

import { extractCompactRow } from './transcriptHistoryRows';

describe('extractCompactRow', () => {
  it('extracts assistant text from output rows', () => {
    const row = extractCompactRow({
      createdAt: 1,
      fallbackId: '3',
      decrypted: {
        role: 'agent',
        content: {
          type: 'output',
          data: {
            type: 'assistant',
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'OK' }],
            },
          },
        },
      },
    });

    expect(row).toMatchObject({
      id: '3',
      createdAt: 1,
      role: 'agent',
      kind: 'output',
      text: 'OK',
    });
  });

  it('extracts provider text from ACP message rows', () => {
    const row = extractCompactRow({
      createdAt: 1,
      fallbackId: '4',
      decrypted: {
        role: 'agent',
        content: {
          type: 'acp',
          provider: 'opencode',
          data: {
            type: 'message',
            message: 'provider compact text',
          },
        },
      },
    });

    expect(row).toMatchObject({
      id: '4',
      createdAt: 1,
      role: 'agent',
      kind: 'acp',
      text: 'provider compact text',
    });
  });

  it('does not emit compact rows for event-only provider payloads', () => {
    const row = extractCompactRow({
      createdAt: 1,
      fallbackId: '5',
      decrypted: {
        role: 'agent',
        content: {
          type: 'codex',
          provider: 'codex',
          data: {
            type: 'token_count',
            input_tokens: 10,
            output_tokens: 5,
          },
        },
      },
    });

    expect(row).toBeNull();
  });

  it('extracts assistant text from Codex message rows', () => {
    const row = extractCompactRow({
      createdAt: 1,
      fallbackId: '6',
      decrypted: {
        role: 'agent',
        content: {
          type: 'codex',
          provider: 'codex',
          data: {
            type: 'message',
            message: 'codex provider text',
          },
        },
      },
    });

    expect(row).toMatchObject({
      id: '6',
      createdAt: 1,
      role: 'agent',
      kind: 'codex',
      text: 'codex provider text',
    });
  });
});
