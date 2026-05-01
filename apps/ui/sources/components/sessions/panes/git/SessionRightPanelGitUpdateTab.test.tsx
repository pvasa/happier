import * as React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';
import { installSessionFilesCommonModuleMocks } from '@/components/sessions/files/sessionFilesTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const sessionScmRemoteAddMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sessionScmRemoteSetUrlMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sessionScmRemoteRemoveMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sessionScmBranchMergeMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sessionScmBranchRebaseMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sessionScmBranchOperationContinueMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const sessionScmBranchOperationAbortMock = vi.hoisted(() => vi.fn(async () => ({ success: true })));
const invalidateFromMutationAndAwaitMock = vi.hoisted(() => vi.fn(async () => {}));
const modalConfirmMock = vi.hoisted(() => vi.fn(async () => true));
const modalAlertMock = vi.hoisted(() => vi.fn());

installSessionFilesCommonModuleMocks();

vi.mock('@/components/sessions/files/SourceControlBranchSummary', () => ({
    SourceControlBranchSummary: (props: Record<string, unknown>) => React.createElement('SourceControlBranchSummary', props),
}));

vi.mock('@/components/sessions/sourceControl/remoteActions/SourceControlRemoteActionsRail', () => ({
    SourceControlRemoteActionsRail: (props: Record<string, unknown>) => React.createElement('SourceControlRemoteActionsRail', props),
}));

vi.mock('@/components/ui/scroll/useScrollEdgeFades', () => ({
    useScrollEdgeFades: () => ({
        onViewportLayout: vi.fn(),
        onContentSizeChange: vi.fn(),
        onScroll: vi.fn(),
        visibility: {},
    }),
}));

vi.mock('@/components/ui/scroll/ScrollEdgeFades', () => ({
    ScrollEdgeFades: (props: Record<string, unknown>) => React.createElement('ScrollEdgeFades', props),
}));

vi.mock('@/components/ui/scroll/ScrollEdgeIndicators', () => ({
    ScrollEdgeIndicators: (props: Record<string, unknown>) => React.createElement('ScrollEdgeIndicators', props),
}));

vi.mock('@/sync/ops/sessions', () => ({
    sessionScmRemoteAdd: sessionScmRemoteAddMock,
    sessionScmRemoteSetUrl: sessionScmRemoteSetUrlMock,
    sessionScmRemoteRemove: sessionScmRemoteRemoveMock,
    sessionScmBranchMerge: sessionScmBranchMergeMock,
    sessionScmBranchRebase: sessionScmBranchRebaseMock,
    sessionScmBranchOperationContinue: sessionScmBranchOperationContinueMock,
    sessionScmBranchOperationAbort: sessionScmBranchOperationAbortMock,
}));

vi.mock('@/scm/scmStatusSync', () => ({
    scmStatusSync: {
        invalidateFromMutationAndAwait: invalidateFromMutationAndAwaitMock,
    },
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            alert: modalAlertMock,
            confirm: modalConfirmMock,
        },
    }).module;
});

const theme = {
    colors: {
        divider: 'divider',
        input: {
            background: 'input-background',
            border: 'input-border',
        },
        primary: 'primary',
        surface: 'surface',
        surfaceHigh: 'surface-high',
        text: 'text',
        textSecondary: 'text-secondary',
        textLink: 'text-link',
    },
};

function createSnapshot(overrides: Record<string, unknown> = {}) {
    return {
        fetchedAt: 1,
        projectKey: 'm1:/repo',
        repo: {
            isRepo: true,
            rootPath: '/repo',
            backendId: 'git',
            mode: '.git',
            remotes: [
                {
                    name: 'origin',
                    fetchUrl: 'git@example.com:repo.git',
                    pushUrl: 'git@example.com:repo.git',
                },
            ],
        },
        capabilities: {
            readBranches: true,
            writeRemoteAdd: true,
            writeRemoteSetUrl: true,
            writeRemoteRemove: true,
            writeBranchMerge: true,
            writeBranchRebase: true,
            writeBranchOperationControl: true,
        },
        branch: {
            head: 'main',
            upstream: 'origin/main',
            ahead: 0,
            behind: 0,
            detached: false,
        },
        stashCount: 0,
        hasConflicts: false,
        entries: [],
        totals: {
            includedFiles: 0,
            pendingFiles: 0,
            untrackedFiles: 0,
            includedAdded: 0,
            includedRemoved: 0,
            pendingAdded: 0,
            pendingRemoved: 0,
        },
        ...overrides,
    };
}

const scmStatusFiles = {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    includedFiles: [],
    pendingFiles: [],
    totalIncluded: 0,
    totalPending: 0,
};

