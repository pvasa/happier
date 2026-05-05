use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopPetOverlayAnchor {
    BottomRight,
    BottomLeft,
    TopRight,
    TopLeft,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct Size {
    pub width: f64,
    pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct DesktopPetOverlayPosition {
    pub x: f64,
    pub y: f64,
}

pub(crate) const PET_OVERLAY_PARK_OFFSCREEN_DISTANCE_PX: f64 = 10_000.0;
pub(crate) const PET_OVERLAY_DRAG_OFFSET_LIMIT_PX: f64 = 4_096.0;

pub(crate) fn clamp(value: f64, min: f64, max: f64) -> f64 {
    if max < min {
        return min;
    }
    value.max(min).min(max)
}

pub(crate) fn sanitize_offset(value: f64) -> f64 {
    if value.is_finite() {
        value
    } else {
        0.0
    }
}

pub(crate) fn resolve_pet_overlay_placement(
    monitor: Rect,
    window: Size,
    anchor: DesktopPetOverlayAnchor,
    offset_x: f64,
    offset_y: f64,
    padding: f64,
) -> DesktopPetOverlayPosition {
    let padding = sanitize_offset(padding).max(0.0);
    let min_x = monitor.x + padding;
    let min_y = monitor.y + padding;
    let max_x = monitor.x + monitor.width - window.width - padding;
    let max_y = monitor.y + monitor.height - window.height - padding;

    let base_x = match anchor {
        DesktopPetOverlayAnchor::BottomRight | DesktopPetOverlayAnchor::TopRight => max_x,
        DesktopPetOverlayAnchor::BottomLeft | DesktopPetOverlayAnchor::TopLeft => min_x,
    };
    let base_y = match anchor {
        DesktopPetOverlayAnchor::BottomRight | DesktopPetOverlayAnchor::BottomLeft => max_y,
        DesktopPetOverlayAnchor::TopRight | DesktopPetOverlayAnchor::TopLeft => min_y,
    };

    DesktopPetOverlayPosition {
        x: clamp(base_x + sanitize_offset(offset_x), min_x, max_x),
        y: clamp(base_y + sanitize_offset(offset_y), min_y, max_y),
    }
}

pub(crate) fn resolve_pet_overlay_parking_position(monitor: Rect) -> DesktopPetOverlayPosition {
    let base_x = if monitor.width > 0.0 {
        monitor.x + monitor.width
    } else {
        monitor.x
    };
    let base_y = if monitor.height > 0.0 {
        monitor.y + monitor.height
    } else {
        monitor.y
    };

    DesktopPetOverlayPosition {
        x: base_x + PET_OVERLAY_PARK_OFFSCREEN_DISTANCE_PX,
        y: base_y + PET_OVERLAY_PARK_OFFSCREEN_DISTANCE_PX,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placement_clamps_drag_offset_to_visible_monitor_bounds() {
        let placement = resolve_pet_overlay_placement(
            Rect {
                x: 100.0,
                y: 50.0,
                width: 640.0,
                height: 480.0,
            },
            Size {
                width: 192.0,
                height: 208.0,
            },
            DesktopPetOverlayAnchor::BottomRight,
            10_000.0,
            10_000.0,
            12.0,
        );

        assert_eq!(placement, DesktopPetOverlayPosition { x: 536.0, y: 310.0 },);
    }

    #[test]
    fn parking_position_is_far_outside_the_monitor_bottom_right() {
        let parking = resolve_pet_overlay_parking_position(Rect {
            x: -120.0,
            y: 40.0,
            width: 800.0,
            height: 600.0,
        });

        assert_eq!(
            parking,
            DesktopPetOverlayPosition {
                x: 10_680.0,
                y: 10_640.0,
            },
        );
    }
}
