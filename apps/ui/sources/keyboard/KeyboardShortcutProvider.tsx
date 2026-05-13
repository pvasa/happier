import * as React from 'react';
import { Platform } from 'react-native';
import { useShallow } from 'zustand/react/shallow';

import { Modal } from '@/modal';
import { storage } from '@/sync/domains/state/storage';
import { t } from '@/text';
import {
    buildKeyboardShortcutLabels,
    buildNativeHardwareKeyboardAllowlist,
    createKeyboardShortcutDispatcher,
    normalizeKeyboardEvent,
    normalizeNativeHardwareKeyboardEvent,
    readKeyboardContextFromEventTarget,
    resolveKeyboardPlatform,
    type KeyboardShortcutHandlers,
} from './runtime';
import type { KeyboardCommandId } from './types';
import { FocusReturnProvider } from './focusReturn';
import { subscribeToNativeHardwareKeyboardEvents } from '@/components/sessions/agentInput/subscribeToIosHardwareShiftEnter';

type KeyboardShortcutRegistrationContextValue = Readonly<{
    registerHandlers: (handlers: KeyboardShortcutHandlers) => () => void;
}>;

const KeyboardShortcutRegistrationContext = React.createContext<KeyboardShortcutRegistrationContextValue | null>(null);

export function useKeyboardShortcutHandlers(handlers: KeyboardShortcutHandlers): boolean {
    const registration = React.useContext(KeyboardShortcutRegistrationContext);

    React.useEffect(() => {
        if (!registration) return;
        if (Object.keys(handlers).length === 0) return;
        return registration.registerHandlers(handlers);
    }, [handlers, registration]);

    return registration != null;
}

function buildHelpBody(shortcutLabels: Partial<Record<string, string>>): string {
    const lines = [
        shortcutLabels['commandPalette.open']
            ? `${t('commandPalette.shortcutsHelpCommandPalette')}: ${shortcutLabels['commandPalette.open']}`
            : null,
        shortcutLabels['shortcutsHelp.open']
            ? `${t('commandPalette.shortcutsHelpHelp')}: ${shortcutLabels['shortcutsHelp.open']}`
            : null,
        shortcutLabels['session.new']
            ? `${t('commandPalette.shortcutsHelpNewSession')}: ${shortcutLabels['session.new']}`
            : null,
    ].filter((line): line is string => Boolean(line));
    if (lines.length === 0) return t('commandPalette.shortcutsHelpEmpty');
    return t('commandPalette.shortcutsHelpBody', { shortcuts: lines.join('\n') });
}

