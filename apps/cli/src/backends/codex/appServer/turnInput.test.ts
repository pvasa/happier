import { describe, expect, it } from 'vitest';

import { buildCodexAppServerTurnInput } from './turnInput';

describe('turnInput', () => {
    it('builds text, vendor plugin mentions, skills, and uploaded images through one structured path', () => {
        const imagePath = '.happier/uploads/messages/m1/image.png';
        expect(buildCodexAppServerTurnInput({
            text: 'Use @gmail and $review',
            trustedLocalImagePaths: new Set([imagePath]),
            metadata: {
                happier: {
                    kind: 'attachments.v1',
                    payload: {
                        attachments: [
                            {
                                path: imagePath,
                                mimeType: 'image/png',
                            },
                        ],
                    },
                },
                happierStructuredInputV1: {
                    vendorPluginMentions: [
                        {
                            vendorPluginRef: 'plugin://gmail@openai-curated',
                            label: 'Gmail',
                        },
                    ],
                    skillMentions: [
                        {
                            name: 'review',
                            path: '/skills/review/SKILL.md',
                            displayName: 'Review',
                        },
                    ],
                    attachments: [
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            localPath: imagePath,
                            provenance: { kind: 'sessionAttachmentUpload' },
                        },
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            url: 'https://example.test/image.png',
                        },
                    ],
                },
            },
        })).toEqual([
            { type: 'text', text: 'Use @gmail and $review' },
            { type: 'mention', name: 'Gmail', path: 'plugin://gmail@openai-curated' },
            { type: 'skill', name: 'review', path: '/skills/review/SKILL.md' },
            { type: 'localImage', path: imagePath },
            { type: 'image', url: 'https://example.test/image.png' },
        ]);
    });

    it('converts local images only when the caller supplies a trusted path allowance', () => {
        const imagePath = '.happier/uploads/messages/m1/image.png';
        const input: Parameters<typeof buildCodexAppServerTurnInput>[0] & {
            trustedLocalImagePaths: ReadonlySet<string>;
        } = {
            text: 'Use uploaded image',
            trustedLocalImagePaths: new Set([imagePath]),
            metadata: {
                happierStructuredInputV1: {
                    attachments: [
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            localPath: imagePath,
                            provenance: { kind: 'sessionAttachmentUpload' },
                        },
                    ],
                },
            },
        };

        expect(buildCodexAppServerTurnInput(input)).toEqual([
            { type: 'text', text: 'Use uploaded image' },
            { type: 'localImage', path: imagePath },
        ]);
    });

    it('converts final structured image inputs into Codex app-server image input', () => {
        const imagePath = '.happier/uploads/messages/m1/image.png';
        expect(buildCodexAppServerTurnInput({
            text: 'Use uploaded image',
            trustedLocalImagePaths: new Set([imagePath]),
            metadata: {
                happierStructuredInputV1: {
                    v: 1,
                    imageInputs: [
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            localPath: imagePath,
                            provenance: { kind: 'sessionAttachmentUpload' },
                        },
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            url: 'https://example.test/image.png',
                        },
                    ],
                },
            },
        })).toEqual([
            { type: 'text', text: 'Use uploaded image' },
            { type: 'localImage', path: imagePath },
            { type: 'image', url: 'https://example.test/image.png' },
        ]);
    });

    it('does not convert untrusted structured attachment paths into Codex localImage input', () => {
        expect(buildCodexAppServerTurnInput({
            text: 'crafted',
            metadata: {
                happierStructuredInputV1: {
                    v: 1,
                    attachments: [
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            localPath: '/etc/passwd',
                            path: '/tmp/private.png',
                        },
                    ],
                },
            },
        })).toEqual([{ type: 'text', text: 'crafted' }]);
    });

    it('does not let attachment metadata self-authorize local images', () => {
        expect(buildCodexAppServerTurnInput({
            text: 'crafted upload',
            metadata: {
                happier: {
                    kind: 'attachments.v1',
                    payload: {
                        attachments: [
                            {
                                path: '.happier/uploads/messages/m1/private.png',
                                mimeType: 'image/png',
                            },
                        ],
                    },
                },
                happierStructuredInputV1: {
                    v: 1,
                    attachments: [
                        {
                            kind: 'image',
                            mimeType: 'image/png',
                            localPath: '.happier/uploads/messages/m1/private.png',
                            provenance: { kind: 'sessionAttachmentUpload' },
                        },
                    ],
                },
            },
        })).toEqual([{ type: 'text', text: 'crafted upload' }]);
    });

    it('supports Remote Dev fallback metadata without raw skill contents', () => {
        expect(buildCodexAppServerTurnInput({
            text: 'fallback',
            metadata: {
                happierVendorPluginMentions: [
                    { vendorPluginRef: 'plugin://notion@openai-curated', label: 'Notion' },
                ],
                happierSkillMentions: [
                    { name: 'docs', path: '/skills/docs/SKILL.md', content: 'do not forward' },
                    { name: 'ignored-without-path' },
                ],
            },
        })).toEqual([
            { type: 'text', text: 'fallback' },
            { type: 'mention', name: 'Notion', path: 'plugin://notion@openai-curated' },
            { type: 'skill', name: 'docs', path: '/skills/docs/SKILL.md' },
        ]);
    });

    it('keeps non-image attachments out of structured app-server image input', () => {
        expect(buildCodexAppServerTurnInput({
            text: 'see attachment',
            metadata: {
                happierStructuredInputV1: {
                    attachments: [
                        {
                            kind: 'file',
                            mimeType: 'text/plain',
                            localPath: '/tmp/upload/note.txt',
                        },
                    ],
                },
            },
        })).toEqual([{ type: 'text', text: 'see attachment' }]);
    });
});
