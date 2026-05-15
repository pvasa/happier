import React from 'react';
import { act } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    createPartialStorageModuleMock,
    findGestureByKind,
    invokeTestInstanceHandler,
    renderScreen,
    standardCleanup,
} from '@/dev/testkit';
import { driveSessionListDragGesture } from './__tests__/driveSessionListDragGesture';
import { installSessionShellCommonModuleMocks } from './sessionShellTestHelpers';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const setSessionListGroupOrderV1 = vi.fn();
const setCollapsedGroupKeysV1 = vi.fn();
const setSessionFolderViewModeV1 = vi.fn();
const setSessionFoldersV1 = vi.fn();
const setSessionTagsV1 = vi.fn();
const setSessionListFocusedFolderV1 = vi.fn();
const modalPromptSpy = vi.hoisted(() => vi.fn(async () => null as string | null));
const modalConfirmSpy = vi.hoisted(() => vi.fn(async () => false));
const modalShowSpy = vi.hoisted(() => vi.fn((_config: unknown) => 'move-sheet-modal'));
const modalHideSpy = vi.hoisted(() => vi.fn());
const getCredentialsForServerUrlSpy = vi.hoisted(() => vi.fn(async () => ({ accessToken: 'token-a' })));
const getServerProfileByIdSpy = vi.hoisted(() => vi.fn((serverId: string) => serverId === 'server_a'
    ? { id: 'server_a', serverUrl: 'https://server-a.test' }
    : null));
const setSessionFolderAssignmentSpy = vi.hoisted(() => vi.fn(async () => undefined));
const moveSessionFolderAssignmentsSpy = vi.hoisted(() => vi.fn(async () => undefined));

let sessionFolderViewModeV1: 'off' | 'tree' = 'tree';
let sessionFoldersV1: any = { v: 1, folders: [] };
let sessionListFocusedFolderV1: any = null;
let collapsedGroupKeysV1: Record<string, boolean> = {};
let mockVisibleSessionListViewData: any[] = [];

installSessionShellCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            Platform: { OS: 'web', select: (value: any) => value.web ?? value.default },
            FlatList: ({ data, renderItem, keyExtractor, ListHeaderComponent, ListFooterComponent, ...rest }: any) =>
                React.createElement(
                    'FlatList',
                    { ...rest },
                    ListHeaderComponent ? React.createElement(ListHeaderComponent) : null,
                    (data ?? []).map((item: any, index: number) => {
                        const key = keyExtractor ? keyExtractor(item, index) : String(index);
                        return React.createElement(React.Fragment, { key }, renderItem({ item, index }));
                    }),
                    ListFooterComponent ? React.createElement(ListFooterComponent) : null,
                ),
        });
    },
    router: async () => {
        const { createExpoRouterMock } = await import('@/dev/testkit/mocks/router');
        return createExpoRouterMock({ pathname: '', router: { push: vi.fn(), replace: vi.fn(), back: vi.fn() } }).module;
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    modal: async () => {
        const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
        return createModalModuleMock({
            spies: {
                show: modalShowSpy as any,
                hide: modalHideSpy as any,
                prompt: modalPromptSpy as any,
                confirm: modalConfirmSpy as any,
            },
        }).module;
    },
    storage: async (importOriginal) => createPartialStorageModuleMock(importOriginal, {
        useAllMachines: () => [],
        useProfile: () => ({ id: 'profile-1' }),
        useSetting: (key: string) => {
            if (key === 'hideInactiveSessions') return false;
            if (key === 'sessionTagsEnabled') return false;
            if (key === 'sessionListDensity') return 'default';
            if (key === 'rememberLastProjectSessionSelections') return false;
            if (key === 'sessionFolderViewModeV1') return sessionFolderViewModeV1;
            if (key === 'sessionFoldersV1') return sessionFoldersV1;
            return null;
        },
        useSettingMutable: (key: string) => {
            if (key === 'sessionListGroupOrderV1') return [{}, setSessionListGroupOrderV1];
            if (key === 'collapsedGroupKeysV1') return [collapsedGroupKeysV1, setCollapsedGroupKeysV1];
            if (key === 'sessionFolderViewModeV1') return [sessionFolderViewModeV1, setSessionFolderViewModeV1];
            if (key === 'sessionFoldersV1') return [sessionFoldersV1, setSessionFoldersV1];
            if (key === 'sessionTagsV1') return [{}, setSessionTagsV1];
            if (key === 'pinnedSessionKeysV1') return [[], vi.fn()];
            if (key === 'workspaceLabelsV1') return [{}, vi.fn()];
            return [null, vi.fn()];
        },
        useLocalSettingMutable: (key: string) => {
            if (key === 'sessionListFocusedFolderV1') {
                const [focusedFolder, setFocusedFolder] = React.useState(sessionListFocusedFolderV1);
                return [
                    focusedFolder,
                    (nextFocusedFolder: typeof sessionListFocusedFolderV1) => {
                        sessionListFocusedFolderV1 = nextFocusedFolder;
                        setSessionListFocusedFolderV1(nextFocusedFolder);
                        setFocusedFolder(nextFocusedFolder);
                    },
                ];
            }
            return [[], vi.fn()];
        },
    }),
});

