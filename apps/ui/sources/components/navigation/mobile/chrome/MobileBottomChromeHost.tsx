import * as React from 'react';
import { Animated, Platform } from 'react-native';
import { router as expoRouter, useGlobalSearchParams, useNavigation, usePathname, useRouter } from 'expo-router';

import { useAuth } from '@/auth/context/AuthContext';
import { motionTokens } from '@/components/ui/motion/motionTokens';
import { useReducedMotionPreference } from '@/hooks/ui/useReducedMotionPreference';
import { useTabState } from '@/hooks/ui/useTabState';
import { useSessionTerminalAvailability } from '@/components/sessions/terminal/useSessionTerminalAvailability';
import { useLocalSetting, useLocalSettingMutable, useSetting } from '@/sync/domains/state/storage';
import { TabBar, type TabType } from '@/components/ui/navigation/TabBar';
import { prepareMobileSurfaceTransition } from '@/components/navigation/mobile/transition/mobileSurfaceTransitionIntent';
import { isMobileWorkspaceCockpitEnabled } from '@/components/workspaceCockpit/mobileWorkspaceExperience';
import {
    collapseSessionDetailsRouteBeforeSurfaceSwitch,
    normalizeSessionDetailsSourceSurface,
    resolveSessionCockpitSurfaceSwitchPlan,
} from '@/components/workspaceCockpit/session/sessionCockpitNavigation';
import {
    resolveSessionRoutePathForSurface,
    type SessionMobileSurface,
} from '@/components/workspaceCockpit/session/sessionCockpitState';
import { fireAndForget } from '@/utils/system/fireAndForget';
import { SessionCockpitTabBar } from './bars/SessionCockpitTabBar';
import { resolveMobileBottomChromeModel } from './resolveMobileBottomChromeModel';

type TabRouteHref = Parameters<typeof expoRouter.replace>[0];

const TAB_ROUTES = {
    inbox: '/inbox',
    sessions: '/',
    friends: '/friends',
    settings: '/settings',
} satisfies Record<TabType, TabRouteHref>;

type PendingSessionSurfaceSwitch = Readonly<{
    sessionId: string;
    targetSurface: SessionMobileSurface;
    sourceDetailsPathname: string;
    sourceSurfacePathname: string;
    targetHref: string;
}>;

export const SESSION_DETAILS_COLLAPSE_FALLBACK_MS = 100;

export function resolveMobileBottomChromeActiveTab(pathname: string): TabType | null {
    if (pathname === '/') return 'sessions';
    if (pathname === '/settings' || pathname.startsWith('/settings/')) return 'settings';
    if (pathname === '/inbox' || pathname.startsWith('/inbox/')) return 'inbox';
    if (pathname === '/friends' || pathname.startsWith('/friends/')) return 'friends';
    return null;
}

function normalizeRouteParam(value: unknown): string | null {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (Array.isArray(value)) {
        return normalizeRouteParam(value[0]);
    }
    return null;
}