describe('SessionRightPanelGitUpdateTab', () => {
    beforeEach(() => {
        sessionScmRemoteAddMock.mockClear();
        sessionScmRemoteSetUrlMock.mockClear();
        sessionScmRemoteRemoveMock.mockClear();
        sessionScmBranchMergeMock.mockClear();
        sessionScmBranchRebaseMock.mockClear();
        sessionScmBranchOperationContinueMock.mockClear();
        sessionScmBranchOperationAbortMock.mockClear();
        invalidateFromMutationAndAwaitMock.mockClear();
        modalConfirmMock.mockClear();
        modalAlertMock.mockClear();
    });

    it('renders remote management and branch integration sections with stable test ids', async () => {
        const { SessionRightPanelGitUpdateTab } = await import('./SessionRightPanelGitUpdateTab');

        const screen = await renderScreen(
            <SessionRightPanelGitUpdateTab
                theme={theme}
                sessionId="session-1"
                scmSnapshot={createSnapshot({
                    operationState: {
                        kind: 'merge',
                        sourceRef: 'origin/main',
                        canContinue: true,
                        canAbort: true,
                    },
                }) as any}
                scmWriteEnabled
                actions={[]}
                scmStatusFiles={scmStatusFiles as any}
            />,
        );

        expect(screen.findByTestId('scm-update-remotes-section')).not.toBeNull();
        expect(screen.findByTestId('scm-update-add-remote')).not.toBeNull();
        expect(screen.findByTestId('scm-update-remote-edit')).not.toBeNull();
        expect(screen.findByTestId('scm-update-remote-remove')).not.toBeNull();
        expect(screen.findByTestId('scm-update-branch-integration-section')).not.toBeNull();
        expect(screen.findByTestId('scm-update-branch-source-picker')).not.toBeNull();
        expect(screen.findByTestId('scm-update-branch-merge')).not.toBeNull();
        expect(screen.findByTestId('scm-update-branch-rebase')).not.toBeNull();
        expect(screen.findByTestId('scm-update-branch-operation-continue')).not.toBeNull();
        expect(screen.findByTestId('scm-update-branch-operation-abort')).not.toBeNull();
    });

    it('runs remote management operations and refreshes the SCM snapshot', async () => {
        const { SessionRightPanelGitUpdateTab } = await import('./SessionRightPanelGitUpdateTab');

        const screen = await renderScreen(
            <SessionRightPanelGitUpdateTab
                theme={theme}
                sessionId="session-1"
                scmSnapshot={createSnapshot() as any}
                scmWriteEnabled
                actions={[]}
                scmStatusFiles={scmStatusFiles as any}
            />,
        );

        act(() => {
            screen.changeTextByTestId('scm-remote-editor-name', 'backup');
            screen.changeTextByTestId('scm-remote-editor-fetch-url', 'git@example.com:backup.git');
        });
        await screen.pressByTestIdAsync('scm-remote-editor-save');

        expect(sessionScmRemoteAddMock).toHaveBeenCalledWith('session-1', {
            name: 'backup',
            fetchUrl: 'git@example.com:backup.git',
        });

        await screen.pressByTestIdAsync('scm-update-remote-edit');
        act(() => {
            screen.changeTextByTestId('scm-remote-editor-fetch-url', 'git@example.com:next.git');
            screen.changeTextByTestId('scm-remote-editor-push-url', 'git@example.com:push.git');
        });
        await screen.pressByTestIdAsync('scm-remote-editor-save');

        expect(sessionScmRemoteSetUrlMock).toHaveBeenCalledWith('session-1', {
            name: 'origin',
            fetchUrl: 'git@example.com:next.git',
            pushUrl: 'git@example.com:push.git',
        });

        await screen.pressByTestIdAsync('scm-update-remote-remove');

        expect(modalConfirmMock).toHaveBeenCalled();
        expect(sessionScmRemoteRemoveMock).toHaveBeenCalledWith('session-1', {
            name: 'origin',
        });
        expect(invalidateFromMutationAndAwaitMock).toHaveBeenCalledWith('session-1');
    });

    it('runs branch integration operations and refreshes the SCM snapshot', async () => {
        const { SessionRightPanelGitUpdateTab } = await import('./SessionRightPanelGitUpdateTab');

        const screen = await renderScreen(
            <SessionRightPanelGitUpdateTab
                theme={theme}
                sessionId="session-1"
                scmSnapshot={createSnapshot({
                    operationState: {
                        kind: 'merge',
                        sourceRef: 'origin/main',
                        canContinue: true,
                        canAbort: true,
                    },
                }) as any}
                scmWriteEnabled
                actions={[]}
                scmStatusFiles={scmStatusFiles as any}
            />,
        );

        act(() => {
            screen.changeTextByTestId('scm-update-branch-source-picker', 'origin/main');
        });
        await screen.pressByTestIdAsync('scm-update-branch-merge');
        await screen.pressByTestIdAsync('scm-update-branch-rebase');
        await screen.pressByTestIdAsync('scm-update-branch-operation-continue');
        await screen.pressByTestIdAsync('scm-update-branch-operation-abort');

        expect(sessionScmBranchMergeMock).toHaveBeenCalledWith('session-1', {
            sourceRef: 'origin/main',
        });
        expect(sessionScmBranchRebaseMock).toHaveBeenCalledWith('session-1', {
            sourceRef: 'origin/main',
        });
        expect(sessionScmBranchOperationContinueMock).toHaveBeenCalledWith('session-1', {
            operation: 'merge',
        });
        expect(sessionScmBranchOperationAbortMock).toHaveBeenCalledWith('session-1', {
            operation: 'merge',
        });
        expect(invalidateFromMutationAndAwaitMock).toHaveBeenCalledWith('session-1');
    });
});
