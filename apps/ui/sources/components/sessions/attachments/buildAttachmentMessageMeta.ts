import {
    buildStructuredInputMetaOverrides,
    type StructuredInputImageInput,
} from '@/components/sessions/agentInput/structuredInputMentions';

import type { UploadedAttachment } from './uploadAttachmentDraftsToSession';

function toAttachmentPayload(attachment: UploadedAttachment): Record<string, unknown> {
    return {
        name: attachment.name,
        path: attachment.path,
        mimeType: attachment.mimeType,
        sizeBytes: attachment.sizeBytes,
        sha256: attachment.sha256,
    };
}

export function buildAttachmentMessageMeta(uploaded: readonly UploadedAttachment[]): Record<string, unknown> {
    const structuredAttachments = uploaded
        .map((attachment) => attachment.structuredInput)
        .filter((input): input is StructuredInputImageInput => Boolean(input));
    return {
        happier: {
            kind: 'attachments.v1',
            payload: {
                attachments: uploaded.map(toAttachmentPayload),
            },
        },
        ...buildStructuredInputMetaOverrides({ attachments: structuredAttachments }),
    };
}
