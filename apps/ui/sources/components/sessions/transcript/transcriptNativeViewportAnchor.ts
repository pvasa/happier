import type { FlashListRef } from '@/components/ui/lists/flashListCompat/FlashListCompat';

export type NativeTranscriptViewportFlashListRef<T> = FlashListRef<T>;

export type NativeTranscriptViewportAnchorKind = 'message' | 'toolGroup' | 'item';

export type NativeTranscriptViewportAnchor = Readonly<{
    kind: NativeTranscriptViewportAnchorKind;
    messageId?: string | null;
    itemId: string;
    itemOffsetPx: number;
    capturedAtMs: number;
}>;

export type NativeTranscriptViewportAnchorDescriptor = Readonly<{
    kind: NativeTranscriptViewportAnchorKind;
    messageId?: string | null;
    itemId: string;
}>;

export type NativeTranscriptViewportAnchorCaptureResult =
    | Readonly<{
        status: 'captured';
        index: number;
        anchor: NativeTranscriptViewportAnchor;
    }>
    | Readonly<{
        status: 'methods_unavailable';
        missingMethods: readonly string[];
    }>
    | Readonly<{
        status: 'no_visible_indices' | 'no_measurable_items' | 'no_anchorable_item';
    }>;

export type NativeTranscriptViewportAnchorRestorePlanResult =
    | Readonly<{ status: 'planned'; index: number; viewOffset: number }>
    | Readonly<{ status: 'invalid_index' | 'invalid_offset' }>;

const NATIVE_FIRST_VISIBLE_FALLBACK_SCAN_AHEAD_ITEM_COUNT = 24;

type NativeTranscriptAnchorSourceItem = Readonly<{
    id?: unknown;
    kind?: unknown;
    messageId?: unknown;
    toolMessageIds?: unknown;
}>;

type NativeTranscriptLayout = Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
}>;

function isFiniteLayout(layout: NativeTranscriptLayout | undefined): layout is NativeTranscriptLayout {
    if (layout == null) return false;
    return (
        Number.isFinite(layout.x) &&
        Number.isFinite(layout.y) &&
        Number.isFinite(layout.width) &&
        Number.isFinite(layout.height)
    );
}

function resolveDefaultAnchorDescriptor(item: unknown): NativeTranscriptViewportAnchorDescriptor | null {
    if (typeof item !== 'object' || item == null) return null;

    const source = item as NativeTranscriptAnchorSourceItem;
    if (typeof source.id !== 'string' || source.id.length === 0) return null;

    if (source.kind === 'message' && typeof source.messageId === 'string' && source.messageId.length > 0) {
        return {
            kind: 'message',
            itemId: source.id,
            messageId: source.messageId,
        };
    }

    if (source.kind === 'tool-calls-group') {
        return {
            kind: 'toolGroup',
            itemId: source.id,
        };
    }

    return {
        kind: 'item',
        itemId: source.id,
    };
}

function clampIndex(index: number, maxExclusive: number): number | null {
    if (!Number.isInteger(index) || index < 0 || index >= maxExclusive) return null;
    return index;
}

function resolveVisibleRange<T>(
    ref: NativeTranscriptViewportFlashListRef<T>,
    dataLength: number,
): { startIndex: number; endIndex: number } | null {
    if (dataLength <= 0) return null;

    if (typeof ref.computeVisibleIndices === 'function') {
        const range = ref.computeVisibleIndices();
        const startIndex = Math.max(0, Math.min(range.startIndex, dataLength - 1));
        const endIndex = Math.max(startIndex, Math.min(range.endIndex, dataLength - 1));
        return { startIndex, endIndex };
    }

    if (typeof ref.getFirstVisibleIndex === 'function') {
        const startIndex = clampIndex(ref.getFirstVisibleIndex(), dataLength);
        if (startIndex == null) return null;
        return {
            startIndex,
            endIndex: Math.min(dataLength - 1, startIndex + NATIVE_FIRST_VISIBLE_FALLBACK_SCAN_AHEAD_ITEM_COUNT),
        };
    }

    return null;
}

