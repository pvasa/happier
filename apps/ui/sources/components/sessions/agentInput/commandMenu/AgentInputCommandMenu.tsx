import * as React from 'react';
import { Platform } from 'react-native';

import { CommandMenu, type CommandMenuProps } from '@/components/ui/commandMenu';
import { useAgentInputPopoverLayout } from '@/components/sessions/agentInput/selection/useAgentInputPopoverLayout';

const AGENT_INPUT_COMMAND_MENU_EDGE_PADDING = { horizontal: 16 } as const;
const AGENT_INPUT_COMMAND_MENU_CONTAINER_STYLE = { paddingHorizontal: 0 } as const;
const AGENT_INPUT_COMMAND_MENU_WEB_BACKDROP = {
    style: { backgroundColor: 'transparent' },
    blockOutsidePointerEvents: false,
} as const;
const AGENT_INPUT_COMMAND_MENU_NATIVE_BACKDROP = {
    style: { backgroundColor: 'transparent' },
    blockOutsidePointerEvents: 'above-anchor',
} as const;

export function AgentInputCommandMenu(props: CommandMenuProps) {
    const popoverLayout = useAgentInputPopoverLayout({
        open: props.open,
        maxHeightCap: props.maxHeight,
    });
    const boundaryRef = Platform.OS === 'web' && props.boundaryRef === undefined
        ? null
        : props.boundaryRef;
    const backdrop = props.backdrop ?? (
        Platform.OS === 'web'
            ? AGENT_INPUT_COMMAND_MENU_WEB_BACKDROP
            : AGENT_INPUT_COMMAND_MENU_NATIVE_BACKDROP
    );

    return (
        <CommandMenu
            {...props}
            maxHeight={popoverLayout.maxHeightCap ?? props.maxHeight}
            placement={props.placement ?? popoverLayout.placement}
            gap={props.gap ?? popoverLayout.gap}
            boundaryRef={boundaryRef}
            keyboardBottomInset={props.keyboardBottomInset ?? popoverLayout.keyboardBottomInset}
            edgePadding={props.edgePadding ?? AGENT_INPUT_COMMAND_MENU_EDGE_PADDING}
            backdrop={backdrop}
            consumeOutsidePointerDown={props.consumeOutsidePointerDown ?? false}
            containerStyle={props.containerStyle ?? AGENT_INPUT_COMMAND_MENU_CONTAINER_STYLE}
        />
    );
}
