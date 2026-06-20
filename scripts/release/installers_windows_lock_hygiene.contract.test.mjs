import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

test('install.ps1 performs deterministic Windows lock hygiene before payload promotion', async () => {
  const path = join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1');
  const raw = await readFile(path, 'utf8');
  const trimmed = raw.replace(/^\uFEFF?/, '').trimStart();

  assert.match(
    trimmed,
    /Invoke-InstallerPreInstallLockHygiene[\s\S]*\$promotionResult\s*=\s*Invoke-InstallerPayloadPromotionWithTimeout/i,
    'expected lock hygiene to run before payload promotion',
  );
  assert.ok(
    trimmed.includes('@("service", "stop", "--json")'),
    'expected lock hygiene to stop managed background services before payload promotion',
  );
  assert.ok(
    trimmed.includes('@("daemon", "stop", "--all", "--kill-sessions", "--json")'),
    'expected lock hygiene to stop managed daemon-owned sessions before payload promotion',
  );
  assert.match(
    trimmed,
    /\$happierProcessNames\s*=\s*@\(\s*"happier",\s*"hprev",\s*"hdev"\s*\)/i,
    'expected lock hygiene to target known Happier process names only',
  );
  assert.match(
    trimmed,
    /Stop-Process\s+-Id\s+\$process\.ProcessId\s+-Force\s+-ErrorAction\s+SilentlyContinue/i,
    'expected lock hygiene to force-stop scoped holder processes',
  );
  assert.match(
    trimmed,
    /Wait-InstallerLockHygieneProcessesToExit/i,
    'expected lock hygiene to wait for holders to exit before promotion proceeds',
  );
});

test('install.ps1 cleans stale version backup directories before payload promotion', async () => {
  const path = join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1');
  const raw = await readFile(path, 'utf8');
  const trimmed = raw.replace(/^\uFEFF?/, '').trimStart();

  assert.match(
    trimmed,
    /Remove-StaleInstallerVersionBackups/i,
    'expected lock hygiene to include stale backup cleanup',
  );
  assert.match(
    trimmed,
    /Get-ChildItem\s+-Path\s+\$versionsDir\s+-Directory[\s\S]*\.bak-/i,
    'expected stale backup cleanup to target versioned .bak-* directories',
  );
});

test('install.ps1 returns lock hygiene match needles as a string array', async () => {
  const path = join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1');
  const raw = await readFile(path, 'utf8');
  const functionMatch = raw.match(/function Get-InstallerLockHygieneMatchNeedles\s*\{[\s\S]*?\n\}/);

  assert.ok(functionMatch, 'expected Get-InstallerLockHygieneMatchNeedles to exist');
  assert.match(
    functionMatch[0],
    /return\s+\$needles\.ToArray\(\)/i,
    'expected PowerShell to return a string[] instead of wrapping the generic list as one object',
  );
  assert.doesNotMatch(
    functionMatch[0],
    /return\s+@\(\$needles\)/i,
    'return @($needles) wraps the generic list and fails the typed -MatchNeedles binding on Windows',
  );
});

test('install.ps1 returns scoped process matches as an object array', async () => {
  const path = join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1');
  const raw = await readFile(path, 'utf8');
  const functionMatch = raw.match(/function Get-InstallerScopedHappierProcesses\s*\{[\s\S]*?\n\}/);

  assert.ok(functionMatch, 'expected Get-InstallerScopedHappierProcesses to exist');
  assert.match(
    functionMatch[0],
    /return\s+\$matched\.ToArray\(\)/i,
    'expected PowerShell to return matched processes as an object[] instead of wrapping the generic list',
  );
  assert.doesNotMatch(
    functionMatch[0],
    /return\s+@\(\$matched\)/i,
    'return @($matched) wraps the generic list and throws on Windows when lock hygiene returns',
  );
});

