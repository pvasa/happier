import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const repoRoot = join(import.meta.dirname, '..', '..');

function extractJobBlock(raw, jobName) {
  const match = raw.match(new RegExp(`(?:^|\\n)  ${jobName}:\\n([\\s\\S]*?)(?=\\n  [A-Za-z0-9-]+:|\\n$)`));
  assert.ok(match, `expected to find job block for ${jobName}`);
  return match[1];
}

test('tests workflow keeps UI and Stack test jobs above the observed CI timeout floor', async () => {
  const raw = await readFile(join(repoRoot, '.github', 'workflows', 'tests.yml'), 'utf8');
  const uiJob = extractJobBlock(raw, 'ui');
  const stackJob = extractJobBlock(raw, 'stack');

  assert.match(
    uiJob,
    /name:\s*UI Tests \(unit \+ integration\)[\s\S]*?timeout-minutes:\s*25\b/,
    'UI Tests job should reserve enough time to finish on GitHub-hosted runners',
  );

  assert.match(
    stackJob,
    /name:\s*Stack Tests \(unit \+ integration\)[\s\S]*?timeout-minutes:\s*20\b/,
    'Stack Tests job should reserve enough time to finish on GitHub-hosted runners',
  );
});