function chooseFocusLineIndex<T>(params: Readonly<{
    getLayout: (index: number) => NativeTranscriptLayout | undefined;
    range: { startIndex: number; endIndex: number };
    absoluteFocusLineY: number;
}>): { index: number; layout: NativeTranscriptLayout } | null {
    let nearest: { index: number; layout: NativeTranscriptLayout; distancePx: number } | null = null;

    for (let index = params.range.startIndex; index <= params.range.endIndex; index += 1) {
        const layout = params.getLayout(index);
        if (!isFiniteLayout(layout)) continue;

        const top = layout.y;
        const bottom = layout.y + layout.height;
        if (top <= params.absoluteFocusLineY && bottom >= params.absoluteFocusLineY) {
            return { index, layout };
        }

        const distancePx = params.absoluteFocusLineY < top
            ? top - params.absoluteFocusLineY
            : params.absoluteFocusLineY - bottom;
        if (nearest == null || distancePx < nearest.distancePx) {
            nearest = { index, layout, distancePx };
        }
    }

    return nearest == null ? null : { index: nearest.index, layout: nearest.layout };
}

export function captureNativeTranscriptViewportAnchor<T>(params: Readonly<{
    ref: NativeTranscriptViewportFlashListRef<T> | null | undefined;
    data: readonly T[];
    focusOffsetPx: number;
    capturedAtMs: number;
    resolveAnchor?: (item: T, index: number) => NativeTranscriptViewportAnchorDescriptor | null;
}>): NativeTranscriptViewportAnchorCaptureResult {
    const ref = params.ref;
    const missingMethods: string[] = [];
    if (ref == null) {
        return {
            status: 'methods_unavailable',
            missingMethods: ['getLayout', 'getAbsoluteLastScrollOffset', 'computeVisibleIndices|getFirstVisibleIndex'],
        };
    }

    const getLayout = ref.getLayout;
    const getAbsoluteLastScrollOffset = ref.getAbsoluteLastScrollOffset;
    const hasVisibleIndexMethod = typeof ref.computeVisibleIndices === 'function' || typeof ref.getFirstVisibleIndex === 'function';
    if (typeof getLayout !== 'function') missingMethods.push('getLayout');
    if (typeof getAbsoluteLastScrollOffset !== 'function') missingMethods.push('getAbsoluteLastScrollOffset');
    if (!hasVisibleIndexMethod) {
        missingMethods.push('computeVisibleIndices|getFirstVisibleIndex');
    }
    if (typeof getLayout !== 'function' || typeof getAbsoluteLastScrollOffset !== 'function' || !hasVisibleIndexMethod) {
        return { status: 'methods_unavailable', missingMethods };
    }

    const visibleRange = resolveVisibleRange(ref, params.data.length);
    if (visibleRange == null) return { status: 'no_visible_indices' };

    const absoluteScrollOffset = getAbsoluteLastScrollOffset();
    const candidate = chooseFocusLineIndex({
        getLayout,
        range: visibleRange,
        absoluteFocusLineY: absoluteScrollOffset + params.focusOffsetPx,
    });
    if (candidate == null) return { status: 'no_measurable_items' };

    const item = params.data[candidate.index];
    if (item == null) return { status: 'no_anchorable_item' };

    const descriptor = params.resolveAnchor?.(item, candidate.index) ?? resolveDefaultAnchorDescriptor(item);
    if (descriptor == null) return { status: 'no_anchorable_item' };

    return {
        status: 'captured',
        index: candidate.index,
        anchor: {
            ...descriptor,
            itemOffsetPx: candidate.layout.y - absoluteScrollOffset,
            capturedAtMs: params.capturedAtMs,
        },
    };
}

export function planNativeTranscriptViewportAnchorRestore(params: Readonly<{
    index: number;
    itemOffsetPx: number;
}>): NativeTranscriptViewportAnchorRestorePlanResult {
    if (!Number.isInteger(params.index) || params.index < 0) {
        return { status: 'invalid_index' };
    }
    if (typeof params.itemOffsetPx !== 'number' || !Number.isFinite(params.itemOffsetPx)) {
        return { status: 'invalid_offset' };
    }
    return {
        status: 'planned',
        index: params.index,
        // FlashList adds viewOffset to the item layout offset; invert our row-top-to-viewport coordinate.
        viewOffset: -params.itemOffsetPx,
    };
}