export function KeyboardShortcutProvider(props: React.PropsWithChildren<Readonly<{
    handlers: KeyboardShortcutHandlers;
    enabledWhenDisabledCommandIds?: readonly KeyboardCommandId[];
}>>) {
    const nextScopedHandlerIdRef = React.useRef(1);
    const [scopedHandlerEntries, setScopedHandlerEntries] = React.useState<ReadonlyMap<number, KeyboardShortcutHandlers>>(
        () => new Map(),
    );
    const registerHandlers = React.useCallback((handlers: KeyboardShortcutHandlers) => {
        const id = nextScopedHandlerIdRef.current;
        nextScopedHandlerIdRef.current += 1;
        setScopedHandlerEntries((current) => {
            const next = new Map(current);
            next.set(id, handlers);
            return next;
        });
        return () => {
            setScopedHandlerEntries((current) => {
                if (!current.has(id)) return current;
                const next = new Map(current);
                next.delete(id);
                return next;
            });
        };
    }, []);
    const registrationContextValue = React.useMemo<KeyboardShortcutRegistrationContextValue>(
        () => ({ registerHandlers }),
        [registerHandlers],
    );
    const scopedHandlers = React.useMemo<KeyboardShortcutHandlers>(() => {
        const next: KeyboardShortcutHandlers = {};
        for (const handlers of scopedHandlerEntries.values()) {
            Object.assign(next, handlers);
        }
        return next;
    }, [scopedHandlerEntries]);
    const rootHandlers = React.useMemo<KeyboardShortcutHandlers>(() => ({
        ...props.handlers,
        ...scopedHandlers,
    }), [props.handlers, scopedHandlers]);
    const platform = React.useMemo(resolveKeyboardPlatform, []);
    const surface = Platform.OS === 'web' ? 'web' : 'native';
    const {
        keyboardShortcutsV2Enabled,
        keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutOverridesV1,
        keyboardShortcutDisabledCommandIdsV1,
    } = storage(useShallow((state) => ({
        keyboardShortcutsV2Enabled: state.settings.keyboardShortcutsV2Enabled,
        keyboardSingleKeyShortcutsEnabled: state.settings.keyboardSingleKeyShortcutsEnabled,
        keyboardShortcutOverridesV1: state.settings.keyboardShortcutOverridesV1,
        keyboardShortcutDisabledCommandIdsV1: state.settings.keyboardShortcutDisabledCommandIdsV1,
    })));
    const labelHandlers = React.useMemo<KeyboardShortcutHandlers>(() => ({
        ...rootHandlers,
        'shortcutsHelp.open': () => undefined,
    }), [rootHandlers]);

    const shortcutLabels = React.useMemo(
        () => buildKeyboardShortcutLabels(platform, surface, {
            disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
            overrides: keyboardShortcutOverridesV1 ?? {},
            singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
            handlers: labelHandlers,
            context: {
                isEditableTarget: false,
                isComposing: false,
            },
        }),
        [
            keyboardShortcutDisabledCommandIdsV1,
            keyboardShortcutOverridesV1,
            keyboardSingleKeyShortcutsEnabled,
            labelHandlers,
            platform,
            surface,
        ],
    );

    const handlers = React.useMemo<KeyboardShortcutHandlers>(() => ({
        ...rootHandlers,
        'shortcutsHelp.open': () => {
            void Modal.alertAsync(t('commandPalette.shortcutsHelpTitle'), buildHelpBody(shortcutLabels));
        },
    }), [rootHandlers, shortcutLabels]);

    React.useEffect(() => {
        if (Platform.OS !== 'web') return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented === true) return;
            const dispatcher = createKeyboardShortcutDispatcher({
                enabled: keyboardShortcutsV2Enabled === true,
                enabledWhenDisabledCommandIds: props.enabledWhenDisabledCommandIds,
                platform,
                surface,
                singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
                disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
                overrides: keyboardShortcutOverridesV1 ?? {},
                handlers,
                getContext: () => ({
                    ...readKeyboardContextFromEventTarget(event.target),
                    isComposing: event.isComposing === true,
                }),
            });
            if (!dispatcher(normalizeKeyboardEvent(event))) return;
            event.preventDefault();
            event.stopPropagation();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [
        handlers,
        keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1,
        keyboardShortcutsV2Enabled,
        keyboardSingleKeyShortcutsEnabled,
        platform,
        props.enabledWhenDisabledCommandIds,
        surface,
    ]);

    React.useEffect(() => {
        if (Platform.OS === 'web') return;
        const allowlist = buildNativeHardwareKeyboardAllowlist({
            enabled: keyboardShortcutsV2Enabled === true,
            platform,
            surface,
            singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
            disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
            overrides: keyboardShortcutOverridesV1 ?? {},
            handlers,
            getContext: () => ({
                isEditableTarget: false,
                isComposing: false,
            }),
        });
        if (!allowlist) return;

        const subscription = subscribeToNativeHardwareKeyboardEvents((nativeEvent) => {
            const event = normalizeNativeHardwareKeyboardEvent(nativeEvent);
            const dispatcher = createKeyboardShortcutDispatcher({
                enabled: keyboardShortcutsV2Enabled === true,
                enabledWhenDisabledCommandIds: props.enabledWhenDisabledCommandIds,
                platform,
                surface,
                singleKeyShortcutsEnabled: keyboardSingleKeyShortcutsEnabled === true,
                disabledCommandIds: keyboardShortcutDisabledCommandIdsV1 ?? [],
                overrides: keyboardShortcutOverridesV1 ?? {},
                handlers,
                getContext: () => ({
                    isEditableTarget: false,
                    isComposing: event.isComposing,
                }),
            });
            dispatcher(event);
        }, allowlist);

        return () => {
            subscription?.remove();
        };
    }, [
        handlers,
        keyboardShortcutDisabledCommandIdsV1,
        keyboardShortcutOverridesV1,
        keyboardShortcutsV2Enabled,
        keyboardSingleKeyShortcutsEnabled,
        platform,
        props.enabledWhenDisabledCommandIds,
        surface,
    ]);

    return (
        <KeyboardShortcutRegistrationContext.Provider value={registrationContextValue}>
            <FocusReturnProvider>{props.children}</FocusReturnProvider>
        </KeyboardShortcutRegistrationContext.Provider>
    );
}
