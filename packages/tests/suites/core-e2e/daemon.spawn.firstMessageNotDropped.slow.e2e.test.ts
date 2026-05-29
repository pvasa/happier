import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { createTestAuth } from '../../src/testkit/auth';
import { startTestDaemon, type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { daemonControlPostJson } from '../../src/testkit/daemon/controlServerClient';
import { seedCliAuthForServer } from '../../src/testkit/cliAuth';
import { fakeClaudeFixturePath, waitForFakeClaudeInvocation, waitForFakeClaudeUserText, type FakeClaudeInvocation } from '../../src/testkit/fakeClaude';
import { postEncryptedUiTextMessage } from '../../src/testkit/uiMessages';
import { waitFor } from '../../src/testkit/timing';
import { fetchAllMessages, fetchSessionV2 } from '../../src/testkit/sessions';
import { decryptLegacyBase64 } from '../../src/testkit/messageCrypto';
import { enqueueSessionPromptForScenario, waitForAssistantMessageContaining } from '../../src/testkit/providers/scenarios/sessionRuntime';
import { listPendingQueueV2 } from '../../src/testkit/pendingQueueV2';

const run = createRunDirs({ runLabel: 'core' });

describe('core e2e: daemon spawn does not drop the first UI message', () => {
  let server: StartedServer | null = null;
  let daemon: StartedDaemon | null = null;

  afterEach(async () => {
    await daemon?.stop().catch(() => {});
    daemon = null;
    await server?.stop().catch(() => {});
    server = null;
  });

  afterAll(async () => {
    await daemon?.stop().catch(() => {});
    await server?.stop();
  });

  it('processes a UI message posted immediately after /spawn-session (no retry message needed)', async () => {
    const testDir = run.testDir('daemon-spawn-first-message-not-dropped');
    // Deterministic control-plane timing across environments.
    server = await startServerLight({ testDir, dbProvider: 'sqlite' });
    const auth = await createTestAuth(server.baseUrl);

    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    const workspaceDir = resolve(join(testDir, 'workspace'));
    await mkdir(daemonHomeDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    const secret = Uint8Array.from(randomBytes(32));
    await seedCliAuthForServer({ cliHome: daemonHomeDir, serverUrl: server.baseUrl, token: auth.token, secret });

    const fakeClaudePath = fakeClaudeFixturePath();
    const fakeLogPath = resolve(join(testDir, 'fake-claude.jsonl'));

    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: daemonHomeDir,
      env: {
        ...process.env,
        CI: '1',
        HAPPIER_VARIANT: 'dev',
        HAPPIER_DISABLE_CAFFEINATE: '1',
        HAPPIER_HOME_DIR: daemonHomeDir,
        HAPPIER_SERVER_URL: server.baseUrl,
        HAPPIER_WEBAPP_URL: server.baseUrl,
        HAPPIER_CLAUDE_PATH: fakeClaudePath,
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
      },
    });

    const controlToken = (daemon.state as any)?.controlToken as string | undefined;
    const spawnRes = await daemonControlPostJson<{ success: boolean; sessionId?: string }>({
      port: daemon.state.httpPort,
      path: '/spawn-session',
      controlToken,
      body: {
        directory: workspaceDir,
        terminal: { mode: 'plain' },
        environmentVariables: {
          HAPPIER_HOME_DIR: daemonHomeDir,
          HAPPIER_SERVER_URL: server.baseUrl,
          HAPPIER_WEBAPP_URL: server.baseUrl,
          HAPPIER_VARIANT: 'dev',
          HAPPIER_DISABLE_CAFFEINATE: '1',
          HAPPIER_CLAUDE_PATH: fakeClaudePath,
          HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeLogPath,
        },
      },
    });
    expect(spawnRes.status).toBe(200);
    expect(spawnRes.data.success).toBe(true);
    const sessionId = spawnRes.data.sessionId;
    expect(typeof sessionId).toBe('string');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Missing sessionId from daemon spawn-session');
    }

    // Post the very first UI message immediately (this is the upstream failure mode).
    const prompt = 'E2E_DAEMON_FIRST_MESSAGE_SHOULD_NOT_DROP';
    await postEncryptedUiTextMessage({
      baseUrl: server.baseUrl,
      token: auth.token,
      sessionId,
      secret,
      text: prompt,
      timeoutMs: 20_000,
    });

    const sdkInvocation: FakeClaudeInvocation = await waitForFakeClaudeInvocation(
      fakeLogPath,
      (i) => i.mode === 'sdk',
      { timeoutMs: 60_000, pollMs: 150 },
    );
    expect(sdkInvocation.argv.length).toBeGreaterThan(0);

    await waitFor(async () => {
      const rows = await fetchAllMessages(server!.baseUrl, auth.token, sessionId);
      const decrypted = rows
        .map((m) => decryptLegacyBase64(m.content.c, secret))
        .filter((m) => !!m && typeof m === 'object') as any[];

      const sawUser = decrypted.some((m) => m?.role === 'user' && m?.content?.text === prompt);
      const sawAssistant = decrypted.some((m) => m?.role === 'agent' && typeof m?.content?.data?.message?.content?.[0]?.text === 'string');
      return sawUser && sawAssistant;
    }, { timeoutMs: 60_000 });
  }, 240_000);

  it('processes a daemon-seeded initial prompt without dropping the first turn', async () => {
    const testDir = run.testDir('daemon-spawn-initial-prompt-not-dropped');
    server = await startServerLight({ testDir, dbProvider: 'sqlite' });
    const auth = await createTestAuth(server.baseUrl);

    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    const workspaceDir = resolve(join(testDir, 'workspace'));
    await mkdir(daemonHomeDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    const secret = Uint8Array.from(randomBytes(32));
    await seedCliAuthForServer({ cliHome: daemonHomeDir, serverUrl: server.baseUrl, token: auth.token, secret });

    const fakeClaudePath = fakeClaudeFixturePath();
    const fakeLogPath = resolve(join(testDir, 'fake-claude.jsonl'));

    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: daemonHomeDir,
      env: {
        ...process.env,
        CI: '1',
        HAPPIER_VARIANT: 'dev',
        HAPPIER_DISABLE_CAFFEINATE: '1',
        HAPPIER_HOME_DIR: daemonHomeDir,
        HAPPIER_SERVER_URL: server.baseUrl,
        HAPPIER_WEBAPP_URL: server.baseUrl,
        HAPPIER_CLAUDE_PATH: fakeClaudePath,
        HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
      },
    });

    const daemonPort = daemon.state.httpPort;
    expect(daemonPort).toBeGreaterThan(0);
    const controlToken = (daemon.state as any)?.controlToken as string | undefined;
    const prompt = 'E2E_DAEMON_INITIAL_PROMPT_SHOULD_NOT_DROP';
    const spawnRes = await daemonControlPostJson<{ success: boolean; sessionId?: string }>({
      port: daemonPort,
      path: '/spawn-session',
      controlToken,
      body: {
        directory: workspaceDir,
        terminal: { mode: 'plain' },
        environmentVariables: {
          HAPPIER_HOME_DIR: daemonHomeDir,
          HAPPIER_SERVER_URL: server.baseUrl,
          HAPPIER_WEBAPP_URL: server.baseUrl,
          HAPPIER_VARIANT: 'dev',
          HAPPIER_DISABLE_CAFFEINATE: '1',
          HAPPIER_CLAUDE_PATH: fakeClaudePath,
          HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeLogPath,
          HAPPIER_DAEMON_INITIAL_PROMPT: prompt,
        },
      },
    });
    expect(spawnRes.status).toBe(200);
    expect(spawnRes.data.success).toBe(true);
    const sessionId = spawnRes.data.sessionId;
    expect(typeof sessionId).toBe('string');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Missing sessionId from daemon spawn-session');
    }

    const fakeClaudeInvocation = await waitForFakeClaudeInvocation(
      fakeLogPath,
      () => true,
      { timeoutMs: 60_000, pollMs: 150 },
    );
    expect(fakeClaudeInvocation.argv.length).toBeGreaterThan(0);

    await waitFor(async () => {
      const rows = await fetchAllMessages(server!.baseUrl, auth.token, sessionId);
      const decrypted = rows
        .map((m) => decryptLegacyBase64(m.content.c, secret))
        .filter((m) => !!m && typeof m === 'object') as any[];

      const sawUser = decrypted.some((m) => m?.role === 'user' && m?.content?.text === prompt);
      const sawAssistant = decrypted.some((m) => m?.role === 'agent' && m?.content?.data?.message?.content?.[0]?.text === 'FAKE_CLAUDE_OK_1');
      return sawUser && sawAssistant;
    }, { timeoutMs: 60_000 });
  }, 240_000);

  it('delivers the first pending prompt when a stopped session is resumed', async () => {
    const testDir = run.testDir('daemon-resume-pending-first-message-not-dropped');
    server = await startServerLight({ testDir, dbProvider: 'sqlite' });
    const auth = await createTestAuth(server.baseUrl);

    const daemonHomeDir = resolve(join(testDir, 'daemon-home'));
    const workspaceDir = resolve(join(testDir, 'workspace'));
    await mkdir(daemonHomeDir, { recursive: true });
    await mkdir(workspaceDir, { recursive: true });

    const secret = Uint8Array.from(randomBytes(32));
    await seedCliAuthForServer({ cliHome: daemonHomeDir, serverUrl: server.baseUrl, token: auth.token, secret });

    const fakeClaudePath = fakeClaudeFixturePath();
    const fakeLogPath = resolve(join(testDir, 'fake-claude.jsonl'));
    const daemonEnv: NodeJS.ProcessEnv = {
      ...process.env,
      CI: '1',
      HAPPIER_VARIANT: 'dev',
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_HOME_DIR: daemonHomeDir,
      HAPPIER_SERVER_URL: server.baseUrl,
      HAPPIER_WEBAPP_URL: server.baseUrl,
      HAPPIER_CLAUDE_PATH: fakeClaudePath,
      HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeLogPath,
      HAPPIER_E2E_PROVIDER_USE_CLI_SOURCE_ENTRYPOINT: '1',
    };
    const sessionEnv: Record<string, string> = {
      CI: '1',
      HAPPIER_VARIANT: 'dev',
      HAPPIER_DISABLE_CAFFEINATE: '1',
      HAPPIER_HOME_DIR: daemonHomeDir,
      HAPPIER_SERVER_URL: server.baseUrl,
      HAPPIER_WEBAPP_URL: server.baseUrl,
      HAPPIER_CLAUDE_PATH: fakeClaudePath,
      HAPPIER_E2E_FAKE_CLAUDE_LOG: fakeLogPath,
    };

    daemon = await startTestDaemon({
      testDir,
      happyHomeDir: daemonHomeDir,
      env: daemonEnv,
      snapshotDir: resolve(join(testDir, 'daemon-cli-snapshot')),
    });

    const spawnRes = await daemonControlPostJson<{ success: boolean; sessionId?: string }>({
      port: daemon.state.httpPort,
      path: '/spawn-session',
      controlToken: daemon.state.controlToken,
      body: {
        directory: workspaceDir,
        terminal: { mode: 'plain' },
        environmentVariables: sessionEnv,
      },
    });
    expect(spawnRes.status).toBe(200);
    expect(spawnRes.data.success).toBe(true);
    const sessionId = spawnRes.data.sessionId;
    expect(typeof sessionId).toBe('string');
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('Missing sessionId from daemon spawn-session');
    }

    const firstPrompt = `E2E_DAEMON_RESUME_BASELINE_${randomBytes(8).toString('hex')}`;
    await enqueueSessionPromptForScenario({
      baseUrl: server.baseUrl,
      token: auth.token,
      sessionId,
      secret,
      text: firstPrompt,
    });
    await waitForFakeClaudeUserText(fakeLogPath, (text) => text.includes(firstPrompt), { timeoutMs: 60_000, pollMs: 150 });
    await waitForAssistantMessageContaining({
      baseUrl: server.baseUrl,
      token: auth.token,
      sessionId,
      secret,
      requiredSubstring: 'FAKE_CLAUDE_OK_1',
      timeoutMs: 120_000,
    });

    const stopRes = await daemonControlPostJson<{ success: boolean }>({
      port: daemon.state.httpPort,
      path: '/stop-session',
      controlToken: daemon.state.controlToken,
      body: { sessionId },
    });
    expect(stopRes.status).toBe(200);
    expect(stopRes.data.success).toBe(true);
    await waitFor(async () => {
      const snap = await fetchSessionV2(server!.baseUrl, auth.token, sessionId);
      return snap.active === false;
    }, { timeoutMs: 30_000 });

    const resumedPrompt = `E2E_DAEMON_RESUME_PENDING_${randomBytes(8).toString('hex')}`;
    await enqueueSessionPromptForScenario({
      baseUrl: server.baseUrl,
      token: auth.token,
      sessionId,
      secret,
      text: resumedPrompt,
    });
    await waitFor(async () => {
      const pending = await listPendingQueueV2({ baseUrl: server!.baseUrl, token: auth.token, sessionId });
      return pending.status === 200 && pending.data.pending?.some((item) => item.localId) === true;
    }, { timeoutMs: 30_000 });
    const beforeResumeMessages = await fetchAllMessages(server.baseUrl, auth.token, sessionId);
    const beforeResumeSeq = beforeResumeMessages.length > 0
      ? Math.max(...beforeResumeMessages.map((message) => message.seq))
      : 0;

    const resumeRes = await daemonControlPostJson<{ success: boolean; sessionId?: string }>({
      port: daemon.state.httpPort,
      path: '/spawn-session',
      controlToken: daemon.state.controlToken,
      body: {
        directory: workspaceDir,
        existingSessionId: sessionId,
        terminal: { mode: 'plain' },
        environmentVariables: sessionEnv,
      },
    });
    expect(resumeRes.status).toBe(200);
    expect(resumeRes.data.success).toBe(true);
    expect(resumeRes.data.sessionId).toBe(sessionId);

    await waitForFakeClaudeUserText(fakeLogPath, (text) => text.includes(resumedPrompt), { timeoutMs: 90_000, pollMs: 150 });
    await waitForAssistantMessageContaining({
      baseUrl: server.baseUrl,
      token: auth.token,
      sessionId,
      secret,
      requiredSubstring: 'FAKE_CLAUDE_OK_',
      afterSeqStart: beforeResumeSeq,
      timeoutMs: 120_000,
    });
    await waitFor(async () => {
      const pending = await listPendingQueueV2({ baseUrl: server!.baseUrl, token: auth.token, sessionId });
      return pending.status === 200 && Array.isArray(pending.data.pending) && pending.data.pending.length === 0;
    }, { timeoutMs: 60_000 });
  }, 300_000);
});
