import {
    SESSION_LIST_ROW_HEIGHT_COMPACT,
    SESSION_LIST_ROW_HEIGHT_DEFAULT,
    SESSION_LIST_ROW_HEIGHT_MINIMAL,
    SESSION_LIST_ROW_HEIGHT_MINIMAL_NATIVE_PHONE,
} from './sessionListRowHeights';

export type SessionListRowPlatform = 'ios' | 'android' | 'web' | 'windows' | 'macos';

export function shouldUseReadableNativePhoneMinimalSessionRow(params: Readonly<{
    compact: boolean;
    compactMinimal: boolean;
    isTablet: boolean;
    platform: SessionListRowPlatform | string;
}>): boolean {
    return params.compact
        && params.compactMinimal
        && !params.isTablet
        && (params.platform === 'ios' || params.platform === 'android');
}

export function resolveSessionListRowHeight(params: Readonly<{
    compact: boolean;
    compactMinimal: boolean;
    isTablet: boolean;
    platform: SessionListRowPlatform | string;
}>): number {
    if (shouldUseReadableNativePhoneMinimalSessionRow(params)) {
        return SESSION_LIST_ROW_HEIGHT_MINIMAL_NATIVE_PHONE;
    }
    if (params.compactMinimal) {
        return SESSION_LIST_ROW_HEIGHT_MINIMAL;
    }
    if (params.compact) {
        return SESSION_LIST_ROW_HEIGHT_COMPACT;
    }
    return SESSION_LIST_ROW_HEIGHT_DEFAULT;
}
