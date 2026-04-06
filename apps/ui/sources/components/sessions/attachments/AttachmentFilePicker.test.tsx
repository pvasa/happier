import * as React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { renderScreen } from '@/dev/testkit';

const nativePickFilesSpy = vi.hoisted(() => vi.fn<(params?: unknown) => Promise<unknown[]>>(async () => []));
const nativePickImagesSpy = vi.hoisted(() => vi.fn<(params?: unknown) => Promise<unknown[]>>(async () => []));
const alertSpy = vi.hoisted(() => vi.fn());

vi.mock('@/utils/files/nativePickFiles', () => ({
    nativePickFiles: (params?: unknown) => nativePickFilesSpy(params),
}));

vi.mock('@/utils/files/nativePickImages', () => ({
    nativePickImages: (params?: unknown) => nativePickImagesSpy(params),
}));

vi.mock('@/modal', async () => {
    const { createModalModuleMock } = await import('@/dev/testkit/mocks/modal');
    return createModalModuleMock({
        spies: {
            alert: alertSpy,
        },
    }).module;
});

vi.mock('@/text', async () => {
    const { createTextModuleMock } = await import('@/dev/testkit/mocks/text');
    return createTextModuleMock({ translate: (key) => key });
});

describe('AttachmentFilePicker', () => {
    it('exposes openFiles and openImages methods and keeps open() as a compatibility alias', async () => {
        alertSpy.mockReset();
        const { AttachmentFilePicker } = await import('./AttachmentFilePicker');
        const onAttachmentsPicked = vi.fn();
        const ref = React.createRef<any>();

        await renderScreen(
            <AttachmentFilePicker
                ref={ref}
                onAttachmentsPicked={onAttachmentsPicked}
                multiple={false}
            />,
        );

        expect(typeof ref.current?.openFiles).toBe('function');
        expect(typeof ref.current?.openImages).toBe('function');
        expect(typeof ref.current?.open).toBe('function');
    });

    it('picks files via expo-document-picker when openFiles() (or open()) is used', async () => {
        alertSpy.mockReset();
        const { AttachmentFilePicker } = await import('./AttachmentFilePicker');
        const onAttachmentsPicked = vi.fn();
        const ref = React.createRef<any>();

        nativePickFilesSpy.mockResolvedValueOnce([
            {
                kind: 'native',
                uri: 'file:///tmp/note.txt',
                name: 'note.txt',
                sizeBytes: 12,
                mimeType: 'text/plain',
            },
        ]);

        await renderScreen(
            <AttachmentFilePicker
                ref={ref}
                onAttachmentsPicked={onAttachmentsPicked}
                multiple={false}
            />,
        );
        await ref.current?.open?.();

        expect(nativePickFilesSpy).toHaveBeenCalled();
        expect(onAttachmentsPicked).toHaveBeenCalledWith([
            expect.objectContaining({
                kind: 'native',
                uri: 'file:///tmp/note.txt',
                name: 'note.txt',
                mimeType: 'text/plain',
            }),
        ]);
    });

    it('picks images via expo-image-picker when openImages() is used', async () => {
        alertSpy.mockReset();
        const { AttachmentFilePicker } = await import('./AttachmentFilePicker');
        const onAttachmentsPicked = vi.fn();
        const ref = React.createRef<any>();

        nativePickImagesSpy.mockResolvedValueOnce([
            {
                kind: 'native',
                uri: 'file:///tmp/photo.png',
                name: 'photo.png',
                sizeBytes: 123,
                mimeType: 'image/png',
            },
        ]);

        await renderScreen(
            <AttachmentFilePicker
                ref={ref}
                onAttachmentsPicked={onAttachmentsPicked}
                multiple={false}
            />,
        );
        await ref.current?.openImages?.();

        expect(nativePickImagesSpy).toHaveBeenCalled();
        expect(onAttachmentsPicked).toHaveBeenCalledWith([
            expect.objectContaining({
                kind: 'native',
                uri: 'file:///tmp/photo.png',
                name: 'photo.png',
                mimeType: 'image/png',
            }),
        ]);
    });

    it('alerts when opening the file picker throws instead of swallowing the error', async () => {
        alertSpy.mockReset();
        const { AttachmentFilePicker } = await import('./AttachmentFilePicker');
        const onAttachmentsPicked = vi.fn();
        const ref = React.createRef<any>();

        nativePickFilesSpy.mockRejectedValueOnce(new Error('Native module missing'));

        await renderScreen(
            <AttachmentFilePicker
                ref={ref}
                onAttachmentsPicked={onAttachmentsPicked}
                multiple={false}
            />,
        );

        ref.current?.openFiles?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(onAttachmentsPicked).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            'common.error',
            expect.stringContaining('attachments.alerts.pickerUnavailableBody'),
        );
        expect(alertSpy.mock.calls[0]?.[1]).toContain('Native module missing');
    });

    it('alerts when opening the image picker throws instead of swallowing the error', async () => {
        alertSpy.mockReset();
        const { AttachmentFilePicker } = await import('./AttachmentFilePicker');
        const onAttachmentsPicked = vi.fn();
        const ref = React.createRef<any>();

        nativePickImagesSpy.mockRejectedValueOnce(new Error('Image picker unavailable'));

        await renderScreen(
            <AttachmentFilePicker
                ref={ref}
                onAttachmentsPicked={onAttachmentsPicked}
                multiple={false}
            />,
        );

        ref.current?.openImages?.();
        await Promise.resolve();
        await Promise.resolve();

        expect(onAttachmentsPicked).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledWith(
            'common.error',
            expect.stringContaining('attachments.alerts.pickerUnavailableBody'),
        );
        expect(alertSpy.mock.calls[0]?.[1]).toContain('Image picker unavailable');
    });
});
