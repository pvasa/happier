import * as React from 'react';
import { AgentInputSelectionPopover } from '@/components/sessions/agentInput/selection/AgentInputSelectionPopover';
import { AgentInputSelectionSimpleList } from '@/components/sessions/agentInput/selection/AgentInputSelectionSimpleList';

import { AgentInputPopoverSurface } from './AgentInputPopoverSurface';
import type { AgentInputChipPickerOption } from './AgentInputChipPickerTypes';

export type AgentInputSimpleOptionsPopoverProps = Readonly<{
    open: boolean;
    anchorRef: React.RefObject<any>;
    title?: string | null;
    options: ReadonlyArray<AgentInputChipPickerOption>;
    selectedOptionId?: string | null;
    closeOnSelect?: boolean;
    onSelect: (id: string) => void;
    onRequestClose: () => void;
    maxHeightCap?: number;
    maxWidthCap?: number;
}>;

export function AgentInputSimpleOptionsPopover(
    props: AgentInputSimpleOptionsPopoverProps,
) {
    return (
        <AgentInputSelectionPopover
            open={props.open}
            anchorRef={props.anchorRef}
            maxHeightCap={props.maxHeightCap ?? 360}
            maxWidthCap={props.maxWidthCap ?? 320}
            onRequestClose={props.onRequestClose}
        >
            {({ maxHeight }) => (
                <AgentInputPopoverSurface
                    testID="agent-input-simple-options-popover"
                    maxHeight={maxHeight}
                    scrollEnabled
                    keyboardShouldPersistTaps="always"
                >
                    <AgentInputSelectionSimpleList
                        title={props.title}
                        options={props.options}
                        selectedOptionId={props.selectedOptionId}
                        onSelect={(selectedId) => {
                            props.onSelect(selectedId);
                            if (props.closeOnSelect !== false) {
                                props.onRequestClose();
                            }
                        }}
                    />
                </AgentInputPopoverSurface>
            )}
        </AgentInputSelectionPopover>
    );
}