test('install.ps1 bounds pre-install service stop commands so stale CLIs cannot hang upgrades', async () => {
  const path = join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1');
  const raw = await readFile(path, 'utf8');
  const timeoutResolver = raw.match(/function Resolve-InstallerPreInstallCommandTimeoutMs\s*\{[\s\S]*?\n\}(?=\n\nfunction )/);
  const timeoutHelper = raw.match(
    /function Invoke-InstallerCommandWithDaemonServiceContextCapturingOutputWithTimeout\s*\{[\s\S]*?\n\}(?=\n\nfunction )/,
  );
  const preInstall = raw.match(/function Invoke-InstallerPreInstallLockHygiene\s*\{[\s\S]*?\n\}(?=\n\nfunction )/);

  assert.ok(timeoutResolver, 'expected a pre-install command timeout resolver');
  assert.ok(timeoutHelper, 'expected a bounded daemon-service command helper');
  assert.ok(preInstall, 'expected Invoke-InstallerPreInstallLockHygiene to exist');
  assert.match(timeoutHelper[0], /\.WaitForExit\(\$timeoutMs\)/);
  assert.match(timeoutHelper[0], /Stop-InstallerProcessTree\s+-Process\s+\$process/i);
  assert.match(timeoutHelper[0], /ExitCode\s*=\s*124/);
  assert.match(
    preInstall[0],
    /Invoke-InstallerCommandWithDaemonServiceContextCapturingOutputWithTimeout[\s\S]*-TimeoutMs\s+\$preInstallCommandTimeoutMs/i,
    'expected pre-install service and daemon stop commands to use the bounded helper',
  );
  assert.doesNotMatch(
    preInstall[0],
    /Invoke-NativeCommandCapturingOutput\s*\{[\s\S]*?Invoke-InstallerCommandWithDaemonServiceContext/i,
    'pre-install lock hygiene must not invoke existing CLIs through an unbounded native capture',
  );
});

test('install.ps1 uses a PowerShell 5.1-compatible process-tree cleanup helper for timeout paths', async () => {
  const path = join(repoRoot, 'scripts', 'release', 'installers', 'install.ps1');
  const raw = await readFile(path, 'utf8');
  const processTreeHelper = raw.match(/function Stop-InstallerProcessTree\s*\{[\s\S]*?\n\}(?=\n\nfunction )/);
  const preInstallTimeoutHelper = raw.match(
    /function Invoke-InstallerCommandWithDaemonServiceContextCapturingOutputWithTimeout\s*\{[\s\S]*?\n\}(?=\n\nfunction )/,
  );
  const payloadPromotionTimeoutHelper = raw.match(
    /function Invoke-InstallerPayloadPromotionWithTimeout\s*\{[\s\S]*?\n\}(?=\n\nfunction )/,
  );

  assert.ok(processTreeHelper, 'expected a shared timeout process-tree cleanup helper');
  assert.match(
    processTreeHelper[0],
    /\.Kill\(\$true\)/i,
    'expected the helper to try the modern .NET process-tree kill first',
  );
  assert.match(
    processTreeHelper[0],
    /taskkill(?:\.exe)?[\s\S]*\/T[\s\S]*\/F[\s\S]*\/PID|Win32_Process[\s\S]*ParentProcessId/i,
    'expected the helper to include a Windows PowerShell 5.1-compatible descendant cleanup fallback',
  );

  assert.ok(preInstallTimeoutHelper, 'expected a bounded pre-install command helper');
  assert.ok(payloadPromotionTimeoutHelper, 'expected a bounded payload promotion helper');
  for (const [label, helper] of [
    ['pre-install', preInstallTimeoutHelper[0]],
    ['payload promotion', payloadPromotionTimeoutHelper[0]],
  ]) {
    assert.match(
      helper,
      /Stop-InstallerProcessTree\s+-Process\s+\$process/i,
      `expected ${label} timeout cleanup to use the shared process-tree helper`,
    );
    assert.doesNotMatch(
      helper,
      /catch\s*\{[\s\S]*?Stop-Process\s+-Id\s+\$process\.Id\s+-Force/i,
      `expected ${label} timeout cleanup not to fall back to direct-PID-only Stop-Process`,
    );
  }
});