function normalizePathname(pathname: string | null | undefined): string {
    return typeof pathname === 'string'
        ? (pathname.split(/[?#]/, 1)[0] ?? '').trim()
        : '';
}

export const MobileBottomChromeHost = React.memo(function MobileBottomChromeHost() {
    const pathname = usePathname();
    const router = useRouter();
    const navigation = useNavigation();
    const params = useGlobalSearchParams<{ mobileSurface?: string | string[]; serverId?: string | string[]; sourceSurface?: string | string[] }>();
    const auth = useAuth();
    const serverId = normalizeRouteParam(params.serverId);
    const routeSessionId = React.useMemo(() => {
        const match = /^\/session\/([^/?#]+?)(?:\/|$)/.exec(normalizePathname(pathname));
        return match?.[1] ? decodeURIComponent(match[1]) : null;
    }, [pathname]);
    const terminalAvailability = useSessionTerminalAvailability({
        sessionId: routeSessionId ?? undefined,
        serverId,
    });
    const deviceType = terminalAvailability.deviceType;
    const reduceMotion = useReducedMotionPreference();
    const { setActiveTab } = useTabState();
    const mobileWorkspaceExperience = useSetting('mobileWorkspaceExperienceV1');
    const sessionLastMobileSurfaceBySessionId = useLocalSetting('sessionLastMobileSurfaceBySessionId');
    const [, setSessionLastMobileSurfaceBySessionId] = useLocalSettingMutable('sessionLastMobileSurfaceBySessionId');
    const sessionTerminalTabAvailable = terminalAvailability.sidebarTabAvailable;
    const explicitMobileSurfaceHint = normalizeRouteParam(params.mobileSurface);
    const currentDetailsSourceSurface = normalizeRouteParam(params.sourceSurface);
    const [pendingSessionSurfaceSwitch, setPendingSessionSurfaceSwitch] = React.useState<PendingSessionSurfaceSwitch | null>(null);
    const pendingSessionSurfaceSwitchRef = React.useRef<PendingSessionSurfaceSwitch | null>(null);
    const sessionLastMobileSurfaceBySessionIdRef = React.useRef(sessionLastMobileSurfaceBySessionId);
    const latestPathnameRef = React.useRef(pathname);
    const detailsCollapseFallbackTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const model = resolveMobileBottomChromeModel({
        isAuthenticated: auth.isAuthenticated,
        pathname,
        mobileWorkspaceExperience,
        sessionLastMobileSurfaceBySessionId,
        sessionTerminalTabAvailable,
        explicitMobileSurfaceHint,
    });
    const currentMainAppTab = model.kind === 'mainAppTabs' ? model.activeTab : null;

    const handleTabPress = React.useCallback((tab: TabType) => {
        const targetRoute = TAB_ROUTES[tab];
        if (currentMainAppTab === tab) {
            return;
        }

        prepareMobileSurfaceTransition({
            currentPathname: pathname,
            targetHref: targetRoute,
            operation: 'replace',
        });
        router.replace(targetRoute);
        if (tab !== 'settings') {
            fireAndForget(setActiveTab(tab));
        }
    }, [currentMainAppTab, pathname, router, setActiveTab]);

    React.useEffect(() => {
        latestPathnameRef.current = normalizePathname(pathname);
    }, [pathname]);

    React.useEffect(() => {
        sessionLastMobileSurfaceBySessionIdRef.current = sessionLastMobileSurfaceBySessionId;
    }, [sessionLastMobileSurfaceBySessionId]);

    const clearDetailsCollapseFallbackTimeout = React.useCallback(() => {
        if (!detailsCollapseFallbackTimeoutRef.current) {
            return;
        }
        clearTimeout(detailsCollapseFallbackTimeoutRef.current);
        detailsCollapseFallbackTimeoutRef.current = null;
    }, []);

    const setPendingSessionSurfaceSwitchState = React.useCallback((pending: PendingSessionSurfaceSwitch | null) => {
        pendingSessionSurfaceSwitchRef.current = pending;
        setPendingSessionSurfaceSwitch(pending);
    }, []);

    const persistSessionSurface = React.useCallback((sessionId: string, surface: PendingSessionSurfaceSwitch['targetSurface']) => {
        const nextSessionLastMobileSurfaceBySessionId = {
            ...(sessionLastMobileSurfaceBySessionIdRef.current ?? {}),
            [sessionId]: surface,
        };
        sessionLastMobileSurfaceBySessionIdRef.current = nextSessionLastMobileSurfaceBySessionId;
        setSessionLastMobileSurfaceBySessionId(nextSessionLastMobileSurfaceBySessionId);
    }, [setSessionLastMobileSurfaceBySessionId]);

    const completePendingSessionSurfaceSwitch = React.useCallback((pending: PendingSessionSurfaceSwitch) => {
        clearDetailsCollapseFallbackTimeout();
        setPendingSessionSurfaceSwitchState(null);
        router.replace(pending.targetHref);
        persistSessionSurface(pending.sessionId, pending.targetSurface);
    }, [
        clearDetailsCollapseFallbackTimeout,
        persistSessionSurface,
        router,
        setPendingSessionSurfaceSwitchState,
    ]);

    const scheduleDetailsCollapseFallback = React.useCallback((pending: PendingSessionSurfaceSwitch) => {
        clearDetailsCollapseFallbackTimeout();
        detailsCollapseFallbackTimeoutRef.current = setTimeout(() => {
            const latestPending = pendingSessionSurfaceSwitchRef.current;
            if (
                !latestPending
                || latestPending.sessionId !== pending.sessionId
                || latestPending.targetHref !== pending.targetHref
                || latestPending.targetSurface !== pending.targetSurface
            ) {
                return;
            }

            const currentPathname = typeof latestPathnameRef.current === 'string'
                ? latestPathnameRef.current.trim()
                : '';
            if (currentPathname && currentPathname !== latestPending.sourceDetailsPathname) {
                return;
            }

            completePendingSessionSurfaceSwitch(latestPending);
        }, SESSION_DETAILS_COLLAPSE_FALLBACK_MS);
    }, [clearDetailsCollapseFallbackTimeout, completePendingSessionSurfaceSwitch]);

    React.useEffect(() => () => {
        clearDetailsCollapseFallbackTimeout();
    }, [clearDetailsCollapseFallbackTimeout]);

    React.useEffect(() => {
        if (!pendingSessionSurfaceSwitch) {
            return;
        }

        const currentPathname = normalizePathname(pathname);
        if (!currentPathname || currentPathname === pendingSessionSurfaceSwitch.sourceDetailsPathname) {
            return;
        }

        if (currentPathname === pendingSessionSurfaceSwitch.sourceSurfacePathname) {
            completePendingSessionSurfaceSwitch(pendingSessionSurfaceSwitch);
            return;
        }

        clearDetailsCollapseFallbackTimeout();
        setPendingSessionSurfaceSwitchState(null);
    }, [
        clearDetailsCollapseFallbackTimeout,
        completePendingSessionSurfaceSwitch,
        pathname,
        pendingSessionSurfaceSwitch,
        setPendingSessionSurfaceSwitchState,
    ]);

    const resolvedChrome = React.useMemo((): Readonly<{
        key: string;
        signature: string;
        node: React.ReactElement;
    }> | null => {
        if (model.kind === 'mainAppTabs') {
            if (deviceType !== 'phone') {
                return null;
            }
            return {
                key: 'mainAppTabs',
                signature: `mainAppTabs:${model.activeTab}`,
                node: <TabBar activeTab={model.activeTab} onTabPress={handleTabPress} />,
            };
        }

        if (
            model.kind === 'sessionCockpit'
            && isMobileWorkspaceCockpitEnabled({
                deviceType,
                mobileWorkspaceExperience,
            })
        ) {
            return {
                key: `session:${model.sessionId}`,
                signature: `session:${model.sessionId}:${model.surface}:${model.terminalTabAvailable ? 'terminal' : 'no-terminal'}:${serverId ?? ''}`,
                node: (
                    <SessionCockpitTabBar
                        sessionId={model.sessionId}
                        activeSurface={model.surface}
                        terminalTabAvailable={model.terminalTabAvailable}
                        onSurfacePress={(surface) => {
                            const switchPlan = resolveSessionCockpitSurfaceSwitchPlan({
                                sessionId: model.sessionId,
                                targetSurface: surface,
                                serverId,
                                currentPathname: pathname,
                                currentDetailsSourceSurface,
                            });
                            prepareMobileSurfaceTransition({
                                currentPathname: pathname,
                                targetHref: switchPlan.targetHref,
                                operation: 'replace',
                            });
                            if (switchPlan.kind === 'replace') {
                                clearDetailsCollapseFallbackTimeout();
                                setPendingSessionSurfaceSwitchState(null);
                                persistSessionSurface(model.sessionId, surface);
                                router.replace(switchPlan.targetHref);
                                return;
                            }

                            const normalizedSourceSurface = normalizeSessionDetailsSourceSurface(currentDetailsSourceSurface);
                            if (!normalizedSourceSurface) {
                                clearDetailsCollapseFallbackTimeout();
                                setPendingSessionSurfaceSwitchState(null);
                                persistSessionSurface(model.sessionId, surface);
                                router.replace(switchPlan.targetHref);
                                return;
                            }

                            const pendingSwitch = {
                                sessionId: model.sessionId,
                                targetSurface: surface,
                                sourceDetailsPathname: switchPlan.sourceDetailsPathname,
                                sourceSurfacePathname: normalizePathname(resolveSessionRoutePathForSurface(
                                    model.sessionId,
                                    normalizedSourceSurface,
                                    { serverId },
                                )),
                                targetHref: switchPlan.targetHref,
                            };
                            setPendingSessionSurfaceSwitchState(pendingSwitch);
                            const collapseStarted = collapseSessionDetailsRouteBeforeSurfaceSwitch({
                                router,
                                navigation,
                            });
                            if (!collapseStarted) {
                                setPendingSessionSurfaceSwitchState(null);
                                persistSessionSurface(model.sessionId, surface);
                                router.replace(switchPlan.targetHref);
                                return;
                            }
                            scheduleDetailsCollapseFallback(pendingSwitch);
                        }}
                    />
                ),
            };
        }

        return null;
    }, [
        deviceType,
        handleTabPress,
        mobileWorkspaceExperience,
        model,
        navigation,
        pathname,
        router,
        currentDetailsSourceSurface,
        serverId,
        clearDetailsCollapseFallbackTimeout,
        persistSessionSurface,
        scheduleDetailsCollapseFallback,
        setPendingSessionSurfaceSwitchState,
    ]);
    const [renderedChrome, setRenderedChrome] = React.useState(resolvedChrome);
    const renderedChromeRef = React.useRef(renderedChrome);
    const progress = React.useRef(new Animated.Value(resolvedChrome ? 1 : 0)).current;
    const activeChromeAnimationRef = React.useRef<Animated.CompositeAnimation | null>(null);

    const setRenderedChromeState = React.useCallback((nextChrome: typeof resolvedChrome) => {
        renderedChromeRef.current = nextChrome;
        setRenderedChrome(nextChrome);
    }, []);

    const stopChromeAnimation = React.useCallback(() => {
        activeChromeAnimationRef.current?.stop();
        activeChromeAnimationRef.current = null;
        (progress as Animated.Value & { stopAnimation?: () => void }).stopAnimation?.();
    }, [progress]);

    React.useLayoutEffect(() => {
        const currentRenderedChrome = renderedChromeRef.current;

        if (!resolvedChrome) {
            stopChromeAnimation();
            setRenderedChromeState(null);
            progress.setValue(0);
            return;
        }

        if (reduceMotion) {
            stopChromeAnimation();
            setRenderedChromeState(resolvedChrome);
            progress.setValue(1);
            return;
        }

        if ((currentRenderedChrome?.key ?? null) === (resolvedChrome?.key ?? null)) {
            if ((currentRenderedChrome?.signature ?? null) !== (resolvedChrome?.signature ?? null)) {
                setRenderedChromeState(resolvedChrome);
            }
            return;
        }

        const animateIn = (nextChrome: typeof resolvedChrome) => {
            stopChromeAnimation();
            setRenderedChromeState(nextChrome);
            progress.setValue(0);
            const animation = Animated.timing(progress, {
                toValue: 1,
                duration: motionTokens.durationMs.base,
                easing: motionTokens.easing.emphasized,
                useNativeDriver: Platform.OS !== 'web',
            });
            activeChromeAnimationRef.current = animation;
            animation.start(({ finished }) => {
                if (activeChromeAnimationRef.current !== animation) {
                    return;
                }
                activeChromeAnimationRef.current = null;
                if (!finished) {
                    return;
                }
                progress.setValue(1);
            });
        };

        if (!currentRenderedChrome) {
            animateIn(resolvedChrome);
            return;
        }

        animateIn(resolvedChrome);
    }, [progress, reduceMotion, resolvedChrome, setRenderedChromeState, stopChromeAnimation]);

    React.useLayoutEffect(() => () => {
        stopChromeAnimation();
    }, [stopChromeAnimation]);

    if (!resolvedChrome) {
        return null;
    }

    const chromeToRender =
        (renderedChrome?.key ?? null) === (resolvedChrome?.key ?? null)
            ? (resolvedChrome ?? renderedChrome)
            : renderedChrome;

    if (!chromeToRender) {
        return null;
    }

    const animatedStyle = {
        opacity: progress,
        transform: [
            {
                translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [10, 0],
                }),
            },
            {
                scale: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.99, 1],
                }),
            },
        ],
    } as const;

    return (
        <Animated.View style={animatedStyle}>
            {chromeToRender.node}
        </Animated.View>
    );
});
