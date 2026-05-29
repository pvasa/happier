import { mkdir, mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { importConnectedServiceSessionFiles } from './importConnectedServiceSessionFiles';

describe('importConnectedServiceSessionFiles', () => {
  it('imports matching nested session files without moving the source files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-session-import-'));
    const sourceRoot = join(root, 'source');
    const destinationRoot = join(root, 'destination');
    await mkdir(join(sourceRoot, '2026', '05', '21'), { recursive: true });
    await writeFile(join(sourceRoot, '2026', '05', '21', 'rollout.jsonl'), '{"id":"local"}\n');
    await writeFile(join(sourceRoot, '2026', '05', '21', 'state.sqlite'), 'sqlite');

    const result = await importConnectedServiceSessionFiles({
      roots: [{
        sourceRoot,
        destinationRoot,
        includeFile: (relativePath) => relativePath.endsWith('.jsonl'),
      }],
    });

    expect(result).toMatchObject({
      imported: 1,
      skippedIdentical: 0,
      conflicted: 0,
    });
    await expect(readFile(join(destinationRoot, '2026', '05', '21', 'rollout.jsonl'), 'utf8')).resolves.toBe('{"id":"local"}\n');
    await expect(readFile(join(sourceRoot, '2026', '05', '21', 'rollout.jsonl'), 'utf8')).resolves.toBe('{"id":"local"}\n');
    await expect(readdir(join(destinationRoot, '2026', '05', '21'))).resolves.not.toContain('state.sqlite');
  });

  it('preserves conflicting destination files and is idempotent for existing imported conflicts', async () => {
    const root = await mkdtemp(join(tmpdir(), 'happier-session-import-conflict-'));
    const sourceRoot = join(root, 'source');
    const destinationRoot = join(root, 'destination');
    await mkdir(sourceRoot, { recursive: true });
    await mkdir(destinationRoot, { recursive: true });
    await writeFile(join(sourceRoot, 'rollout.jsonl'), '{"id":"local"}\n');
    await writeFile(join(destinationRoot, 'rollout.jsonl'), '{"id":"main"}\n');

    const first = await importConnectedServiceSessionFiles({
      roots: [{
        sourceRoot,
        destinationRoot,
        includeFile: (relativePath) => relativePath.endsWith('.jsonl'),
      }],
    });

    expect(first).toMatchObject({
      imported: 0,
      skippedIdentical: 0,
      conflicted: 1,
    });
    await expect(readFile(join(destinationRoot, 'rollout.jsonl'), 'utf8')).resolves.toBe('{"id":"main"}\n');
    const conflictEntry = (await readdir(destinationRoot)).find((entry) => entry.startsWith('rollout.happier-import-') && entry.endsWith('.jsonl'));
    expect(conflictEntry).toBeDefined();
    await expect(readFile(join(destinationRoot, conflictEntry!), 'utf8')).resolves.toBe('{"id":"local"}\n');

    const second = await importConnectedServiceSessionFiles({
      roots: [{
        sourceRoot,
        destinationRoot,
        includeFile: (relativePath) => relativePath.endsWith('.jsonl'),
      }],
    });

    expect(second).toMatchObject({
      imported: 0,
      skippedIdentical: 1,
      conflicted: 0,
    });
    const conflictEntries = (await readdir(destinationRoot)).filter((entry) => entry.startsWith('rollout.happier-import-') && entry.endsWith('.jsonl'));
    expect(conflictEntries).toHaveLength(1);
  });
});
