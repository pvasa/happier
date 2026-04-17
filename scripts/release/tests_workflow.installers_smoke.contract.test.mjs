import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('tests workflow gates installer smoke on existing release tags (bootstrap-friendly)', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'tests.yml'), 'utf8');
  const installerJobs = [
    /installers-smoke-linux:[\s\S]*?installers-smoke-macos:/,
    /installers-smoke-macos:[\s\S]*?installers-smoke-windows:/,
    /installers-smoke-windows:[\s\S]*?binary-smoke:/,
  ].map((pattern) => {
    const match = raw.match(pattern);
    assert.ok(match?.[0], `expected installer smoke job block for ${pattern}`);
    return match[0];
  });

  for (const block of installerJobs) {
    assert.match(block, /node scripts\/pipeline\/run\.mjs release-validate/, 'installer smoke jobs should call the unified release-validation runner');
    assert.match(block, /--suite installers-smoke/, 'installer smoke jobs should declare the installers-smoke suite');
    assert.doesNotMatch(block, /releases\/tags\//, 'installer smoke jobs should not own GitHub release tag probing directly');
    assert.doesNotMatch(block, /steps\.cli_tag\.outputs\.tag_exists/, 'installer smoke jobs should not gate execution with inline cli_tag logic');
  }
});
