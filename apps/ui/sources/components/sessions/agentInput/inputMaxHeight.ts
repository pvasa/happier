export function clampNumber(value: number, min: number, max: number): number {
    const effectiveMin = Math.min(min, max);
    return Math.max(effectiveMin, Math.min(max, value));
}

export function computeAvailableHeight(screenHeight: number, keyboardHeight: number, reservedHeight = 0): number {
    const safeScreen = Number.isFinite(screenHeight) ? screenHeight : 0;
    const safeKeyboard = Number.isFinite(keyboardHeight) ? keyboardHeight : 0;
    const safeReserved = Number.isFinite(reservedHeight) ? Math.max(0, reservedHeight) : 0;
    return Math.max(0, safeScreen - safeKeyboard - safeReserved);
}

export function computeMeasuredPanelInputMaxHeight(params: {
    panelMaxHeight?: number | null;
    panelHeight?: number | null;
    inputContainerHeight?: number | null;
    inputViewportHeight?: number | null;
    fallbackMaxHeight: number;
}): number {
    const safePanelMaxHeight = Number.isFinite(params.panelMaxHeight) ? Math.max(0, params.panelMaxHeight ?? 0) : null;
    const safePanelHeight = Number.isFinite(params.panelHeight) ? Math.max(0, params.panelHeight ?? 0) : null;
    const safeInputContainerHeight = Number.isFinite(params.inputContainerHeight) ? Math.max(0, params.inputContainerHeight ?? 0) : null;
    const safeInputViewportHeight = Number.isFinite(params.inputViewportHeight) ? Math.max(0, params.inputViewportHeight ?? 0) : null;
    if (
        safePanelMaxHeight == null
        || safePanelHeight == null
        || safeInputContainerHeight == null
        || safeInputViewportHeight == null
    ) {
        return params.fallbackMaxHeight;
    }

    const fixedChromeHeight = Math.max(0, safePanelHeight - safeInputContainerHeight);
    const inputContainerChromeHeight = Math.max(0, safeInputContainerHeight - safeInputViewportHeight);
    const availableInputHeight = Math.max(0, Math.round(safePanelMaxHeight - fixedChromeHeight - inputContainerChromeHeight));
    return clampNumber(availableInputHeight, 120, availableInputHeight);
}

export function computeAgentInputDefaultMaxHeight(params: {
    platform: string;
    screenHeight: number;
    keyboardHeight: number;
}): number {
    const available = computeAvailableHeight(params.screenHeight, params.keyboardHeight);
    if (params.platform === 'web') {
        return clampNumber(Math.round(available * 0.75), 200, 900);
    }
    return clampNumber(Math.round(available * 0.4), 120, 360);
}

export function computeNewSessionInputMaxHeight(params: {
    useEnhancedSessionWizard: boolean;
    screenHeight: number;
    keyboardHeight: number;
    reservedHeight?: number;
}): number {
    const available = computeAvailableHeight(
        params.screenHeight,
        params.keyboardHeight,
        params.reservedHeight ?? 0,
    );
    const keyboardVisible = params.keyboardHeight > 0;
    const ratio = params.useEnhancedSessionWizard
        ? 0.25
        : keyboardVisible
            ? 0.75
            : 0.75;
    const cap = params.useEnhancedSessionWizard
        ? 240
        : keyboardVisible
            ? 360
            : 900;
    return clampNumber(Math.round(available * ratio), 120, cap);
}

export function computeAgentInputKeyboardOpenPanelMaxHeight(params: {
    screenHeight: number;
    keyboardHeight: number;
}): number | undefined {
    const available = computeAvailableHeight(params.screenHeight, params.keyboardHeight);
    if (available <= 0 || params.keyboardHeight <= 0) return undefined;
    const availablePanelHeight = Math.max(0, Math.round(available - 16));
    return clampNumber(availablePanelHeight, 220, Math.min(680, availablePanelHeight));
}

export function computeAgentInputKeyboardOpenVariableSectionMaxHeight(params: {
    panelMaxHeight: number;
    footerHeight: number;
}): number {
    const safePanel = Number.isFinite(params.panelMaxHeight) ? Math.max(0, params.panelMaxHeight) : 0;
    const safeFooter = Number.isFinite(params.footerHeight) ? Math.max(0, Math.trunc(params.footerHeight)) : 0;
    const availableVariableSectionHeight = Math.max(0, safePanel - safeFooter);
    return clampNumber(availableVariableSectionHeight, 120, availableVariableSectionHeight);
}
