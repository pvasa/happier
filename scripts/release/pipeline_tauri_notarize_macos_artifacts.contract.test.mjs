import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const notarizeScriptPath = resolve(repoRoot, 'scripts', 'pipeline', 'tauri', 'notarize-macos-artifacts.mjs');

test('tauri notarize-macos-artifacts script supports dry-run', async () => {
  const out = execFileSync(
    process.execPath,
    [
      resolve(repoRoot, 'scripts', 'pipeline', 'tauri', 'notarize-macos-artifacts.mjs'),
      '--ui-dir',
      'apps/ui',
      '--tauri-target',
      'aarch64-apple-darwin',
      '--dry-run',
    ],
    {
      cwd: repoRoot,
      env: { ...process.env },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
    },
  );

  assert.match(out, /\bxcrun notarytool submit\b/);
  assert.match(out, /\btauri signer sign\b/);
});

test('tauri notarization retries transient Apple notarytool submit timeouts only', async () => {
  const source = readFileSync(notarizeScriptPath, 'utf8');
  assert.match(source, /shouldRetryNotarytoolSubmitError/);

  const timeoutError = new Error(
    'Command failed: xcrun notarytool submit app.zip --wait\n'
    + 'Error: HTTPError(statusCode: nil, error: Error Domain=NSURLErrorDomain Code=-1001 "The request timed out.")',
  );
  const signingError = new Error(
    'Command failed: xcrun notarytool submit app.zip --wait\n'
    + 'Error: The binary is not signed with a valid Developer ID certificate.',
  );

  const { shouldRetryNotarytoolSubmitError } = await import('../pipeline/tauri/notarize-macos-artifacts.mjs');
  assert.equal(shouldRetryNotarytoolSubmitError(timeoutError), true);
  assert.equal(shouldRetryNotarytoolSubmitError(signingError), false);
});