vi.mock('react-native-reanimated', () => ({
    default: { View: (props: any) => React.createElement('Animated.View', props) },
    useSharedValue: (init: any) => ({ value: init }),
    useAnimatedStyle: (fn: () => any) => fn(),
    withSpring: (value: any) => value,
}));

vi.mock('react-native-gesture-handler', async () => {
    const { createGestureHandlerMock } = await import('@/dev/testkit/mocks/gestureHandler');
    return createGestureHandlerMock();
});

vi.mock('react-native-worklets', () => ({
    scheduleOnRN: (fn: (...args: any[]) => void, ...args: any[]) => fn(...args),
}));

vi.mock('react-native-safe-area-context', () => ({
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

vi.mock('@/hooks/server/useEffectiveServerSelection', () => ({
    useResolvedActiveServerSelection: () => ({
        enabled: true,
        presentation: 'grouped',
        activeServerId: 'server_a',
        allowedServerIds: ['server_a'],
    }),
}));

vi.mock('@/hooks/server/useFeatureDecision', () => ({
    useFeatureDecision: () => ({ state: 'enabled' }),
}));

vi.mock('@/hooks/session/useVisibleSessionListViewData', () => ({
    useVisibleSessionListViewData: () => mockVisibleSessionListViewData,
}));

vi.mock('@/hooks/session/useNavigateToSession', () => ({
    useNavigateToSession: () => vi.fn(),
}));

vi.mock('@/auth/storage/tokenStorage', () => ({
    TokenStorage: {
        getCredentialsForServerUrl: getCredentialsForServerUrlSpy,
    },
}));

vi.mock('@/sync/domains/server/serverProfiles', () => ({
    getServerProfileById: getServerProfileByIdSpy,
}));

vi.mock('@/sync/ops/sessionFolders', () => ({
    setSessionFolderAssignment: setSessionFolderAssignmentSpy,
    moveSessionFolderAssignments: moveSessionFolderAssignmentsSpy,
}));

vi.mock('@/components/account/RecoveryKeyReminderBanner', () => ({
    RecoveryKeyReminderBanner: 'RecoveryKeyReminderBanner',
}));

vi.mock('@/components/ui/feedback/UpdateBanner', () => ({
    UpdateBanner: 'UpdateBanner',
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: any) => React.createElement(
        'DropdownMenu',
        props,
        typeof props.trigger === 'function'
            ? props.trigger({
                open: props.open,
                toggle: vi.fn(),
                openMenu: vi.fn(),
                closeMenu: vi.fn(),
                selectedItem: null,
            })
            : props.trigger ?? null,
    ),
}));

vi.mock('./SessionItem', () => ({
    SessionItem: (props: any) => React.createElement('SessionItem', {
        ...props,
        testID: `session-list-session:${String(props.session?.id ?? 'unknown')}`,
    }),
}));

const workspace = { t: 'workspaceScope', serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' };
const projectGroupKey = 'server:server_a:active:project:project_a';
const folderGroupKey = `${projectGroupKey}:folder:folder_a`;
const sessionA = { id: 'sess_a', createdAt: 1, active: true, presence: 'online', metadata: null };
const sessionB = { id: 'sess_b', createdAt: 2, active: true, presence: 'online', metadata: null };

function resetFolderData() {
    mockVisibleSessionListViewData = [
        { type: 'header', title: 'Active', headerKind: 'active', groupKey: 'active', serverId: 'server_a' },
        {
            type: 'header',
            title: '~/repo',
            headerKind: 'project',
            groupKey: projectGroupKey,
            workspaceKey: 'project_a',
            workspaceScopeHint: { serverId: 'server_a', machineId: 'machine_a', rootPath: '/repo' },
            serverId: 'server_a',
        },
        {
            type: 'header',
            title: 'Planning',
            headerKind: 'folder',
            groupKey: folderGroupKey,
            workspace,
            renderWorkspaceKey: 'project_a',
            folderId: 'folder_a',
            parentFolderId: null,
            depth: 1,
            sessionCount: 47,
            serverId: 'server_a',
        },
        {
            type: 'session',
            session: sessionA,
            groupKey: folderGroupKey,
            groupKind: 'folder',
            folderId: 'folder_a',
            folderDepth: 1,
            serverId: 'server_a',
        },
        {
            type: 'session',
            session: sessionB,
            groupKey: projectGroupKey,
            groupKind: 'project',
            folderId: null,
            folderDepth: 0,
            serverId: 'server_a',
        },
    ];
}

async function renderSessionsList() {
    const { SessionsList } = await import('./SessionsList');
    return renderScreen(<SessionsList />);
}

function findSessionGesture(
    screen: Awaited<ReturnType<typeof renderSessionsList>>,
    sessionId: string,
) {
    const row = screen.findByTestId(`session-list-session:${sessionId}`);
    expect(row, `expected ${sessionId} session row`).toBeTruthy();
    const gesture = row?.props.reorderHandleGesture;
    expect(findGestureByKind(gesture, 'pan')).toBeTruthy();
    return gesture;
}

function findFolderGesture(screen: Awaited<ReturnType<typeof renderSessionsList>>) {
    const detector = screen.root.findAllByType('GestureDetector' as React.ElementType)
        .find((node) => findGestureByKind(node.props.gesture, 'pan'));
    expect(detector, 'expected folder GestureDetector').toBeTruthy();
    return detector?.props.gesture;
}

describe('SessionsList session folders shell', () => {
    beforeEach(() => {
        sessionFolderViewModeV1 = 'tree';
        sessionFoldersV1 = {
            v: 1,
            folders: [{
                id: 'folder_a',
                workspace,
                renderWorkspaceKey: 'project_a',
                parentId: null,
                name: 'Planning',
                createdAt: 1,
                updatedAt: 1,
            }],
        };
        sessionListFocusedFolderV1 = null;
        collapsedGroupKeysV1 = {};
        setSessionListGroupOrderV1.mockClear();
        setCollapsedGroupKeysV1.mockClear();
        setSessionFolderViewModeV1.mockClear();
        setSessionFoldersV1.mockClear();
        setSessionTagsV1.mockClear();
        setSessionListFocusedFolderV1.mockClear();
        modalPromptSpy.mockReset();
        modalPromptSpy.mockResolvedValue(null);
        modalConfirmSpy.mockReset();
        modalConfirmSpy.mockResolvedValue(false);
        modalShowSpy.mockReset();
        modalShowSpy.mockReturnValue('move-sheet-modal');
        modalHideSpy.mockReset();
        getCredentialsForServerUrlSpy.mockClear();
        getServerProfileByIdSpy.mockClear();
        setSessionFolderAssignmentSpy.mockClear();
        moveSessionFolderAssignmentsSpy.mockClear();
        resetFolderData();
        standardCleanup();
    });

    it('renders folder headers with stable e2e ids', async () => {
        const screen = await renderSessionsList();

        expect(screen.findByTestId('session-folder-header-folder_a')).toBeTruthy();
        expect(screen.findByTestId('session-folder-reorder-handle-folder_a')).toBeTruthy();
        expect(screen.findByTestId('session-folder-menu-trigger-folder_a')).toBeTruthy();
        expect(screen.findByTestId('session-folder-drop-target-folder_a')).toBeTruthy();
        expect(screen.getTextContent()).not.toContain('47');
    });

    it('attaches the folder drag gesture on web', async () => {
        const screen = await renderSessionsList();

        expect(findGestureByKind(findFolderGesture(screen), 'pan')).toBeTruthy();
    });

    it('persists focused folder requests', async () => {
        const screen = await renderSessionsList();

        await act(async () => {
            invokeTestInstanceHandler(
                screen.findByTestId('session-folder-header-folder_a'),
                'onPress',
                undefined,
                'expected folder header',
            );
        });

        expect(setSessionListFocusedFolderV1).toHaveBeenCalledWith({
            folderId: 'folder_a',
            workspace,
            renderWorkspaceKey: 'project_a',
            serverId: 'server_a',
        });
    });

    it('restores focused folder state from local settings', async () => {
        sessionListFocusedFolderV1 = {
            folderId: 'folder_a',
            workspace,
            renderWorkspaceKey: 'project_a',
            serverId: 'server_a',
        };

        const screen = await renderSessionsList();

        expect(screen.findByTestId('session-folder-breadcrumb')).toBeTruthy();
        expect(screen.findByTestId('session-list-session:sess_a')).toBeTruthy();
        expect(screen.findByTestId('session-list-session:sess_b')).toBeNull();
    });

    it('renders the view menu with a folder view toggle on primary section headers', async () => {
        const screen = await renderSessionsList();

        const menu = screen.findByTestId('session-list-ordering-menu-trigger');
        expect(menu).toBeTruthy();
        const dropdown = screen.findAllByType('DropdownMenu' as React.ElementType)
            .find((node) => node.props?.items?.some((item: any) => item.testID === 'session-folder-view-toggle'));

        expect(dropdown).toBeTruthy();
        expect(dropdown?.props.selectedId).toBe('folder-view-tree');

        dropdown?.props.onSelect('folder-view-off');
        expect(setSessionFolderViewModeV1).toHaveBeenCalledWith('off');
    });

    it('passes folder indentation and move menu options to session rows', async () => {
        mockVisibleSessionListViewData.splice(3, 0, {
            type: 'header',
            title: 'Execution',
            headerKind: 'folder',
            groupKey: `${folderGroupKey}:folder:folder_b`,
            workspace,
            renderWorkspaceKey: 'project_a',
            folderId: 'folder_b',
            parentFolderId: 'folder_a',
            depth: 2,
            sessionCount: 3,
            serverId: 'server_a',
        });
        sessionFoldersV1 = {
            ...sessionFoldersV1,
            folders: [
                ...sessionFoldersV1.folders,
                {
                    id: 'folder_b',
                    workspace,
                    renderWorkspaceKey: 'project_a',
                    parentId: 'folder_a',
                    name: 'Execution',
                    createdAt: 2,
                    updatedAt: 2,
                },
            ],
        };

        const screen = await renderSessionsList();

        const folderRow = screen.findByTestId('session-list-session:sess_a');
        expect(folderRow?.props.folderDepth).toBe(1);
        expect(folderRow?.props.folderMoveMenuItems).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ id: 'move-to-folder:folder_a' }),
                expect.objectContaining({ id: 'move-to-folder:null' }),
            ]),
        );

        const moveMenuItems = folderRow?.props.folderMoveMenuItems ?? [];
        const rootTarget = moveMenuItems.find((item: any) => item.id === 'move-to-folder:null');
        const parentFolderTarget = moveMenuItems.find((item: any) => item.id === 'move-to-folder:folder_a');
        const childFolderTarget = moveMenuItems.find((item: any) => item.id === 'move-to-folder:folder_b');
        expect(rootTarget?.rowContainerStyle).toBeUndefined();
        expect(parentFolderTarget?.rowContainerStyle).toMatchObject({ paddingLeft: expect.any(Number) });
        expect(childFolderTarget?.rowContainerStyle).toMatchObject({ paddingLeft: expect.any(Number) });
        expect(childFolderTarget.rowContainerStyle.paddingLeft).toBeGreaterThan(parentFolderTarget.rowContainerStyle.paddingLeft);
    });

    it('keeps collapsed child folders available in the row move menu', async () => {
        mockVisibleSessionListViewData.splice(3, 0, {
            type: 'header',
            title: 'Execution',
            headerKind: 'folder',
            groupKey: `${folderGroupKey}:folder:folder_b`,
            workspace,
            renderWorkspaceKey: 'project_a',
            folderId: 'folder_b',
            parentFolderId: 'folder_a',
            depth: 2,
            sessionCount: 3,
            serverId: 'server_a',
        });
        sessionFoldersV1 = {
            ...sessionFoldersV1,
            folders: [
                ...sessionFoldersV1.folders,
                {
                    id: 'folder_b',
                    workspace,
                    renderWorkspaceKey: 'project_a',
                    parentId: 'folder_a',
                    name: 'Execution',
                    createdAt: 2,
                    updatedAt: 2,
                },
            ],
        };
        collapsedGroupKeysV1 = { [folderGroupKey]: true };

        const screen = await renderSessionsList();

        expect(screen.findByTestId('session-folder-header-folder_b')).toBeNull();

        const rootRow = screen.findByTestId('session-list-session:sess_b');
        const moveMenuItems = rootRow?.props.folderMoveMenuItems ?? [];
        expect(moveMenuItems).toEqual(expect.arrayContaining([
            expect.objectContaining({ id: 'move-to-folder:folder_b' }),
        ]));
    });

    it('passes a real drag gesture into session rows', async () => {
        const screen = await renderSessionsList();

        expect(findGestureByKind(findSessionGesture(screen, 'sess_a'), 'pan')).toBeTruthy();
    });

    it('persists a row menu move through the row server assignment op', async () => {
        const screen = await renderSessionsList();
        const row = screen.findByTestId('session-list-session:sess_b');

        await act(async () => {
            row?.props.onMoveToFolder();
            await Promise.resolve();
            await Promise.resolve();
        });
        await vi.waitFor(() => {
            expect(modalShowSpy).toHaveBeenCalled();
        });
        const modalConfig = modalShowSpy.mock.calls[0]?.[0] as { props?: { targets?: readonly any[]; onSelectTarget?: (target: any) => void } };
        const target = modalConfig.props?.targets?.find((entry) => entry.id === 'folder:folder_a');
        expect(target).toBeTruthy();

        await act(async () => {
            modalConfig.props?.onSelectTarget?.(target);
            await Promise.resolve();
        });

        expect(getServerProfileByIdSpy).toHaveBeenCalledWith('server_a');
        expect(getCredentialsForServerUrlSpy).toHaveBeenCalledWith('https://server-a.test', { serverId: 'server_a' });
        expect(setSessionFolderAssignmentSpy).toHaveBeenCalledWith({
            credentials: { accessToken: 'token-a' },
            serverId: 'server_a',
            serverUrl: 'https://server-a.test',
            sessionId: 'sess_b',
            folderId: 'folder_a',
        });
    });

    it('reorders a session row down through the same tree drop commit path', async () => {
        mockVisibleSessionListViewData.splice(4, 0, {
            type: 'session',
            session: { id: 'sess_c', createdAt: 3, active: true, presence: 'online', metadata: null },
            groupKey: folderGroupKey,
            groupKind: 'folder',
            folderId: 'folder_a',
            folderDepth: 1,
            serverId: 'server_a',
        });
        const screen = await renderSessionsList();
        const row = screen.findByTestId('session-list-session:sess_a');

        await act(async () => {
            row?.props.onMoveDown();
            await Promise.resolve();
        });

        expect(setSessionListGroupOrderV1).toHaveBeenCalledWith({
            [folderGroupKey]: ['server_a:sess_c', 'server_a:sess_a'],
        });
    });

    it('drives the real session-row drag gesture without legacy intent props', async () => {
        const screen = await renderSessionsList();
        const row = screen.findByTestId('session-list-session:sess_b');

        await driveSessionListDragGesture({
            gesture: findSessionGesture(screen, 'sess_b'),
            pointerSequence: [
                { x: 20, y: 220 },
                { x: 20, y: 244 },
            ],
        });

        expect(row?.props.onDropIntent).toBeUndefined();
        expect(row?.props.resolveDropIntent).toBeUndefined();
    });

    it('drives the real folder header drag gesture', async () => {
        sessionFoldersV1 = {
            v: 1,
            folders: [
                ...sessionFoldersV1.folders,
                {
                    id: 'folder_b',
                    workspace,
                    renderWorkspaceKey: 'project_a',
                    parentId: null,
                    name: 'Archive',
                    createdAt: 2,
                    updatedAt: 2,
                },
            ],
        };
        const screen = await renderSessionsList();

        await driveSessionListDragGesture({
            gesture: findFolderGesture(screen),
            pointerSequence: [
                { x: 20, y: 80 },
                { x: 20, y: 120 },
            ],
        });
    });

    it('does not expose legacy drag intent props to session rows', async () => {
        const screen = await renderSessionsList();
        const row = screen.findByTestId('session-list-session:sess_a');

        expect(row?.props.onDragEnd).toBeUndefined();
        expect(row?.props.onDropIntent).toBeUndefined();
        expect(row?.props.resolveDropIntent).toBeUndefined();
    });

    it('does not expose legacy drag intent props to folder header rows', async () => {
        const screen = await renderSessionsList();

        expect(findGestureByKind(findFolderGesture(screen), 'pan')).toBeTruthy();
    });

    it('creates a root folder from the workspace menu', async () => {
        modalPromptSpy.mockResolvedValueOnce('Roadmap');
        const screen = await renderSessionsList();
        await act(async () => {
            invokeTestInstanceHandler(
                screen.findByTestId(`session-list-project-header:${projectGroupKey}`),
                'onHoverIn',
                undefined,
                'expected project header',
            );
        });
        const workspaceMenu = screen.findAllByType('DropdownMenu' as React.ElementType)
            .find((node) => node.props?.items?.some((item: any) => item.id === 'add-folder'));

        await act(async () => {
            await workspaceMenu?.props.onSelect('add-folder');
        });

        expect(setSessionFoldersV1).toHaveBeenCalledWith(expect.objectContaining({
            v: 1,
            folders: expect.arrayContaining([
                expect.objectContaining({
                    name: 'Roadmap',
                    parentId: null,
                    workspace,
                    renderWorkspaceKey: 'project_a',
                }),
            ]),
        }));
    });

    it('creates and renames subfolders from the folder menu', async () => {
        const screen = await renderSessionsList();
        const folderMenu = screen.findAllByType('DropdownMenu' as React.ElementType)
            .find((node) => node.props?.items?.some((item: any) => item.id === 'add-subfolder'));

        modalPromptSpy.mockResolvedValueOnce('Implementation');
        await act(async () => {
            await folderMenu?.props.onSelect('add-subfolder');
        });
        expect(setSessionFoldersV1).toHaveBeenCalledWith(expect.objectContaining({
            folders: expect.arrayContaining([
                expect.objectContaining({ name: 'Implementation', parentId: 'folder_a' }),
            ]),
        }));

        setSessionFoldersV1.mockClear();
        modalPromptSpy.mockResolvedValueOnce('Renamed planning');
        await act(async () => {
            await folderMenu?.props.onSelect('rename');
        });
        expect(setSessionFoldersV1).toHaveBeenCalledWith(expect.objectContaining({
            folders: expect.arrayContaining([
                expect.objectContaining({ id: 'folder_a', name: 'Renamed planning' }),
            ]),
        }));
    });

    it('moves assignments before deleting a folder subtree', async () => {
        modalConfirmSpy.mockResolvedValueOnce(true);
        const screen = await renderSessionsList();
        const folderMenu = screen.findAllByType('DropdownMenu' as React.ElementType)
            .find((node) => node.props?.items?.some((item: any) => item.id === 'delete'));

        await act(async () => {
            await folderMenu?.props.onSelect('delete');
        });

        expect(moveSessionFolderAssignmentsSpy).toHaveBeenCalledWith({
            credentials: { accessToken: 'token-a' },
            serverId: 'server_a',
            serverUrl: 'https://server-a.test',
            fromFolderIds: ['folder_a'],
            toFolderId: null,
        });
        expect(setSessionFoldersV1).toHaveBeenCalledWith(expect.objectContaining({
            folders: [],
        }));
    });
});
