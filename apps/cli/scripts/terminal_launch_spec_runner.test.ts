import { createRequire } from 'node:module';
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('terminal_launch_spec_runner.cjs', () => {
  it('runs a launch spec, forwards cwd/env/args, and removes the spec directory after reading', async () => {
    const mod = require('./terminal_launch_spec_runner.cjs') as {
      runLaunchSpecFile: (specPath: string) => Promise<number>;
    };
    const specDir = await mkdtemp(join(tmpdir(), 'happier-terminal-launch-spec-test-'));
    const workDir = await mkdtemp(join(tmpdir(), 'happier-terminal-launch-spec-work-'));
    const outputPath = join(workDir, 'child-output.json');
    const specPath = join(specDir, 'launch.json');
    const previousSecret = process.env.SPEC_SECRET;
    process.env.SPEC_SECRET = 'from-runner-env';
    await writeFile(specPath, JSON.stringify({
      command: process.execPath,
      args: [
        '-e',
        'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ cwd: process.cwd(), env: process.env.SPEC_ENV, secret: process.env.SPEC_SECRET, argv: process.argv.slice(2) }));',
        outputPath,
        'child-arg',
      ],
      cwd: workDir,
      env: {
        PATH: process.env.PATH ?? '',
        SPEC_ENV: 'from-spec',
      },
      envPassthroughKeys: ['SPEC_SECRET'],
    }), { mode: 0o600 });

    if (process.platform !== 'win32') {
      expect((await stat(specPath)).mode & 0o777).toBe(0o600);
    }
    const realDir = await realpath(workDir);
    try {
      await expect(mod.runLaunchSpecFile(specPath)).resolves.toBe(0);
      expect(existsSync(specPath)).toBe(false);
      await expect(readFile(outputPath, 'utf8')).resolves.toBe(JSON.stringify({
        cwd: realDir,
        env: 'from-spec',
        secret: 'from-runner-env',
        argv: ['child-arg'],
      }));
      expect(existsSync(specDir)).toBe(false);
    } finally {
      if (previousSecret === undefined) {
        delete process.env.SPEC_SECRET;
      } else {
        process.env.SPEC_SECRET = previousSecret;
      }
      await rm(workDir, { recursive: true, force: true });
    }
  });
});
