export const TRANSCRIPT_TOP_GUTTER_PX = 12;
export const TRANSCRIPT_NATIVE_SCROLL_EVENT_THROTTLE_MS = 16;
export const TRANSCRIPT_WEB_FLASH_LIST_SCROLL_EVENT_THROTTLE_MS = 32;
/**
 * Timer fallback for rAF-backed visual-update waits (plan D5, evidence E10):
 * a per-wait slice of the initial-fill budget so rAF starvation in background
 * tabs can never stall fill or prepend-anchor restore loops.
 */
export const TRANSCRIPT_VISUAL_UPDATE_FALLBACK_TIMEOUT_MS = 250;
