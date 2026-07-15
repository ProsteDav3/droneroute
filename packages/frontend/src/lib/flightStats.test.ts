import { describe, it, expect } from "vitest";
import {
  estimateFlightStats,
  formatFlightDuration,
  countCaptureActions,
  haversine,
  type FlightStatsWaypoint,
} from "./flightStats";

function wp(
  lat: number,
  lng: number,
  overrides: Partial<FlightStatsWaypoint> = {},
): FlightStatsWaypoint {
  return {
    latitude: lat,
    longitude: lng,
    speed: 5,
    useGlobalSpeed: true,
    ...overrides,
  };
}

describe("estimateFlightStats", () => {
  it("returns zero for fewer than two waypoints", () => {
    expect(estimateFlightStats([], 5)).toEqual({ distanceM: 0, timeS: 0 });
    expect(estimateFlightStats([wp(50, 14)], 5)).toEqual({
      distanceM: 0,
      timeS: 0,
    });
  });

  it("adds ramp-up/ramp-down overhead on top of naive distance/speed for a straight, unbroken path", () => {
    // Three colinear points (no turn at all) — still pays ramp-up/down since
    // the aircraft isn't instantly at cruise speed at the very start/end.
    const waypoints = [wp(50, 14), wp(50.001, 14), wp(50.002, 14)];
    const naiveDistance =
      haversine(50, 14, 50.001, 14) + haversine(50.001, 14, 50.002, 14);
    const naiveTime = naiveDistance / 5;

    const { distanceM, timeS } = estimateFlightStats(waypoints, 5);

    expect(distanceM).toBeCloseTo(naiveDistance, 3);
    expect(timeS).toBeGreaterThan(naiveTime);
    // Ramp-up + ramp-down at 5 m/s and the default assumed accel (2 m/s²):
    // 2 * (5/2) = 5s of extra overhead, no turn/hover penalties on a
    // straight line.
    expect(timeS).toBeCloseTo(naiveTime + 5, 1);
  });

  it("adds explicit hover-action time directly", () => {
    const withoutHover = estimateFlightStats([wp(50, 14), wp(50.001, 14)], 5);
    const withHover = estimateFlightStats(
      [
        wp(50, 14),
        {
          ...wp(50.001, 14),
          actions: [
            { actionType: "hover", params: { hoverTime: 8 } },
            { actionType: "takePhoto", params: {} },
          ],
        },
      ],
      5,
    );

    expect(withHover.timeS).toBeCloseTo(withoutHover.timeS + 8, 5);
  });

  it("also counts hover time on a KMZ-imported action (raw 'wpml:hoverTime' string key)", () => {
    const withoutHover = estimateFlightStats([wp(50, 14), wp(50.001, 14)], 5);
    const withImportedHover = estimateFlightStats(
      [
        wp(50, 14),
        {
          ...wp(50.001, 14),
          actions: [{ actionType: "hover", params: { "wpml:hoverTime": "8" } }],
        },
      ],
      5,
    );

    expect(withImportedHover.timeS).toBeCloseTo(withoutHover.timeS + 8, 5);
  });

  it("falls back to a sane default speed instead of counting real distance as taking zero time", () => {
    const withZeroSpeed = estimateFlightStats(
      [wp(50, 14), wp(50.001, 14, { useGlobalSpeed: false, speed: 0 })],
      5,
    );
    // The documented fallback is 7 m/s — a waypoint with an invalid speed
    // of 0 should behave identically to one explicitly set to the fallback.
    const withFallbackSpeed = estimateFlightStats(
      [wp(50, 14), wp(50.001, 14, { useGlobalSpeed: false, speed: 7 })],
      5,
    );

    expect(withZeroSpeed.timeS).toBeGreaterThan(0);
    expect(withZeroSpeed.timeS).toBeCloseTo(withFallbackSpeed.timeS, 5);
  });

  it("adds a large overhead at a waypoint whose turn mode forces a full stop", () => {
    // A sharp 90° turn at the middle waypoint.
    const straight = estimateFlightStats(
      [
        wp(50, 14),
        wp(50.001, 14, { turnMode: "coordinateTurn" }),
        wp(50.002, 14),
      ],
      5,
    );
    const stopping = estimateFlightStats(
      [
        wp(50, 14),
        wp(50.001, 14, {
          turnMode: "toPointAndStopWithDiscontinuityCurvature",
        }),
        wp(50.002, 14.001),
      ],
      5,
    );

    // 2*(5/2) + 1s stabilize = 6s minimum extra for the stop, regardless of
    // the (small) turn-angle difference between the two scenarios.
    expect(stopping.timeS).toBeGreaterThan(straight.timeS + 5);
  });

  it("adds a smaller partial penalty for a sharp, undamped turn that doesn't otherwise stop", () => {
    // Same ~90° turn geometry in both cases — only turnDampingDist differs,
    // isolating exactly the damping effect from the (otherwise identical)
    // distance/cruise-time contribution.
    const sharpUndamped = estimateFlightStats(
      [
        wp(50, 14),
        wp(50.001, 14, {
          turnMode: "coordinateTurn",
          turnDampingDist: 0,
        }),
        wp(50.001, 14.002),
      ],
      5,
    );
    const sharpDamped = estimateFlightStats(
      [
        wp(50, 14),
        wp(50.001, 14, {
          turnMode: "coordinateTurn",
          turnDampingDist: 50,
        }),
        wp(50.001, 14.002),
      ],
      5,
    );

    expect(sharpUndamped.timeS).toBeGreaterThan(sharpDamped.timeS);
    expect(sharpUndamped.distanceM).toBeCloseTo(sharpDamped.distanceM, 5);
  });

  it("respects per-waypoint speed when useGlobalSpeed is false", () => {
    const { timeS } = estimateFlightStats(
      [wp(50, 14), wp(50.001, 14, { useGlobalSpeed: false, speed: 2 })],
      10,
    );
    const dist = haversine(50, 14, 50.001, 14);
    // Cruise leg uses the waypoint's own speed (2 m/s), not the global 10.
    expect(timeS).toBeGreaterThan(dist / 10);
  });
});

describe("formatFlightDuration", () => {
  it("formats seconds, minutes, and hours", () => {
    expect(formatFlightDuration(45)).toBe("45s");
    expect(formatFlightDuration(65)).toBe("1m 5s");
    expect(formatFlightDuration(120)).toBe("2m");
    expect(formatFlightDuration(3660)).toBe("1h 1m");
    expect(formatFlightDuration(3600)).toBe("1h");
  });
});

describe("countCaptureActions", () => {
  it("counts takePhoto and startRecord actions across all waypoints", () => {
    const waypoints = [
      { actions: [{ actionType: "takePhoto" }, { actionType: "hover" }] },
      { actions: [{ actionType: "takePhoto" }] },
      { actions: [{ actionType: "startRecord" }] },
      { actions: [] },
    ];
    expect(countCaptureActions(waypoints)).toEqual({
      photoCount: 2,
      videoCount: 1,
    });
  });

  it("returns zero counts for waypoints with no capture actions", () => {
    expect(countCaptureActions([{ actions: [] }])).toEqual({
      photoCount: 0,
      videoCount: 0,
    });
    expect(countCaptureActions([])).toEqual({ photoCount: 0, videoCount: 0 });
  });
});
