import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    collectPermissionRulesFromClaudeSettings,
    readClaudeSettingsAllowRules,
} from './claudeSettingsAllowlist';

describe('collectPermissionRulesFromClaudeSettings', () => {
    it('extracts allow and deny rule strings', () => {
        const parsed = {
            permissions: {
                allow: ['Read', 'Bash(git status:*)', 42, ''],
                deny: ['Bash(rm:*)'],
            },
        };
        expect(collectPermissionRulesFromClaudeSettings(parsed)).toEqual({
            allow: ['Read', 'Bash(git status:*)'],
            deny: ['Bash(rm:*)'],
        });
    });

    it('returns empty blocks for malformed input', () => {
        expect(collectPermissionRulesFromClaudeSettings(null)).toEqual({ allow: [], deny: [] });
        expect(collectPermissionRulesFromClaudeSettings('nope')).toEqual({ allow: [], deny: [] });
        expect(collectPermissionRulesFromClaudeSettings({ permissions: { allow: 'x' } })).toEqual({ allow: [], deny: [] });
    });
});

describe('readClaudeSettingsAllowRules', () => {
    let homeDir: string;
    let cwd: string;

    async function writeSettings(root: string, fileName: string, body: unknown): Promise<void> {
        await mkdir(join(root, '.claude'), { recursive: true });
        await writeFile(join(root, '.claude', fileName), JSON.stringify(body), 'utf8');
    }

    beforeEach(async () => {
        homeDir = await mkdtemp(join(tmpdir(), 'claude-home-'));
        cwd = await mkdtemp(join(tmpdir(), 'claude-proj-'));
    });

    afterEach(async () => {
        await rm(homeDir, { recursive: true, force: true });
        await rm(cwd, { recursive: true, force: true });
    });

    it('merges user + project + project-local allow rules, de-duplicated', async () => {
        await writeSettings(homeDir, 'settings.json', { permissions: { allow: ['Read', 'Bash(git status:*)'] } });
        await writeSettings(cwd, 'settings.json', { permissions: { allow: ['Edit', 'Read'] } });
        await writeSettings(cwd, 'settings.local.json', { permissions: { allow: ['Bash(npm run build:*)'] } });

        expect(readClaudeSettingsAllowRules({ cwd, homeDir })).toEqual([
            'Read',
            'Bash(git status:*)',
            'Edit',
            'Bash(npm run build:*)',
        ]);
    });

    it('drops an allow rule that is also denied verbatim', async () => {
        await writeSettings(homeDir, 'settings.json', {
            permissions: { allow: ['Bash(rm:*)', 'Read'], deny: ['Bash(rm:*)'] },
        });
        expect(readClaudeSettingsAllowRules({ cwd, homeDir })).toEqual(['Read']);
    });

    it('is best-effort when files are missing', () => {
        expect(readClaudeSettingsAllowRules({ cwd, homeDir })).toEqual([]);
        expect(readClaudeSettingsAllowRules({ cwd: null, homeDir })).toEqual([]);
    });
});
