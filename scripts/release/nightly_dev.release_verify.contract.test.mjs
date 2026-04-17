import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('nightly-dev workflow runs reusable release verification against the dev channel', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'nightly-dev.yml'), 'utf8');

  assert.match(
    raw,
    /release_verify:[\s\S]*?needs:\s*\[cli, hstack, server_runtime, ui_web, ui_mobile, ui_desktop, docker\][\s\S]*?uses:\s*\.\/\.github\/workflows\/release-verify\.yml/,
    'nightly-dev should invoke the reusable release-verify workflow after publish lanes finish',
  );
  assert.match(
    raw,
    /release_verify:[\s\S]*?channel:\s*dev/,
    'nightly-dev should validate the dev channel through release-verify',
  );
});
