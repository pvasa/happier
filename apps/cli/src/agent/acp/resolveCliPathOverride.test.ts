import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveCliPathOverride } from './resolveCliPathOverride';

describe('resolveCliPathOverride', () => {
  const originalPlatformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
  const originalOverride = process.env.HAPPIER_OPENCODE_PATH;
  const tempDirs = new Set<string>();

  afterEach(() => {
    if (originalPlatformDescriptor) {
      Object.defineProperty(process, 'platform', originalPlatformDescriptor);
    }
    if (originalOverride === undefined) {
      delete process.env.HAPPIER_OPENCODE_PATH;
    } else {
      process.env.HAPPIER_OPENCODE_PATH = originalOverride;
    }
    for (const dir of tempDirs) {
      rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.clear();
  });

  it('prefers the .cmd shim over an extensionless Windows override path', () => {
    if (!originalPlatformDescriptor) {
      throw new Error('Expected process.platform to be configurable for this test');
    }
    Object.defineProperty(process, 'platform', { ...originalPlatformDescriptor, value: 'win32' });

    const root = mkdtempSync(join(tmpdir(), 'happier-acp-override-win32-'));
    tempDirs.add(root);

    const extensionlessPath = join(root, 'opencode');
    writeFileSync(extensionlessPath, '', 'utf8');
    const cmdShimPath = join(root, 'opencode.cmd');
    writeFileSync(cmdShimPath, '@echo off\r\necho ok\r\n', 'utf8');

    process.env.HAPPIER_OPENCODE_PATH = extensionlessPath;
    process.env.PATHEXT = '.CMD;.EXE';

    expect(resolveCliPathOverride({ agentId: 'opencode' })?.toLowerCase()).toBe(cmdShimPath.toLowerCase());
  });
});
