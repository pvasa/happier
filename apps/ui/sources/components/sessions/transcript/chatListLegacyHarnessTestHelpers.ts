import { vi } from 'vitest';

type ChatListLegacyHarnessModuleFactory = () => unknown | Promise<unknown>;
type ChatListLegacyHarnessImportOriginal = <T = unknown>() => Promise<T>;
type ChatListLegacyHarnessStorageModuleFactory = (
    importOriginal: ChatListLegacyHarnessImportOriginal,
) => unknown | Promise<unknown>;

type InstallLegacyChatListHarnessCommonModuleMocksOptions = Readonly<{
    flashList?: ChatListLegacyHarnessModuleFactory;
    reactNative?: ChatListLegacyHarnessModuleFactory;
    storage?: ChatListLegacyHarnessStorageModuleFactory;
    unistyles?: ChatListLegacyHarnessModuleFactory;
}>;

const legacyChatListHarnessModuleState = vi.hoisted(() => ({
    options: {
        flashList: undefined as ChatListLegacyHarnessModuleFactory | undefined,
        reactNative: undefined as ChatListLegacyHarnessModuleFactory | undefined,
        storage: undefined as ChatListLegacyHarnessStorageModuleFactory | undefined,
        unistyles: undefined as ChatListLegacyHarnessModuleFactory | undefined,
    },
}));

export function installLegacyChatListHarnessCommonModuleMocks(
    options: InstallLegacyChatListHarnessCommonModuleMocksOptions = {},
) {
    legacyChatListHarnessModuleState.options = {
        flashList: options.flashList,
        reactNative: options.reactNative,
        storage: options.storage,
        unistyles: options.unistyles,
    };

    vi.mock('@shopify/flash-list', async () => {
        const activeOptions = legacyChatListHarnessModuleState.options;
        if (activeOptions.flashList) {
            return await activeOptions.flashList();
        }

        return {
            FlashList: () => null,
        };
    });

    vi.mock('@/components/ui/lists/flashListCompat/FlashListCompat', async () => {
        const activeOptions = legacyChatListHarnessModuleState.options;
        if (activeOptions.flashList) {
            return await activeOptions.flashList();
        }

        const { createFlashListChatListModuleMock } = await import('@/dev/testkit/harness/chatListHarness');
        return createFlashListChatListModuleMock();
    });

    vi.mock('react-native', async () => {
        const activeOptions = legacyChatListHarnessModuleState.options;
        if (activeOptions.reactNative) {
            return await activeOptions.reactNative();
        }

        const { createLegacyChatListReactNativeMock } = await import('@/dev/testkit/harness/chatListHarness');
        return createLegacyChatListReactNativeMock();
    });

    vi.mock('@/utils/platform/responsive', () => ({
        useHeaderHeight: () => 0,
    }));

    vi.mock('react-native-unistyles', async () => {
        const activeOptions = legacyChatListHarnessModuleState.options;
        if (activeOptions.unistyles) {
            return await activeOptions.unistyles();
        }

        const { createUnistylesMock } = await import('@/dev/testkit/mocks/unistyles');
        return createUnistylesMock();
    });

    vi.mock('react-native-safe-area-context', () => ({
        useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    }));

    vi.mock('@/sync/domains/state/storage', async (importOriginal) => {
        const activeOptions = legacyChatListHarnessModuleState.options;
        if (activeOptions.storage) {
            return await activeOptions.storage(importOriginal);
        }

        const { createLegacyChatListStorageMock } = await import('@/dev/testkit/harness/chatListHarness');
        return createLegacyChatListStorageMock(importOriginal);
    });
}
