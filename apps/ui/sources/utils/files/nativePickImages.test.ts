import { describe, expect, it, vi } from 'vitest';

vi.mock('expo-image-picker', () => ({
    launchImageLibraryAsync: vi.fn(async () => ({ canceled: true })),
    MediaTypeOptions: { Images: 'images' },
    getMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
    requestMediaLibraryPermissionsAsync: vi.fn(async () => ({ granted: true })),
}));

describe('nativePickImages', () => {
    it('retries when the image picker cancels immediately and then succeeds', async () => {
        const ImagePicker = await import('expo-image-picker');
        const file = new File([new Uint8Array([7, 8, 9])], 'photo.png', { type: 'image/png' });

        const nowSpy = vi.spyOn(Date, 'now');
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS = '50';
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS = '0';

        try {
            nowSpy
                .mockImplementationOnce(() => 0)
                .mockImplementationOnce(() => 5)
                .mockImplementationOnce(() => 1000)
                .mockImplementationOnce(() => 1300);

            (ImagePicker.launchImageLibraryAsync as any)
                .mockResolvedValueOnce({ canceled: true })
                .mockResolvedValueOnce({
                    canceled: false,
                    assets: [
                        {
                            uri: 'blob://fake',
                            fileName: 'photo.png',
                            fileSize: file.size,
                            mimeType: 'image/png',
                            file,
                        },
                    ],
                });

            const { nativePickImages } = await import('./nativePickImages');
            const picked = await nativePickImages({ multiple: false });

            expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledTimes(2);
            expect(picked).toEqual([{ kind: 'web', file }]);
        } finally {
            nowSpy.mockRestore();
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS;
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS;
        }
    });

    it('throws when the image picker cancels immediately twice', async () => {
        const ImagePicker = await import('expo-image-picker');
        const nowSpy = vi.spyOn(Date, 'now');
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS = '50';
        process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS = '0';

        try {
            nowSpy
                .mockImplementationOnce(() => 0)
                .mockImplementationOnce(() => 5)
                .mockImplementationOnce(() => 10)
                .mockImplementationOnce(() => 15);

            (ImagePicker.launchImageLibraryAsync as any)
                .mockResolvedValueOnce({ canceled: true })
                .mockResolvedValueOnce({ canceled: true });

            const { nativePickImages } = await import('./nativePickImages');
            await expect(nativePickImages({ multiple: false })).rejects.toThrow(/picker/i);
        } finally {
            nowSpy.mockRestore();
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RAPID_CANCEL_MS;
            delete process.env.EXPO_PUBLIC_HAPPIER_NATIVE_PICKER_RETRY_DELAY_MS;
        }
    });

    it('returns web File sources when expo-image-picker provides `asset.file`', async () => {
        const ImagePicker = await import('expo-image-picker');
        const file = new File([new Uint8Array([7, 8, 9])], 'photo.png', { type: 'image/png' });

        (ImagePicker.launchImageLibraryAsync as any).mockResolvedValueOnce({
            canceled: false,
            assets: [
                {
                    uri: 'blob://fake',
                    fileName: 'photo.png',
                    fileSize: file.size,
                    mimeType: 'image/png',
                    file,
                },
            ],
        });

        const { nativePickImages } = await import('./nativePickImages');
        const picked = await nativePickImages({ multiple: false });

        expect(picked).toEqual([{ kind: 'web', file }]);
    });
});
