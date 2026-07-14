export interface ThermalCameraFov {
  label: string;
  hfovDeg: number;
  vfovDeg: number;
  /** Set when the underlying drone/payload identity itself is unconfirmed (see DRONE_MODELS) — the recommendation UI should carry that caveat forward instead of implying the same confidence as a verified payload. */
  experimental?: boolean;
}

/**
 * DJI only publishes a single diagonal FOV (DFOV) for these thermal
 * payloads. Horizontal/vertical values here are derived from that
 * published DFOV using the sensor's known 640x512 (5:4) aspect ratio via
 * rectilinear-lens trigonometry:
 *   tan(DFOV/2) = sqrt(tan(HFOV/2)^2 + tan(VFOV/2)^2), HFOV_tan = 1.25 * VFOV_tan
 * Validated against an independently-published H20T H/V breakdown (within
 * ~0.5° of the value derived here from DJI's own DFOV spec) — see PR
 * discussion / changelog for sourcing. Keyed by `payloadEnumValue`.
 */
export const THERMAL_CAMERA_FOV: Record<number, ThermalCameraFov> = {
  43: { label: "H20T", hfovDeg: 32.2, vfovDeg: 26.0 }, // DFOV 40.6° (DJI spec)
  53: { label: "M30T Camera", hfovDeg: 49.4, vfovDeg: 40.4 }, // DFOV 61° (DJI spec)
  67: { label: "M3T Camera", hfovDeg: 49.4, vfovDeg: 40.4 }, // DFOV 61° (DJI spec)
  81: { label: "M3TD Camera", hfovDeg: 49.4, vfovDeg: 40.4 }, // same thermal module as M3T
  103: {
    label: "Matrice 4T Camera",
    hfovDeg: 35.8,
    vfovDeg: 29.0, // DFOV 45° (DJI spec)
    // DRONE_MODELS already flags this drone/payload identity as an
    // unverified placeholder (no published WPML spec confirms it) — carry
    // that caveat into the recommendation UI rather than showing the same
    // confidence as a verified payload.
    experimental: true,
  },
};

const DEFAULT_SOLAR_OVERLAP = 0.2;

export interface SolarSpacingRecommendation {
  lineSpacingM: number;
  photoSpacingM: number;
}

/**
 * Recommended flight-line spacing (cross-track) and photo spacing
 * (along-track) so consecutive nadir thermal photos overlap enough to
 * leave no coverage gaps, for the given altitude and payload. Returns
 * `null` when the payload's thermal FOV isn't known — never guesses a
 * number for an unlisted camera.
 */
export function recommendSolarSpacing(
  altitude: number,
  payloadEnumValue: number,
  overlap: number = DEFAULT_SOLAR_OVERLAP,
): SolarSpacingRecommendation | null {
  const fov = THERMAL_CAMERA_FOV[payloadEnumValue];
  if (!fov) return null;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const footprintWidth = 2 * altitude * Math.tan(toRad(fov.hfovDeg) / 2);
  const footprintHeight = 2 * altitude * Math.tan(toRad(fov.vfovDeg) / 2);
  return {
    lineSpacingM: Math.round(footprintWidth * (1 - overlap) * 10) / 10,
    photoSpacingM: Math.round(footprintHeight * (1 - overlap) * 10) / 10,
  };
}
