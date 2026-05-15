import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react-test-renderer';

import { renderHook, standardCleanup } from '@/dev/testkit';
import { storage } from '@/sync/domains/state/storageStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useSessionWorkspacePath', () => {
    afterEach(() => {
        storage.setState({
            sessions: {},
            isDataReady: true,
        } as never);
        standardCleanup();
    });

    it('does not rerender when the session updates without changing its workspace path', async () => {
        storage.setState({
            sessions: {
                s1: {
                    id: 's1',
                    active: true,
                    metadata: {
                        path: '/workspace',
                    },
                },
            },
            getProjectForSession: () => null,
            isDataReady: true,
        } as never);

        const hooks = await import('./hooks') as typeof import('./hooks') & {
            useSessionWorkspacePath?: (sessionId: string | null) => string | null;
        };
        expect(hooks.useSessionWorkspacePath).toBeTypeOf('function');

        let renderCount = 0;
        const hook = await renderHook(() => {
            renderCount += 1;
            return hooks.useSessionWorkspacePath?.('s1') ?? null;
        });

        expect(hook.getCurrent()).toBe('/workspace');
        expect(renderCount).toBe(1);

        await act(async () => {
            const previousSession = storage.getState().sessions.s1;
            storage.setState({
                sessions: {
                    s1: {
                        ...previousSession,
                        thinking: true,
                        thinkingAt: 456,
                    },
                },
            } as never);
        });

        expect(hook.getCurrent()).toBe('/workspace');
        expect(renderCount).toBe(1);

        await hook.unmount();
    });
});
