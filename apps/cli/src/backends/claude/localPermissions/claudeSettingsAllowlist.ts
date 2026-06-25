import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Honor the user's own Claude Code permission allowlist inside Happier.
 *
 * Claude Code stores "always allow" rules in `settings.json` under `permissions.allow`, using the same
 * `Tool` / `Tool(spec)` identifier syntax that Happier's session allowlist already understands
 * (`isToolAllowedForSession`). The spawned Claude already honors these natively (HOME is not sandboxed),
 * but seeding the Happier hook bridge's allowlist from the same rules means that if Claude ever escalates
 * a call the user has permanently allowed, the Happier app suppresses the prompt too instead of
 * re-surfacing it. This keeps the "Auto" pass-through experience aligned with the user's curated rules.
 *
 * We read, in increasing precedence, the user file and the project files. Because the result is a
 * union of allow rules (more allows simply means fewer prompts), precedence does not change the
 * outcome here; we merely de-duplicate. Any rule that also appears verbatim in `permissions.deny` is
 * dropped so an explicit deny is never converted into an allow.
 *
 * Note: only the common cases are honored at match time by `isToolAllowedForSession` — bare tool names
 * (`Read`, `Edit`, `Bash`) and shell `Bash(prefix:*)` / `Bash(exact)` rules. Path/domain-scoped rules
 * for non-shell tools (e.g. `Read(/foo/**)`) are seeded but not pattern-matched.
 */

type ClaudePermissionsBlock = {
    allow: string[];
    deny: string[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return value as Record<string, unknown>;
}

function extractStringList(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const item of value) {
        if (typeof item === 'string') {
            const trimmed = item.trim();
            if (trimmed.length > 0) out.push(trimmed);
        }
    }
    return out;
}

/** Pure: pull `permissions.allow` / `permissions.deny` rule strings out of a parsed settings object. */
export function collectPermissionRulesFromClaudeSettings(parsed: unknown): ClaudePermissionsBlock {
    const root = asRecord(parsed);
    const permissions = root ? asRecord(root.permissions) : null;
    if (!permissions) return { allow: [], deny: [] };
    return {
        allow: extractStringList(permissions.allow),
        deny: extractStringList(permissions.deny),
    };
}

function readJsonFileBestEffort(path: string): unknown {
    let raw: string;
    try {
        raw = readFileSync(path, 'utf8');
    } catch {
        return null;
    }
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

function claudeSettingsCandidatePaths(params: { homeDir: string; cwd: string | null }): string[] {
    const paths: string[] = [join(params.homeDir, '.claude', 'settings.json')];
    if (params.cwd) {
        paths.push(join(params.cwd, '.claude', 'settings.json'));
        paths.push(join(params.cwd, '.claude', 'settings.local.json'));
    }
    return paths;
}

/**
 * Read and merge the user's Claude Code `permissions.allow` rules from user + project settings files.
 * Best-effort: missing or malformed files are ignored. Returns a de-duplicated list with any verbatim
 * denied rule removed. `homeDir` is injectable for testing.
 */
export function readClaudeSettingsAllowRules(params: { cwd: string | null; homeDir?: string }): string[] {
    const homeDir = params.homeDir ?? homedir();
    const allow: string[] = [];
    const deny = new Set<string>();

    for (const path of claudeSettingsCandidatePaths({ homeDir, cwd: params.cwd })) {
        const rules = collectPermissionRulesFromClaudeSettings(readJsonFileBestEffort(path));
        allow.push(...rules.allow);
        for (const denied of rules.deny) deny.add(denied);
    }

    const seen = new Set<string>();
    const merged: string[] = [];
    for (const rule of allow) {
        if (deny.has(rule)) continue;
        if (seen.has(rule)) continue;
        seen.add(rule);
        merged.push(rule);
    }
    return merged;
}
