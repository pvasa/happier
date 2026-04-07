import type { NativePickedFile } from './nativePickFiles';
import { isBrowserFile, sanitizePickedName } from './pickedFileNormalization';
import { runNativePickerWithRapidCancelRetry } from './runNativePickerWithRapidCancelRetry';

function sanitizePickedNameFromAsset(asset: unknown): string {
    const anyAsset = asset as any;
    return sanitizePickedName(anyAsset?.fileName ?? anyAsset?.name ?? anyAsset?.uri, 'image');
}

export async function nativePickImages(params?: Readonly<{ multiple?: boolean }>): Promise<NativePickedFile[]> {
    const multiple = params?.multiple !== false;
    const ImagePicker: any = await import('expo-image-picker');
    const launchImageLibraryAsync: any =
        ImagePicker.launchImageLibraryAsync
        ?? ImagePicker.default?.launchImageLibraryAsync
        ?? null;
    const mediaTypeImages: any =
        ImagePicker.MediaTypeOptions?.Images
        ?? ImagePicker.default?.MediaTypeOptions?.Images
        ?? 'images';
    if (typeof launchImageLibraryAsync !== 'function') return [];

    const getPermissionsAsync: any =
        ImagePicker.getMediaLibraryPermissionsAsync
        ?? ImagePicker.default?.getMediaLibraryPermissionsAsync
        ?? null;
    const requestPermissionsAsync: any =
        ImagePicker.requestMediaLibraryPermissionsAsync
        ?? ImagePicker.default?.requestMediaLibraryPermissionsAsync
        ?? null;
    if (typeof getPermissionsAsync === 'function' && typeof requestPermissionsAsync === 'function') {
        const current = await getPermissionsAsync();
        if (!current?.granted) {
            const next = await requestPermissionsAsync();
            if (!next?.granted) {
                throw new Error('Photo library permission is required to pick images.');
            }
        }
    }

    type ExpoImagePickerResult = Readonly<{
        canceled?: boolean;
        assets?: unknown;
    }>;
    const result = await runNativePickerWithRapidCancelRetry<ExpoImagePickerResult>(
        () => launchImageLibraryAsync({
            mediaTypes: mediaTypeImages,
            allowsMultipleSelection: multiple,
            quality: 1,
        }),
        { pickerLabelForError: 'Image picker' },
    );
    if (!result || result.canceled) return [];

    const assets = Array.isArray(result.assets) ? result.assets : [];
    const mapped: NativePickedFile[] = assets
        .map((asset: any) => {
            const file = asset?.file;
            if (isBrowserFile(file)) {
                return { kind: 'web' as const, file };
            }

            return {
                kind: 'native' as const,
                uri: typeof asset?.uri === 'string' ? asset.uri : '',
                name: sanitizePickedNameFromAsset(asset),
                sizeBytes: typeof asset?.fileSize === 'number' ? asset.fileSize : null,
                mimeType: typeof asset?.mimeType === 'string' ? asset.mimeType : null,
            };
        })
        .filter((entry: NativePickedFile) => entry.kind === 'web' || entry.uri.length > 0);

    return mapped;
}
