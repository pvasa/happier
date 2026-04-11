import { describe, expect, it, vi } from 'vitest';

import { createStepPrinter } from './progress.js';

describe('createStepPrinter', () => {
  it('prints plain step lines when tty output is unavailable', () => {
    const stdoutWriteSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStderrIsTTY = process.stderr.isTTY;

    Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: false });
    Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: false });

    try {
      const printer = createStepPrinter({ enabled: true });
      printer.start('Downloading payload');
      printer.stop('✓', 'Downloading payload');

      const output = stdoutWriteSpy.mock.calls.map(([chunk]) => String(chunk)).join('');
      expect(output).toContain('- [..] Downloading payload');
      expect(output).toContain('- [✓] Downloading payload');
    } finally {
      stdoutWriteSpy.mockRestore();
      Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: originalStdoutIsTTY });
      Object.defineProperty(process.stderr, 'isTTY', { configurable: true, value: originalStderrIsTTY });
    }
  });
});
