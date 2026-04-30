import { spawn } from 'node:child_process';

import { resolveYarnCommandInvocation } from '../../../scripts/workspaces/execYarnCommand.mjs';

function resolveCommandInvocation(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv) {
    const normalized = cmd.trim().toLowerCase();
    if (normalized === 'yarn' || normalized === 'yarn.cmd') {
        return resolveYarnCommandInvocation(args, { npmExecPath: env.npm_execpath });
    }
    return { command: cmd, args: [...args] };
}

export function runCommand(cmd: string, args: readonly string[], env: NodeJS.ProcessEnv): Promise<void> {
    return new Promise((resolve, reject) => {
        const invocation = resolveCommandInvocation(cmd, args, env);
        const child = spawn(invocation.command, invocation.args, {
            env: env as Record<string, string>,
            stdio: 'inherit',
            shell: false,
            ...(invocation.windowsVerbatimArguments
                ? { windowsVerbatimArguments: invocation.windowsVerbatimArguments }
                : {}),
        });
        child.on('error', reject);
        child.on('exit', (code) => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} exited with code ${code}`));
        });
    });
}
