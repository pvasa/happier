import React from 'react';
import { Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { GestureDetector } from 'react-native-gesture-handler';

import type {
    TreeDropResult,
    TreeInstructionVisual,
} from '@/components/ui/treeDragDrop';
import {
    useSessionInlineDrag,
    type SessionInlineDragVisualSharedValues,
    type UseSessionInlineDragDropResultEvent,
    type UseSessionInlineDragResolveDropResultEvent,
} from './useSessionInlineDrag';
import {
    type RegisterSessionListTreeRowBounds,
    type UnregisterSessionListTreeRowBounds,
} from './SessionListHeaderFrame';
import { SessionListDropIndicator } from './SessionListDropIndicator';

export const DraggableSessionFolderHeaderFrame = React.memo(function DraggableSessionFolderHeaderFrame(props: Readonly<{
    children: React.ReactNode;
    folderId: string;
    groupKey: string;
    treeRowId: string;
    dataIndex: number;
    dropVisual: SessionInlineDragVisualSharedValues;
    activeDropVisual: TreeInstructionVisual;
    onDragStart: (sessionKey: string) => void;
    resolveDropResult: (event: UseSessionInlineDragResolveDropResultEvent) => TreeDropResult;
    onDropResult: (event: UseSessionInlineDragDropResultEvent) => void;
    onDragUpdate?: (event: UseSessionInlineDragDropResultEvent) => void;
    onRegisterTreeRowBounds: RegisterSessionListTreeRowBounds;
    onUnregisterTreeRowBounds: UnregisterSessionListTreeRowBounds;
}>) {
    const dragKey = `folder:${props.folderId}`;
    const wrapperRef = React.useRef<View>(null);
    React.useEffect(() => {
        return () => {
            props.onUnregisterTreeRowBounds(props.treeRowId);
        };
    }, [props.onUnregisterTreeRowBounds, props.treeRowId]);
    const { gesture, animatedStyle } = useSessionInlineDrag({
        sessionKey: dragKey,
        groupKey: props.groupKey,
        onDragStart: props.onDragStart,
        onDropResult: props.onDropResult,
        onDragUpdate: props.onDragUpdate,
        resolveDropResult: props.resolveDropResult,
        dataIndex: props.dataIndex,
        dropVisual: props.dropVisual,
        activateAfterLongPressMs: Platform.OS === 'web' ? undefined : 350,
    });

    const content = (
        <Animated.View
            ref={wrapperRef}
            collapsable={false}
            style={animatedStyle}
            onLayout={() => props.onRegisterTreeRowBounds(props.treeRowId, wrapperRef.current)}
        >
            <SessionListDropIndicator
                targetId={props.treeRowId}
                visual={props.activeDropVisual}
            />
            {props.children}
        </Animated.View>
    );

    return gesture ? (
        <GestureDetector gesture={gesture}>{content}</GestureDetector>
    ) : content;
});
