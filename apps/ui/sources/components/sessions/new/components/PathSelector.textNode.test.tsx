import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import { findTestInstanceByTypeWithProps, pressTestInstanceAsync, renderScreen } from '@/dev/testkit';
import { installNewSessionComponentsCommonModuleMocks } from './newSessionComponentsTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installNewSessionComponentsCommonModuleMocks({
    icons: () => ({
        Ionicons: () => <>{'.'}</>,
    }),
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock({
            View: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('View', props, props.children),
            Pressable: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
                React.createElement('Pressable', props, props.children),
            Platform: {
                OS: 'web',
                select: (v: any) => v.web ?? v.default ?? null,
            },
        });
    },
    text: async () => {
        const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
        return createTextModuleMock({ translate: (key) => key });
    },
    unistyles: async () => {
        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock({
            theme: {
                colors: {
                    text: '#000',
                    textSecondary: '#666',
                    divider: '#ddd',
                    input: { background: '#fff', text: '#000', placeholder: '#999' },
                    button: { primary: { background: '#00f' } },
                },
            },
            rt: { themeName: 'light' },
        });
    },
});

vi.mock('@/components/ui/lists/ItemGroup', () => ({
    ItemGroup: (props: Record<string, unknown> & { children?: React.ReactNode }) =>
        React.createElement('ItemGroup', props, props.children),
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: (props: any) => React.createElement(
        'Item',
        props,
        [
            props.leftElement == null ? null : React.createElement('Text', { key: 'left' }, props.leftElement),
            props.rightElement == null ? null : React.createElement(React.Fragment, { key: 'right' }, props.rightElement),
            props.subtitle == null ? null : React.createElement('Text', { key: 'subtitle' }, props.subtitle),
        ],
    ),
}));

vi.mock('@/components/ui/forms/SearchHeader', () => ({
    SearchHeader: () => null,
}));

vi.mock('@/components/ui/forms/dropdown/DropdownMenu', () => ({
    DropdownMenu: (props: Record<string, unknown>) => React.createElement('DropdownMenu', props),
}));

vi.mock('@/constants/Typography', () => ({
    Typography: { default: () => ({}) },
}));

vi.mock('@/utils/sessions/sessionUtils', () => ({
    formatPathRelativeToHome: (_home: string, path: string) => path,
}));

vi.mock('@/utils/path/pathUtils', async (importOriginal) => {
    return importOriginal<typeof import('@/utils/path/pathUtils')>();
});

vi.mock('@/components/ui/text/Text', () => ({
    Text: ({ children, ...props }: any) => React.createElement('Text', props, children),
    TextInput: React.forwardRef((props: any, _ref) => React.createElement('TextInput', props)),
}));

const openMachinePathBrowserModalMock = vi.fn();
const deferOnWebMock = vi.fn((callback: () => void) => callback());

vi.mock('@/components/ui/pathBrowser/openMachinePathBrowserModal', () => ({
    openMachinePathBrowserModal: (input: unknown) => openMachinePathBrowserModalMock(input),
}));

vi.mock('@/utils/platform/deferOnWeb', () => ({
    deferOnWeb: (callback: () => void) => deferOnWebMock(callback),
}));

