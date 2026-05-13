import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import readline from 'node:readline';

import {
  readFakeCodexAppServerRequestLog,
  writeFakeCodexAppServerScript,
  type FakeCodexAppServerRequest,
} from './codexAppServerRemoteHarness';

type JsonRpcResponse = Readonly<{
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string };
  method?: string;
  params?: unknown;
}>;

async function withFakeServer<T>(
  params: Readonly<{
    initialGoal?: NonNullable<Parameters<typeof writeFakeCodexAppServerScript>[0]['initialGoal']>;
    vendorPlugins?: NonNullable<Parameters<typeof writeFakeCodexAppServerScript>[0]['vendorPlugins']>;
    skills?: NonNullable<Parameters<typeof writeFakeCodexAppServerScript>[0]['skills']>;
  }>,
  fn: (server: Readonly<{
    requestLogPath: string;
    request: (method: string, params?: Record<string, unknown> | null) => Promise<JsonRpcResponse>;
    notifications: JsonRpcResponse[];
  }>) => Promise<T>,
): Promise<T> {
  const testDir = await mkdtemp(join(tmpdir(), 'happier-fake-codex-app-server-'));
  const requestLogPath = join(testDir, 'requests.jsonl');
  const scriptPath = await writeFakeCodexAppServerScript({
    dir: testDir,
    requestLogPath,
    initialGoal: params.initialGoal,
    vendorPlugins: params.vendorPlugins,
    skills: params.skills,
  });

  const child = spawn(process.execPath, [scriptPath], {
    cwd: testDir,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const output = readline.createInterface({ input: child.stdout });
  const responses: JsonRpcResponse[] = [];
  const notifications: JsonRpcResponse[] = [];
  output.on('line', (line) => {
    const parsed = JSON.parse(line) as JsonRpcResponse;
    if (typeof parsed.id === 'number') {
      responses.push(parsed);
      return;
    }
    notifications.push(parsed);
  });

  let requestId = 0;
  const request = async (method: string, requestParams?: Record<string, unknown> | null): Promise<JsonRpcResponse> => {
    requestId += 1;
    const id = requestId;
    const startedAt = Date.now();
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params: requestParams ?? {} })}\n`);

    while (Date.now() - startedAt < 5_000) {
      const response = responses.find((candidate) => candidate.id === id);
      if (response) return response;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error(`Timed out waiting for fake app-server response to ${method}`);
  };

  try {
    return await fn({ requestLogPath, request, notifications });
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await rm(testDir, { recursive: true, force: true });
  }
}

describe('fake Codex app-server harness', () => {
  it('supports goal, vendor plugin, skill, and structured input request contracts', async () => {
    await withFakeServer(
      {
        initialGoal: {
          threadId: 'thread-started',
          objective: 'ship goal controls',
          status: 'active',
          tokenBudget: 4000,
          tokensUsed: 10,
          timeUsedSeconds: 2,
        },
        vendorPlugins: [
          {
            id: 'gmail@openai-curated',
            name: 'gmail',
            displayName: 'Gmail',
            mentionPath: 'plugin://gmail@openai-curated',
            installed: true,
            enabled: true,
          },
        ],
        skills: [
          {
            name: 'code-review',
            displayName: 'Code Review',
            path: '/skills/code-review/SKILL.md',
            enabled: true,
          },
        ],
      },
      async ({ request, requestLogPath, notifications }) => {
        await expect(request('thread/goal/get', { threadId: 'thread-started' })).resolves.toMatchObject({
          result: expect.objectContaining({
            objective: 'ship goal controls',
            status: 'active',
            tokenBudget: 4000,
          }),
        });

        await expect(request('thread/goal/set', {
          threadId: 'thread-started',
          objective: 'round trip a goal',
          status: 'paused',
          tokenBudget: 2000,
        })).resolves.toMatchObject({
          result: expect.objectContaining({
            objective: 'round trip a goal',
            status: 'paused',
            tokenBudget: 2000,
          }),
        });
        expect(notifications).toEqual(expect.arrayContaining([
          expect.objectContaining({
            method: 'thread/goal/updated',
            params: expect.objectContaining({
              goal: expect.objectContaining({ objective: 'round trip a goal' }),
            }),
          }),
        ]));

        await expect(request('plugin/list', { cwds: ['/tmp/project'] })).resolves.toMatchObject({
          result: [
            expect.objectContaining({
              name: 'gmail',
              mentionPath: 'plugin://gmail@openai-curated',
              installed: true,
              enabled: true,
            }),
          ],
        });

        await expect(request('skills/list', { cwds: ['/tmp/project'] })).resolves.toMatchObject({
          result: [
            expect.objectContaining({
              name: 'code-review',
              path: '/skills/code-review/SKILL.md',
              enabled: true,
            }),
          ],
        });

        await expect(request('turn/start', {
          threadId: 'thread-started',
          input: [
            { type: 'text', text: 'inspect this' },
            { type: 'mention', name: 'gmail', path: 'plugin://gmail@openai-curated' },
            { type: 'skill', name: 'code-review', path: '/skills/code-review/SKILL.md' },
            { type: 'localImage', path: '/tmp/project/screenshot.png' },
          ],
        })).resolves.toMatchObject({
          result: expect.objectContaining({
            threadId: 'thread-started',
          }),
        });

        await expect(request('thread/goal/clear', { threadId: 'thread-started' })).resolves.toMatchObject({
          result: { threadId: 'thread-started' },
        });
        expect(notifications).toEqual(expect.arrayContaining([
          expect.objectContaining({
            method: 'thread/goal/cleared',
            params: { threadId: 'thread-started' },
          }),
        ]));

        const requests: FakeCodexAppServerRequest[] = await readFakeCodexAppServerRequestLog(requestLogPath);
        expect(requests).toEqual(expect.arrayContaining([
          expect.objectContaining({ method: 'thread/goal/get' }),
          expect.objectContaining({ method: 'thread/goal/set' }),
          expect.objectContaining({ method: 'plugin/list' }),
          expect.objectContaining({ method: 'skills/list' }),
          expect.objectContaining({
            method: 'turn/start',
            params: expect.objectContaining({
              input: expect.arrayContaining([
                expect.objectContaining({ type: 'mention', path: 'plugin://gmail@openai-curated' }),
                expect.objectContaining({ type: 'skill', path: '/skills/code-review/SKILL.md' }),
                expect.objectContaining({ type: 'localImage', path: '/tmp/project/screenshot.png' }),
              ]),
            }),
          }),
        ]));
      },
    );
  });
});
