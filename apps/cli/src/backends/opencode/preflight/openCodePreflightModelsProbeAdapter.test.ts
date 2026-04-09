import { afterEach, describe, expect, it } from 'vitest';

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

import { createEnvKeyScope } from '@/testkit/env/envScope';
import { writeExecutableShimSync } from '@/testkit/fs/executableShim';

import { openCodePreflightModelsProbeAdapter } from './openCodePreflightModelsProbeAdapter';

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

const envKeys = ['HAPPIER_OPENCODE_PATH', 'PATH'] as const;
let envScope = createEnvKeyScope(envKeys);

afterEach(() => {
  envScope.restore();
  envScope = createEnvKeyScope(envKeys);
});

function writeFakeOpenCodeModelsBinary(dir: string, stdoutLines: ReadonlyArray<string>): string {
  const isWindows = process.platform === 'win32';
  const fileName = isWindows ? 'opencode.cmd' : 'opencode';
  const output = stdoutLines.join(isWindows ? '\r\n' : '\n');
  const contents = isWindows
    ? [
        '@echo off',
        // Best-effort; this suite runs on non-Windows in CI/dev. Keep the shim simple.
        ...output.split(/\r?\n/).map((l) => `echo ${l}`),
        `echo invoked> "${join(dir, 'invoked.txt')}"`,
        'exit /b 0',
      ].join('\r\n')
    : [
        '#!/bin/sh',
        `printf '%s' invoked > "${join(dir, 'invoked.txt')}"`,
        "cat <<'EOF'",
        output,
        'EOF',
        'exit 0',
      ].join('\n');
  return writeExecutableShimSync({ dir, fileName, contents });
}

describe('openCodePreflightModelsProbeAdapter', () => {
  let tempDir: string | null = null;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = null;
    }
  });

  it('includes a model-scoped Thinking option derived from OpenCode model variants when reasoning is supported', async () => {
    tempDir = makeTempDir('happier-opencode-preflight-models-');
    const fakeOpenCode = writeFakeOpenCodeModelsBinary(tempDir, [
      'openai/codex-mini-latest',
      '{',
      '  "id": "codex-mini-latest",',
      '  "providerID": "openai",',
      '  "name": "Codex Mini",',
      '  "family": "gpt-codex-mini",',
      '  "status": "active",',
      '  "capabilities": { "toolcall": true, "reasoning": true, "input": { "text": true, "contextWindow": 400000 } },',
      '  "variants": {',
      '    "low": { "reasoningEffort": "low" },',
      '    "medium": { "reasoningEffort": "medium" },',
      '    "high": { "reasoningEffort": "high" }',
      '  }',
      '}',
      'openai/gpt-4o-mini',
      '{',
      '  "id": "gpt-4o-mini",',
      '  "providerID": "openai",',
      '  "name": "GPT-4o Mini",',
      '  "family": "gpt-4o",',
      '  "status": "active",',
      '  "capabilities": { "toolcall": true, "reasoning": false, "input": { "text": true } },',
      '  "variants": { "high": { "reasoningEffort": "high" } }',
      '}',
    ]);

    process.env.PATH = '/usr/bin:/bin';
    process.env.HAPPIER_OPENCODE_PATH = fakeOpenCode;

    const stdout = execFileSync(fakeOpenCode, ['models', '--verbose'], { cwd: tempDir, encoding: 'utf8' });
    expect(stdout).toContain('openai/codex-mini-latest');
    expect(stdout).toContain('"variants"');

    const raw = await openCodePreflightModelsProbeAdapter.probeModelsRaw?.({
      cwd: tempDir,
      timeoutMs: 2_000,
      backendTarget: undefined,
      accountSettings: null,
    });
    expect(existsSync(join(tempDir, 'invoked.txt'))).toBe(true);

    expect(raw).toEqual([
      {
        id: 'openai/codex-mini-latest',
        name: 'Codex Mini',
        description: 'gpt-codex-mini',
        contextWindowTokens: 400000,
        modelOptions: [
          {
            id: 'reasoning_effort',
            name: 'Thinking',
            type: 'select',
            currentValue: 'medium',
            options: [
              { value: 'low', name: 'Low' },
              { value: 'medium', name: 'Medium' },
              { value: 'high', name: 'High' },
            ],
          },
        ],
      },
      {
        id: 'openai/gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'gpt-4o',
      },
    ]);
  });

  it('reads contextWindowTokens from OpenCode limit.context provider metadata', async () => {
    tempDir = makeTempDir('happier-opencode-preflight-models-limit-context-');
    const fakeOpenCode = writeFakeOpenCodeModelsBinary(tempDir, [
      'openai/gpt-5.3-codex',
      '{',
      '  "id": "gpt-5.3-codex",',
      '  "providerID": "openai",',
      '  "name": "GPT-5.3 Codex",',
      '  "family": "gpt-5.3",',
      '  "status": "active",',
      '  "capabilities": { "toolcall": true, "input": { "text": true } },',
      '  "limit": { "context": 400000, "input": 272000, "output": 128000 }',
      '}',
    ]);

    process.env.PATH = '/usr/bin:/bin';
    process.env.HAPPIER_OPENCODE_PATH = fakeOpenCode;

    const raw = await openCodePreflightModelsProbeAdapter.probeModelsRaw?.({
      cwd: tempDir,
      timeoutMs: 2_000,
      backendTarget: undefined,
      accountSettings: null,
    });

    expect(raw).toEqual([
      {
        id: 'openai/gpt-5.3-codex',
        name: 'GPT-5.3 Codex',
        description: 'gpt-5.3',
        contextWindowTokens: 400000,
      },
    ]);
  });
});
