import * as React from 'react';

import type { AttachmentFilePickerHandle, AttachmentFilePickerProps, PickedAttachment } from './AttachmentFilePicker.types';
import { nativePickFiles } from '@/utils/files/nativePickFiles';
import { nativePickImages } from '@/utils/files/nativePickImages';
import { showAttachmentPickerUnavailableAlert } from './showAttachmentPickerUnavailableAlert';

export const AttachmentFilePicker = React.forwardRef<AttachmentFilePickerHandle, AttachmentFilePickerProps>(
    function AttachmentFilePicker(props, ref) {
        const onPickedRef = React.useRef(props.onAttachmentsPicked);
        onPickedRef.current = props.onAttachmentsPicked;

        const openFiles = React.useCallback(() => {
            void (async () => {
                try {
                    const picked = await nativePickFiles({ multiple: props.multiple });
                    if (picked.length > 0) onPickedRef.current(picked as PickedAttachment[]);
                } catch (error) {
                    showAttachmentPickerUnavailableAlert(error);
                }
            })();
        }, [props.multiple]);

        const openImages = React.useCallback(() => {
            void (async () => {
                try {
                    const picked = await nativePickImages({ multiple: props.multiple });
                    if (picked.length > 0) onPickedRef.current(picked as PickedAttachment[]);
                } catch (error) {
                    showAttachmentPickerUnavailableAlert(error);
                }
            })();
        }, [props.multiple]);

        const open = openFiles;

        React.useImperativeHandle(ref, () => ({ open, openFiles, openImages }), [open, openFiles, openImages]);

        return null;
    }
);
