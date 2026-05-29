import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import renderer, { act } from 'react-test-renderer';
import { renderScreen } from '@/dev/testkit';
import { installFilesContentCommonModuleMocks } from './filesContentTestHelpers';


(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

installFilesContentCommonModuleMocks({
    reactNative: async () => {
        const { createReactNativeWebMock } = await import('@/dev/testkit/mocks/reactNative');
        return createReactNativeWebMock(
            {
                Platform: {
                    OS: 'web',
                },
                TurboModuleRegistry: {
                    get: () => ({}),
                },
                FlatList: ({ data, renderItem, keyExtractor, ListHeaderComponent }: any) => {
                    const header = ListHeaderComponent
                        ? (React.isValidElement(ListHeaderComponent) ? ListHeaderComponent : React.createElement(ListHeaderComponent))
                        : null;
                    const items = (data ?? []).map((item: any, index: number) => {
                        const key = keyExtractor ? keyExtractor(item, index) : String(item?.fullPath ?? index);
                        return React.createElement(React.Fragment, { key }, renderItem({ item, index }));
                    });
                    return React.createElement('FlatList', null, header, ...items);
                },
            },
        );
    },
});

vi.mock('@expo/vector-icons', () => ({
    Octicons: 'Octicons',
    Ionicons: 'Ionicons',
}));

vi.mock('@/components/ui/text/Text', () => ({
    Text: 'Text',
    TextInput: 'TextInput',
}));

vi.mock('@/components/ui/media/FileIcon', () => ({
    FileIcon: 'FileIcon',
}));

vi.mock('@/constants/Typography', () => ({
    Typography: {
        default: () => ({}),
    },
}));

vi.mock('@/components/ui/lists/Item', () => ({
    Item: 'Item',
}));

function flattenStyle(style: unknown): Record<string, unknown> {
    if (Array.isArray(style)) {
        return Object.assign({}, ...style.map((entry) => flattenStyle(entry)));
    }
    if (style && typeof style === 'object') {
        return style as Record<string, unknown>;
    }
    return {};
}

const searchResultsTheme = {
    colors: {
        border: { default: '#ddd' },
        surface: { inset: '#eee' },
        text: { link: '#09f', primary: '#111', secondary: '#999' },
    },
} as any;

describe('SearchResultsList', () => {
    it('does not render string children under View when searchQuery is empty', async () => {
        const { SearchResultsList } = await import('./SearchResultsList');

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<SearchResultsList
                    theme={searchResultsTheme}
                    isSearching={false}
                    searchQuery=""
                    searchResults={[]}
                    onFilePress={vi.fn()}
                />)).tree;

        const rootView = tree!.findByType('View' as any);
        const children = React.Children.toArray(rootView.props.children ?? []);
        const hasPrimitiveChild = children.some((c) => typeof c === 'string' || typeof c === 'number');
        expect(hasPrimitiveChild).toBe(false);
    }, 60_000);

    it('wires onFilePressPinned to Item.onDoublePress for file results', async () => {
        const { SearchResultsList } = await import('./SearchResultsList');
        const onFilePress = vi.fn();
        const onFilePressPinned = vi.fn();

        const file = {
            fileType: 'file',
            fileName: 'AGENTS.md',
            filePath: '',
            fullPath: 'AGENTS.md',
        } as any;

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<SearchResultsList
                    theme={searchResultsTheme}
                    isSearching={false}
                    searchQuery="AG"
                    searchResults={[file]}
                    onFilePress={onFilePress}
                    onFilePressPinned={onFilePressPinned}
                />)).tree;

        const item = tree!.findByType('Item' as any);
        expect(typeof item.props.onDoublePress).toBe('function');

        act(() => {
            item.props.onDoublePress();
        });

        expect(onFilePressPinned).toHaveBeenCalledTimes(1);
        expect(onFilePressPinned).toHaveBeenCalledWith(file);
        expect(onFilePress).toHaveBeenCalledTimes(0);
    });

    it('right-aligns the directory segment against the file name (matches changed-files layout)', async () => {
        const { SearchResultsList } = await import('./SearchResultsList');

        const file = {
            fileType: 'file',
            fileName: '/a.ts',
            filePath: 'src/',
            fullPath: 'src/a.ts',
        } as any;

        let tree: renderer.ReactTestRenderer | null = null;
        tree = (await renderScreen(<SearchResultsList
                    theme={searchResultsTheme}
                    isSearching={false}
                    searchQuery="a"
                    searchResults={[file]}
                    onFilePress={vi.fn()}
                />)).tree;

        const item = tree!.findByType('Item' as any);
        expect(item.props.rightElement).toBeNull();

        const titleScreen = await renderScreen(item.props.title);
        const textNodes = titleScreen.tree.findAllByType('Text' as any);
        const pathWrapper = textNodes.find((node) => flattenStyle(node.props.style).writingDirection === 'rtl')!;
        const pathContent = textNodes.find((node) => node.props.children === 'src/')!;

        expect(pathWrapper.props.ellipsizeMode).toBeUndefined();
        expect(flattenStyle(pathWrapper.props.style).textAlign).toBe('right');
        expect(flattenStyle(pathContent.props.style)).toMatchObject({
            writingDirection: 'ltr',
            unicodeBidi: 'isolate',
        });
        expect(textNodes.some((node) => node.props.children === 'a.ts')).toBe(true);
    });
});
