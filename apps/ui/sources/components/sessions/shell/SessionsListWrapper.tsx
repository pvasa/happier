import * as React from 'react';
import { View } from 'react-native';
import { usePathname } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { StyleSheet, useUnistyles } from 'react-native-unistyles';
import { SessionGettingStartedGuidance } from '@/components/sessions/guidance/SessionGettingStartedGuidance';
import { useSessionListStorageKind } from '@/components/sessions/model/useSessionListStorageKind';
import { SessionsListStorageChrome } from '@/components/sessions/shell/SessionsListStorageChrome';
import { useVisibleSessionListPaneState } from '@/hooks/session/useVisibleSessionListViewData';
import { HiddenInactiveSessionsEmptyState } from '@/components/sessions/guidance/HiddenInactiveSessionsEmptyState';
import { SessionsListContent } from '@/components/sessions/shell/SessionsList';
import { ActivitySpinner } from '@/components/ui/feedback/ActivitySpinner';
import { readSessionIdFromPathname } from '@/components/sessions/shell/readSessionIdFromPathname';
import {
    resolvePhoneRootSessionListSurfaceDataActive,
    resolveSessionListSurfaceOwnership,
    SESSION_LIST_SURFACE_OWNER_PHONE_ROOT,
} from '@/components/sessions/shell/surface/sessionListSurfaceOwnership';

const stylesheet = StyleSheet.create((theme) => ({
    container: {
        flex: 1,
    },
    loadingContainerWrapper: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        backgroundColor: theme.colors.background.canvas,
    },
    loadingContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingBottom: 32,
    },
    emptyStateContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
        flexDirection: 'column',
        backgroundColor: theme.colors.background.canvas,
    },
    emptyStateContentContainer: {
        flex: 1,
        flexBasis: 0,
        flexGrow: 1,
    },
}));

type SessionsListWrapperProps = Readonly<{
    pathname?: string;
    surfaceRoutePathname?: string;
}>;

export const SessionsListWrapper = React.memo((props: SessionsListWrapperProps) => {
    if (props.pathname !== undefined) {
        return (
            <RouteBoundSessionsListWrapperContent
                pathname={props.pathname}
                surfaceRoutePathname={props.surfaceRoutePathname}
            />
        );
    }
    return <RouteBoundSessionsListWrapperContent />;
});

const RouteBoundSessionsListWrapperContent = React.memo((props: SessionsListWrapperProps) => {
    const routePathname = usePathname();
    return (
        <SessionsListWrapperContent
            pathname={props.pathname ?? routePathname}
            surfaceRoutePathname={props.surfaceRoutePathname ?? routePathname}
        />
    );
});

const SessionsListWrapperContent = React.memo((props: { pathname: string; surfaceRoutePathname: string }) => {
    const { theme } = useUnistyles();
    const isFocused = useIsFocused();
    const { directSessionsEnabled, storageKind, setStorageKind } = useSessionListStorageKind();
    const pathname = props.pathname;
    const surfaceRoutePathname = props.surfaceRoutePathname;
    const surfaceOwnership = React.useMemo(
        () => resolveSessionListSurfaceOwnership({
            ownerKey: SESSION_LIST_SURFACE_OWNER_PHONE_ROOT,
            interactiveOwnerKey: SESSION_LIST_SURFACE_OWNER_PHONE_ROOT,
            visible: true,
            dataActive: isFocused && resolvePhoneRootSessionListSurfaceDataActive(surfaceRoutePathname),
        }),
        [isFocused, surfaceRoutePathname],
    );
    const activeSessionId = React.useMemo(() => readSessionIdFromPathname(pathname), [pathname]);
    const { sessionListViewData, visibleSessionCount, hasHiddenInactiveSessions } = useVisibleSessionListPaneState(storageKind, {
        activeSessionId,
        sessionListSurfaceDataActive: surfaceOwnership.dataActive,
    });
    const styles = stylesheet;
    const storageChrome = (
        <SessionsListStorageChrome
            directSessionsEnabled={directSessionsEnabled}
            storageKind={storageKind}
            onSelectStorageKind={setStorageKind}
        />
    );
    const sessionListContent = React.useMemo(
        () => (
            <SessionsListContent
                storageKind={storageKind}
                data={sessionListViewData}
                pathname={pathname}
                surfaceOwnership={surfaceOwnership}
            />
        ),
        [pathname, sessionListViewData, storageKind, surfaceOwnership],
    );

    if (!surfaceOwnership.visible) {
        return <View style={styles.container} />;
    }

    let content: React.ReactNode;
    if (sessionListViewData === null) {
        content = (
            <View style={styles.container}>
                {storageChrome}
                <View style={styles.loadingContainerWrapper}>
                    <View style={styles.loadingContainer}>
                        <ActivitySpinner size="small" color={theme.colors.text.secondary} />
                    </View>
                </View>
            </View>
        );
    } else if (visibleSessionCount === 0) {
        content = (
            <View style={styles.container}>
                {storageChrome}
                <View style={styles.emptyStateContainer}>
                    <View style={styles.emptyStateContentContainer}>
                        {hasHiddenInactiveSessions ? (
                            <HiddenInactiveSessionsEmptyState />
                        ) : (
                            <SessionGettingStartedGuidance variant="phone" />
                        )}
                    </View>
                </View>
            </View>
        );
    } else {
        content = (
            <View style={styles.container}>
                {storageChrome}
                {sessionListContent}
            </View>
        );
    }

    return <>{content}</>;
});
