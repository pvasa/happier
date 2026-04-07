import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-document-picker', () => ({
    getDocumentAsync: vi.fn(async () => ({ canceled: true })),
}));

describe('nativePickFiles', () => {
    it('retries when the document picker cancels immediately and then succeeds', async () => {
        const DocumentPicker = await import('expo-document-picker');
        const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });

        const nowSpy = vi.spyOn(Date, 'now');
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS = '50';
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS = '0';

        try {
            // Attempt 1: rapid cancel (0ms -> 10ms)
            // Attempt 2: normal duration (1000ms -> 1500ms)
            nowSpy
                .mockImplementationOnce(() => 0)
                .mockImplementationOnce(() => 10)
                .mockImplementationOnce(() => 1000)
                .mockImplementationOnce(() => 1500);

            (DocumentPicker.getDocumentAsync as any)
                .mockResolvedValueOnce({ canceled: true })
                .mockResolvedValueOnce({
                    canceled: false,
                    assets: [
                        {
                            uri: 'blob://fake',
                            name: 'note.txt',
                            size: file.size,
                            mimeType: 'text/plain',
                            file,
                        },
                    ],
                });

            const { nativePickFiles } = await import('./nativePickFiles');
            const picked = await nativePickFiles({ multiple: false });

            expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledTimes(2);
            expect(picked).toEqual([{ kind: 'web', file }]);
        } finally {
            nowSpy.mockRestore();
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS;
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS;
        }
    });

    it('throws when the document picker cancels immediately twice', async () => {
        const DocumentPicker = await import('expo-document-picker');
        const nowSpy = vi.spyOn(Date, 'now');
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS = '50';
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS = '0';

        try {
            nowSpy
                .mockImplementationOnce(() => 0)
                .mockImplementationOnce(() => 10)
                .mockImplementationOnce(() => 20)
                .mockImplementationOnce(() => 30);

            (DocumentPicker.getDocumentAsync as any)
                .mockResolvedValueOnce({ canceled: true })
                .mockResolvedValueOnce({ canceled: true });

            const { nativePickFiles } = await import('./nativePickFiles');
            await expect(nativePickFiles({ multiple: false })).rejects.toThrow(/picker/i);
        } finally {
            nowSpy.mockRestore();
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS;
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS;
        }
    });

    it('returns web File sources when expo-document-picker provides `asset.file`', async () => {
        const DocumentPicker = await import('expo-document-picker');
        const file = new File([new Uint8Array([1, 2, 3])], 'note.txt', { type: 'text/plain' });

        (DocumentPicker.getDocumentAsync as any).mockResolvedValueOnce({
            canceled: false,
            assets: [
                {
                    uri: 'blob://fake',
                    name: 'note.txt',
                    size: file.size,
                    mimeType: 'text/plain',
                    file,
                },
            ],
        });

        const { nativePickFiles } = await import('./nativePickFiles');
        const picked = await nativePickFiles({ multiple: false });

        expect(picked).toEqual([{ kind: 'web', file }]);
    });
});
