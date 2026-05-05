import {
    StyleSheet,
    type ViewStyle,
} from 'react-native';

import {
    DESKTOP_PET_OVERLAY_TRAY_MAX_HEIGHT,
    DESKTOP_PET_OVERLAY_TRAY_WIDTH,
} from '@/components/pets/desktop/desktopPetOverlayGeometry';

type WebTrayFadeStyle = ViewStyle & Readonly<{
    maskImage: string;
    WebkitMaskImage: string;
}>;

export const trayFadeStyle: WebTrayFadeStyle = {
    maskImage: 'linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
    WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 12px, black calc(100% - 12px), transparent 100%)',
};

export const styles = StyleSheet.create({
    root: {
        width: DESKTOP_PET_OVERLAY_TRAY_WIDTH,
        maxWidth: DESKTOP_PET_OVERLAY_TRAY_WIDTH,
        maxHeight: DESKTOP_PET_OVERLAY_TRAY_MAX_HEIGHT,
        gap: 4,
        alignItems: 'flex-end',
        overflow: 'hidden',
    } satisfies ViewStyle,
    rootOpen: {
        opacity: 1,
        transform: [
            { translateY: 0 },
            { scale: 1 },
        ],
    },
    rootCollapsed: {
        opacity: 0,
        transform: [
            { translateY: 8 },
            { scale: 0.96 },
        ],
    },
    item: {
        width: DESKTOP_PET_OVERLAY_TRAY_WIDTH,
        height: 56,
        minHeight: 56,
        borderRadius: 16,
        paddingHorizontal: 14,
        paddingVertical: 8,
        gap: 0,
        position: 'relative',
        overflow: 'hidden',
    } satisfies ViewStyle,
    itemReplyOpen: {
        height: 108,
        minHeight: 108,
    } satisfies ViewStyle,
    rowReverse: {
        flexDirection: 'row-reverse',
    },
    statusBadge: {
        position: 'absolute',
        top: 8,
        right: 10,
        width: 14,
        height: 14,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 0,
        borderRadius: 0,
    },
    iconButton: {
        position: 'absolute',
        top: 4,
        left: 4,
        width: 24,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2,
    },
    iconButtonRtl: {
        right: 4,
        left: undefined,
    },
    hiddenAction: {
        opacity: 0,
    },
    visibleAction: {
        opacity: 1,
    },
    copy: {
        gap: 1,
        minWidth: 0,
        paddingRight: 66,
    },
    title: {
        fontSize: 14,
        lineHeight: 17,
        fontWeight: '600',
    },
    subtitle: {
        fontSize: 12,
        lineHeight: 15,
    },
    replyAction: {
        position: 'absolute',
        right: 8,
        bottom: 6,
        minWidth: 50,
        height: 24,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 10,
        zIndex: 2,
    },
    replyActionText: {
        fontSize: 12,
        fontWeight: '600',
    },
    replyRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        overflow: 'hidden',
    },
    replyRowCollapsed: {
        opacity: 0,
        maxHeight: 0,
    },
    replyRowExpanded: {
        opacity: 1,
        maxHeight: 40,
    },
    replyInput: {
        flex: 1,
        minHeight: 32,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 8,
        fontSize: 13,
    },
    sendButton: {
        width: 32,
        height: 32,
        borderRadius: 6,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
});
