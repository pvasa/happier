import { test, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { createRunDirs } from '../../src/testkit/runDir';
import { startServerLight, type StartedServer } from '../../src/testkit/process/serverLight';
import { startUiWeb, type StartedUiWeb } from '../../src/testkit/process/uiWeb';
import { type StartedDaemon } from '../../src/testkit/daemon/daemon';
import { authenticateAndStartDaemon } from '../../src/testkit/uiE2e/authenticateAndStartDaemon';
import { gotoDomContentLoadedWithRetries, normalizeLoopbackBaseUrl } from '../../src/testkit/uiE2e/pageNavigation';
import { waitForInitialAppUi } from '../../src/testkit/uiE2e/waitForInitialAppUi';
import { enableEnhancedSessionWizard } from '../../src/testkit/uiE2e/enableEnhancedSessionWizard';
import { ensureAccountReadyForConnect } from '../../src/testkit/uiE2e/ensureAccountReadyForConnect';

const run = createRunDirs({ runLabel: 'ui-e2e' });

test.describe('ui e2e: MCP settings quick install and new-session picker', () => {
    test.describe.configure({ mode: 'serial' });

    const suiteDir = run.testDir('settings-mcp-quick-install-picker-suite');
    const cliHomeDir = resolve(join(suiteDir, 'cli-home'));
    const codexHomeDir = resolve(join(suiteDir, 'codex-home'));

    let server: StartedServer | null = null;
    let ui: StartedUiWeb | null = null;
    let uiBaseUrl: string | null = null;
    let daemon: StartedDaemon | null = null;

    test.beforeAll(async () => {
        test.setTimeout(900_000);
        await mkdir(cliHomeDir, { recursive: true });
        await mkdir(codexHomeDir, { recursive: true });
        await writeFile(
            resolve(join(codexHomeDir, 'config.toml')),
            [
                '[mcp_servers.context7]',
                'command = "npx"',
                'args = ["-y","@upstash/context7-mcp@latest"]',
                'enabled = true',
                '',
            ].join('\n'),
            'utf8',
        );

        server = await startServerLight({
            testDir: suiteDir,
            dbProvider: 'sqlite',
            extraEnv: {
                HAPPIER_BUILD_FEATURES_DENY: 'sharing.contentKeys',
                HAPPIER_FEATURE_AUTH_LOGIN__KEY_CHALLENGE_ENABLED: '1',
                HAPPIER_PRESENCE_SESSION_TIMEOUT_MS: '60000',
                HAPPIER_PRESENCE_MACHINE_TIMEOUT_MS: '60000',
                HAPPIER_PRESENCE_TIMEOUT_TICK_MS: '1000',
            },
        });

        ui = await startUiWeb({
            testDir: suiteDir,
            env: {
                ...process.env,
                EXPO_PUBLIC_DEBUG: '1',
                EXPO_PUBLIC_HAPPY_SERVER_URL: server.baseUrl,
                EXPO_PUBLIC_HAPPY_STORAGE_SCOPE: `e2e-${run.runId}`,
            },
        });

        uiBaseUrl = normalizeLoopbackBaseUrl(ui.baseUrl);
    });

    test.afterAll(async () => {
        test.setTimeout(120_000);
        await daemon?.stop().catch(() => {});
        await ui?.stop().catch(() => {});
        await server?.stop().catch(() => {});
    });

    test('quick installs a managed MCP server and previews it in the new-session MCP picker', async ({ page }) => {
        test.setTimeout(540_000);
        if (!server || !uiBaseUrl) throw new Error('missing server/ui fixtures');

        await page.setViewportSize({ width: 1440, height: 900 });

        await gotoDomContentLoadedWithRetries(page, uiBaseUrl, 420_000);
        await waitForInitialAppUi({ page, timeoutMs: 420_000 });

        const createAccountByTestId = page.getByTestId('welcome-create-account');
        const createAccountByRole = page.getByRole('button', { name: 'Create account' });
        const createAccount =
            (await createAccountByTestId.count()) ? createAccountByTestId
                : (await createAccountByRole.count()) ? createAccountByRole
                    : null;
        if (createAccount) {
            await ensureAccountReadyForConnect({ page, timeoutMs: 120_000 });
        }

        const testDir = resolve(join(suiteDir, 't1-connect-daemon'));
        await mkdir(testDir, { recursive: true });

        daemon = await authenticateAndStartDaemon({
            page,
            testDir,
            cliHomeDir,
            serverUrl: server.baseUrl,
            uiBaseUrl,
            createAccount: false,
            daemonStartupTimeoutMs: 180_000,
            extraEnv: {
                CODEX_HOME: codexHomeDir,
            },
        });

        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/`, 120_000);
        await waitForInitialAppUi({ page, timeoutMs: 120_000 });

        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/settings/mcp`);
        await expect(page.getByTestId('settings.mcpServers.segment:configured')).toHaveCount(1, { timeout: 180_000 });
        await page.getByTestId('settings.mcpServers.addServer').click();
        await expect(page.getByTestId('mcp.server.addFlow.tab.quickInstall')).toHaveCount(1, { timeout: 60_000 });
        await page.getByTestId('mcp.server.addFlow.tab.quickInstall').click();
        await page.getByTestId('mcp.server.quickInstall.preset.playwright').click();
        await page.getByTestId('mcp.server.quickInstall.install').click();
        await expect(page.getByText('playwright', { exact: true })).toHaveCount(1, { timeout: 60_000 });

        await page.getByTestId('settings.mcpServers.segment:detected').click();
        await expect(page.getByTestId('settings.mcpServers.detect.refresh')).toHaveCount(1, { timeout: 60_000 });
        await page.getByTestId('settings.mcpServers.detect.refresh').click();
        await expect(page.getByText('context7', { exact: true })).toHaveCount(1, { timeout: 60_000 });

        await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new`, 180_000);
        if ((await page.getByTestId('new-session-composer-input').count()) === 0) {
            await enableEnhancedSessionWizard({ page, baseUrl: uiBaseUrl, timeoutMs: 180_000 });
            await gotoDomContentLoadedWithRetries(page, `${uiBaseUrl}/new`, 180_000);
        }
        await expect(page.getByTestId('new-session-composer-input')).toHaveCount(1, { timeout: 180_000 });

        const mcpChip = page.getByTestId('new-session-mcp-chip');
        await expect(mcpChip).toContainText('MCP 2', { timeout: 120_000 });
        await mcpChip.click();

        await expect(page.getByTestId('new-session.mcp.built-in.happier')).toHaveCount(1, { timeout: 60_000 });
        await expect(page.getByText('playwright', { exact: true })).toHaveCount(1, { timeout: 60_000 });

        await page.getByTestId('new-session.mcp.managed-enabled').click();
        await expect(mcpChip).toContainText('MCP 1', { timeout: 60_000 });
    });
});