describe('PathSelector', () => {
    it('can render the editable path entry inside an item group for wizard layouts', async () => {
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(
            <PathSelector
                machineHomeDir="/Users/leeroy"
                selectedPath="/Users/leeroy/project"
                onChangeSelectedPath={() => {}}
                recentPaths={[]}
                usePickerSearch={false}
                favoriteDirectories={[]}
                onChangeFavoriteDirectories={() => {}}
                pathEntryPresentation="itemGroup"
            />,
        );

        const groups = screen.findAllByType('ItemGroup' as any);
        expect(groups.some((group) => group.findAllByType('TextInput' as any).length === 1)).toBe(true);
    });

    it('keeps the path entry visible while saved paths move into a dropdown', async () => {
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(
            <PathSelector
                machineHomeDir="/Users/leeroy"
                selectedPath="/Users/leeroy/project"
                onChangeSelectedPath={() => {}}
                recentPaths={['/Users/leeroy/recent']}
                usePickerSearch={true}
                favoriteDirectories={['~/favorite']}
                onChangeFavoriteDirectories={() => {}}
                pathEntryPresentation="itemGroup"
                savedPathsPresentation="dropdown"
                favoriteGroupPlacement="beforeRecent"
            />,
        );

        expect(screen.findAllByType('TextInput' as any)).toHaveLength(1);
        expect(screen.findAllByType('Item' as any).filter((item) => item.props.title === '/Users/leeroy/recent')).toHaveLength(0);

        const dropdown = screen.root.findByType('DropdownMenu' as any);
        expect(dropdown.props.itemTrigger.title).toBe('newSession.selectPathTitle');
        expect(dropdown.props.itemTrigger.subtitle).toBe('/Users/leeroy/project');
        expect(dropdown.props.itemTrigger.showSelectedDetail).toBe(false);
        expect(dropdown.props.itemTrigger.showSelectedSubtitle).toBe(false);
        expect(dropdown.props.items.map((item: any) => [item.id, item.category])).toEqual([
            ['/Users/leeroy/favorite', 'newSession.pathPicker.favoritesTitle'],
            ['/Users/leeroy/recent', 'newSession.pathPicker.recentTitle'],
        ]);
        expect(dropdown.props.search).toBe(true);
    });

    it('can render favorite path groups before recent path groups', async () => {
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(
            <PathSelector
                machineHomeDir="/Users/leeroy"
                selectedPath="/Users/leeroy/project"
                onChangeSelectedPath={() => {}}
                recentPaths={['/Users/leeroy/recent']}
                usePickerSearch={false}
                searchVariant="group"
                favoriteDirectories={['~/favorite']}
                onChangeFavoriteDirectories={() => {}}
                favoriteGroupPlacement="beforeRecent"
            />,
        );

        expect(screen.findAllByType('ItemGroup' as any).map((group) => group.props.title)).toEqual([
            'newSession.pathPicker.favoritesTitle',
            'newSession.pathPicker.recentTitle',
            'newSession.pathPicker.suggestedTitle',
        ]);
    });

    it('does not suggest a hardcoded /projects path (case-sensitive filesystems)', async () => {
        const { PathSelector } = await import('./PathSelector');

        const tree = (await renderScreen(
            <PathSelector
                machineHomeDir="/home/luis"
                selectedPath=""
                onChangeSelectedPath={() => {}}
                recentPaths={[]}
                usePickerSearch={false}
                favoriteDirectories={[]}
                onChangeFavoriteDirectories={() => {}}
            />,
        )).tree;

        expect(findTestInstanceByTypeWithProps(tree, 'Item', { title: '/home/luis/projects' })).toBeUndefined();
    });

    it('builds Windows suggested paths without duplicating separators when homeDir has a trailing backslash', async () => {
        const { PathSelector } = await import('./PathSelector');

        const tree = (await renderScreen(
            <PathSelector
                machineHomeDir="C:\\Users\\alice\\"
                selectedPath=""
                onChangeSelectedPath={() => {}}
                recentPaths={[]}
                usePickerSearch={false}
                favoriteDirectories={[]}
                onChangeFavoriteDirectories={() => {}}
            />,
        )).tree;

        const itemTitles = tree.root.findAllByType('Item').map((item) => item.props.title).filter((title): title is string => typeof title === 'string');

        expect(itemTitles).toHaveLength(3);
        expect(itemTitles.some((title) => title.includes('\\/'))).toBe(false);
    });

    it('submits the selected row immediately when confirm behavior is enabled', async () => {
        const onSubmitSelectedPath = vi.fn();
        const { PathSelector } = await import('./PathSelector');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={() => {}}
                    onSubmitSelectedPath={onSubmitSelectedPath}
                    submitBehavior="confirm"
                    recentPaths={['/Users/leeroy/Development/happier/dev']}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                />)).tree;

        const selectedRow = findTestInstanceByTypeWithProps(tree, 'Item', { title: '/Users/leeroy/Development/happier/dev' });
        expect(selectedRow).toBeTruthy();
        expect((selectedRow!.props.leftElement as any)?.type).toEqual(expect.any(Function));
        expect((selectedRow!.props.rightElement as any)?.props?.children?.[0]?.props?.style?.width).toBe(28);

        await act(async () => {
            await pressTestInstanceAsync(selectedRow);
        });

        expect(onSubmitSelectedPath).toHaveBeenCalledWith('/Users/leeroy/Development/happier/dev');
    });

    it('shows the browse button and opens the shared path browser modal when machine browsing is enabled', async () => {
        openMachinePathBrowserModalMock.mockReset();
        openMachinePathBrowserModalMock.mockResolvedValueOnce('/Users/leeroy/from-browser');
        const { PathSelector } = await import('./PathSelector');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={() => {}}
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                    machineBrowse={{
                        enabled: true,
                        machineId: 'machine-1',
                        serverId: 'server-1',
                    }}
                />)).tree;

        await act(async () => {
            await tree.pressByTestIdAsync('path-browser-trigger');
        });

        expect(openMachinePathBrowserModalMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            serverId: 'server-1',
            initialPath: '/Users/leeroy/project',
        }));
    });

    it('awaits the pre-browse callback before opening the shared path browser modal', async () => {
        const callOrder: string[] = [];
        openMachinePathBrowserModalMock.mockReset();
        deferOnWebMock.mockClear();
        openMachinePathBrowserModalMock.mockImplementationOnce(async () => {
            callOrder.push('openMachinePathBrowserModal');
            return '/Users/leeroy/from-browser';
        });
        const onBeforeBrowseMachinePath = vi.fn(async () => {
            callOrder.push('onBeforeBrowseMachinePath:start');
            await Promise.resolve();
            callOrder.push('onBeforeBrowseMachinePath:end');
        });
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={() => {}}
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                    onBeforeBrowseMachinePath={onBeforeBrowseMachinePath}
                    machineBrowse={{
                        enabled: true,
                        machineId: 'machine-1',
                        serverId: 'server-1',
                    }}
                />);

        await act(async () => {
            await screen.pressByTestIdAsync('path-browser-trigger');
        });

        expect(onBeforeBrowseMachinePath).toHaveBeenCalledTimes(1);
        expect(callOrder).toEqual([
            'onBeforeBrowseMachinePath:start',
            'onBeforeBrowseMachinePath:end',
            'openMachinePathBrowserModal',
        ]);
        expect(deferOnWebMock).toHaveBeenCalledTimes(2);
    });

    it('uses the current typed draft as the browse modal starting path', async () => {
        openMachinePathBrowserModalMock.mockReset();
        openMachinePathBrowserModalMock.mockResolvedValueOnce('/Users/leeroy/from-browser');
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={vi.fn()}
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                    machineBrowse={{
                        enabled: true,
                        machineId: 'machine-1',
                    }}
                />);

        const input = findTestInstanceByTypeWithProps(screen.tree, 'TextInput', { testID: 'path-selector-input' });
        if (!input) {
            throw new Error('Expected path selector input to render');
        }

        act(() => {
            input.props.onChangeText('/Users/leeroy/Documents/Development/happier/dev');
        });

        await act(async () => {
            await screen.pressByTestIdAsync('path-browser-trigger');
        });

        expect(openMachinePathBrowserModalMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            initialPath: '/Users/leeroy/Documents/Development/happier/dev',
        }));
    });

    it('falls back to the machine home directory when the draft path is empty', async () => {
        openMachinePathBrowserModalMock.mockReset();
        openMachinePathBrowserModalMock.mockResolvedValueOnce('/Users/leeroy/from-browser');
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath=""
                    onChangeSelectedPath={vi.fn()}
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                    machineBrowse={{
                        enabled: true,
                        machineId: 'machine-1',
                    }}
                />);

        await act(async () => {
            await screen.pressByTestIdAsync('path-browser-trigger');
        });

        expect(openMachinePathBrowserModalMock).toHaveBeenCalledWith(expect.objectContaining({
            machineId: 'machine-1',
            initialPath: '/Users/leeroy',
        }));
    });

    it('keeps typed path edits local until submit so the parent screen does not rerender on every keystroke', async () => {
        const onChangeSelectedPath = vi.fn();
        const onSubmitSelectedPath = vi.fn();
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={onChangeSelectedPath}
                    onSubmitSelectedPath={onSubmitSelectedPath}
                    submitBehavior="confirm"
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                    machineBrowse={{
                        enabled: true,
                        machineId: 'machine-1',
                    }}
                />);

        const input = findTestInstanceByTypeWithProps(screen.tree, 'TextInput', { testID: 'path-selector-input' });
        if (!input) {
            throw new Error('Expected path selector input to render');
        }

        act(() => {
            input.props.onChangeText('/Users/leeroy/Documents/Development/happier/dev');
        });

        expect(onChangeSelectedPath).not.toHaveBeenCalled();
        expect(findTestInstanceByTypeWithProps(screen.tree, 'TextInput', { testID: 'path-selector-input' })?.props.value)
            .toBe('/Users/leeroy/Documents/Development/happier/dev');

        act(() => {
            input.props.onSubmitEditing?.();
        });

        expect(onChangeSelectedPath).toHaveBeenCalledWith('/Users/leeroy/Documents/Development/happier/dev');
        expect(onSubmitSelectedPath).toHaveBeenCalledWith('/Users/leeroy/Documents/Development/happier/dev');
    });

    it('commits the typed path on blur without committing every keystroke', async () => {
        const onChangeSelectedPath = vi.fn();
        const { PathSelector } = await import('./PathSelector');

        const screen = await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={onChangeSelectedPath}
                    commitDraftOnBlur={true}
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                />);

        const input = findTestInstanceByTypeWithProps(screen.tree, 'TextInput', { testID: 'path-selector-input' });
        if (!input) {
            throw new Error('Expected path selector input to render');
        }

        act(() => {
            input.props.onChangeText('/Users/leeroy/Documents/Development/happier/dev');
        });

        expect(onChangeSelectedPath).not.toHaveBeenCalled();

        act(() => {
            input.props.onBlur?.();
        });

        expect(onChangeSelectedPath).toHaveBeenCalledWith('/Users/leeroy/Documents/Development/happier/dev');
    });

    it('does not render the browse button when machine browsing is not enabled', async () => {
        const { PathSelector } = await import('./PathSelector');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={() => {}}
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                />)).tree;

        expect(tree.findAllByTestId('path-browser-trigger')).toHaveLength(0);
    });

    it('submits the browsed machine path immediately when confirm behavior is enabled', async () => {
        openMachinePathBrowserModalMock.mockReset();
        openMachinePathBrowserModalMock.mockResolvedValueOnce('/Users/leeroy/from-browser');
        const onChangeSelectedPath = vi.fn();
        const onSubmitSelectedPath = vi.fn();
        const { PathSelector } = await import('./PathSelector');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={onChangeSelectedPath}
                    onSubmitSelectedPath={onSubmitSelectedPath}
                    submitBehavior="confirm"
                    recentPaths={[]}
                    usePickerSearch={false}
                    favoriteDirectories={[]}
                    onChangeFavoriteDirectories={() => {}}
                    machineBrowse={{
                        enabled: true,
                        machineId: 'machine-1',
                    }}
                />)).tree;

        await act(async () => {
            await tree.pressByTestIdAsync('path-browser-trigger');
        });

        expect(onChangeSelectedPath).toHaveBeenCalledWith('/Users/leeroy/from-browser');
        expect(onSubmitSelectedPath).toHaveBeenCalledWith('/Users/leeroy/from-browser');
    });

    it('does not emit raw text nodes under non-Text parents when icons render as text on web', async () => {
        const { PathSelector } = await import('./PathSelector');

        let tree!: renderer.ReactTestRenderer;
        tree = (await renderScreen(<PathSelector
                    machineHomeDir="/Users/leeroy"
                    selectedPath="/Users/leeroy/project"
                    onChangeSelectedPath={() => {}}
                    recentPaths={['/Users/leeroy/project']}
                    usePickerSearch={false}
                    favoriteDirectories={['/Users/leeroy/project']}
                    onChangeFavoriteDirectories={() => {}}
                />)).tree;

        const badNodes: Array<{ parent: string | null; value: string }> = [];
        const walk = (node: any, parentType: string | null) => {
            if (node == null) return;
            if (typeof node === 'string' || typeof node === 'number') {
                const value = String(node);
                if (parentType !== 'Text' && value.trim().length > 0) badNodes.push({ parent: parentType, value });
                return;
            }
            if (Array.isArray(node)) {
                for (const item of node) walk(item, parentType);
                return;
            }
            const nextParent = typeof node.type === 'string' ? node.type : parentType;
            const children = Array.isArray(node.children) ? node.children : [];
            for (const child of children) walk(child, nextParent);
        };

        walk(tree.toJSON(), null);
        expect(badNodes).toEqual([]);

        act(() => {
            tree.unmount();
        });
    });
});
