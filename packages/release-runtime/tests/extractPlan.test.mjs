import test from 'node:test';
import assert from 'node:assert/strict';

import { planArchiveExtraction } from '../dist/extractPlan.js';

test('planArchiveExtraction selects tar for .tar.gz archives', () => {
  const planned = planArchiveExtraction({
    archiveName: 'happier-server-v1.2.3-linux-x64.tar.gz',
    archivePath: '/tmp/server.tgz',
    destDir: '/tmp/extract',
    os: 'linux',
  });
  assert.equal(planned.requiredCommand, 'tar');
  assert.deepEqual(planned.command, {
    cmd: 'tar',
    args: ['-xzf', '/tmp/server.tgz', '-C', '/tmp/extract'],
  });
});

test('planArchiveExtraction selects tar for .tar.xz archives', () => {
  const planned = planArchiveExtraction({
    archiveName: 'node-v24.14.0-linux-arm64.tar.xz',
    archivePath: '/tmp/node.txz',
    destDir: '/tmp/extract',
    os: 'linux',
  });
  assert.equal(planned.requiredCommand, 'tar');
  assert.deepEqual(planned.command, {
    cmd: 'tar',
    args: ['-xJf', '/tmp/node.txz', '-C', '/tmp/extract'],
  });
});

test('planArchiveExtraction selects tar for .zip archives on windows', () => {
  const planned = planArchiveExtraction({
    archiveName: 'happier-server-v1.2.3-windows-x64.zip',
    archivePath: 'C:\\\\Temp\\\\server.zip',
    destDir: 'C:\\\\Temp\\\\extract',
    os: 'windows',
  });
  assert.equal(planned.requiredCommand, 'tar');
  assert.deepEqual(planned.command, {
    cmd: 'tar',
    args: ['-xf', 'C:\\\\Temp\\\\server.zip', '-C', 'C:\\\\Temp\\\\extract'],
  });
});

test('planArchiveExtraction rejects unknown archive extensions', () => {
  assert.throws(() => {
    planArchiveExtraction({
      archiveName: 'happier-server-v1.2.3-linux-x64.rar',
      archivePath: '/tmp/server.rar',
      destDir: '/tmp/extract',
      os: 'linux',
    });
  }, /unsupported/i);
});
