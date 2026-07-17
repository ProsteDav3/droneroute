import { describe, it, expect } from "vitest";
import {
  estimateFlightStats,
  estimateWaypointArrivalTimes,
  hoverTimeS,
  formatFlightDuration,
  countCaptureActions,
  computeSpeedForDuration,
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

describe("estimateWaypointArrivalTimes", () => {
  it("returns an empty array for no waypoints, and [0] for a single one", () => {
    expect(estimateWaypointArrivalTimes([], 5)).toEqual([]);
    expect(estimateWaypointArrivalTimes([wp(50, 14)], 5)).toEqual([0]);
  });

  it("returns one entry per waypoint, strictly increasing", () => {
    const waypoints = [wp(50, 14), wp(50.001, 14), wp(50.002, 14)];
    const arrivalTimes = estimateWaypointArrivalTimes(waypoints, 5);

    expect(arrivalTimes).toHaveLength(3);
    expect(arrivalTimes[0]).toBe(0);
    expect(arrivalTimes[1]).toBeGreaterThan(arrivalTimes[0]);
    expect(arrivalTimes[2]).toBeGreaterThan(arrivalTimes[1]);
  });

  it("delays every waypoint after a hover, but not the hovering waypoint itself", () => {
    const withoutHover = estimateWaypointArrivalTimes(
      [wp(50, 14), wp(50.001, 14), wp(50.002, 14)],
      5,
    );
    const withHover = estimateWaypointArrivalTimes(
      [
        wp(50, 14),
        {
          ...wp(50.001, 14),
          actions: [{ actionType: "hover", params: { hoverTime: 8 } }],
        },
        wp(50.002, 14),
      ],
      5,
    );

    // Reaching the hovering waypoint itself is unaffected...
    expect(withHover[1]).toBeCloseTo(withoutHover[1], 5);
    // ...but reaching the next one is delayed by exactly the hover time.
    expect(withHover[2]).toBeCloseTo(withoutHover[2] + 8, 5);
  });

  it("agrees with estimateFlightStats's total once the final waypoint's own hover is added back", () => {
    const waypoints = [
      wp(50, 14),
      {
        ...wp(50.0005, 14.0003, {
          useGlobalSpeed: false,
          speed: 4,
          turnMode: "toPointAndStopWithDiscontinuityCurvature" as const,
        }),
        actions: [{ actionType: "hover", params: { hoverTime: 3 } }],
      },
      wp(50.001, 14),
      {
        ...wp(50.0015, 14.0002),
        actions: [{ actionType: "hover", params: { hoverTime: 5 } }],
      },
    ];

    const arrivalTimes = estimateWaypointArrivalTimes(waypoints, 6);
    const { timeS } = estimateFlightStats(waypoints, 6);
    const lastWaypointHover = hoverTimeS(waypoints[waypoints.length - 1]);

    expect(
      arrivalTimes[arrivalTimes.length - 1] + lastWaypointHover,
    ).toBeCloseTo(timeS, 5);
  });
});

describe("computeSpeedForDuration", () => {
  it("returns null for fewer than two waypoints or a non-positive target", () => {
    expect(computeSpeedForDuration([], 30)).toBeNull();
    expect(computeSpeedForDuration([wp(50, 14)], 30)).toBeNull();
    expect(computeSpeedForDuration([wp(50, 14), wp(50.01, 14)], 0)).toBeNull();
    expect(computeSpeedForDuration([wp(50, 14), wp(50.01, 14)], -5)).toBeNull();
  });

  it("recovers a known speed via round-trip with estimateFlightStats (within a tight tolerance)", () => {
    const waypoints = [wp(50, 14), wp(50.02, 14), wp(50.04, 14)];
    const knownSpeed = 6;
    const { timeS: targetTimeS } = estimateFlightStats(
      waypoints.map((w) => ({
        ...w,
        useGlobalSpeed: false,
        speed: knownSpeed,
      })),
      knownSpeed,
    );
    const solved = computeSpeedForDuration(waypoints, targetTimeS);
    expect(solved).not.toBeNull();
    expect(solved!).toBeCloseTo(knownSpeed, 1);
  });

  it("returns null when the target is unreachable even at max speed (path too long)", () => {
    const waypoints = [wp(50, 14), wp(51, 14)]; // ~111 km
    expect(computeSpeedForDuration(waypoints, 1)).toBeNull();
  });

  it("returns null when the target is unreachable even at min speed (path too short)", () => {
    const waypoints = [wp(50, 14), wp(50.0001, 14)]; // ~11 m
    expect(computeSpeedForDuration(waypoints, 10000)).toBeNull();
  });

  it("with forceUniformSpeed: false, solves only for the global-speed segments and leaves overridden waypoints' contribution fixed (regression — previously solved as if every waypoint adopted the candidate speed, silently promising a duration the mission wouldn't actually have once a waypoint had its own speed override)", () => {
    const waypoints = [
      wp(50, 14),
      wp(50.02, 14, { useGlobalSpeed: false, speed: 2 }), // fixed, slow leg
      wp(50.04, 14),
    ];
    const globalSpeed = 8;
    const targetTimeS = estimateFlightStats(waypoints, globalSpeed).timeS;

    const solved = computeSpeedForDuration(waypoints, targetTimeS, {
      forceUniformSpeed: false,
    });
    expect(solved).not.toBeNull();
    expect(solved!).toBeCloseTo(globalSpeed, 1);

    // Applying the solved speed as the global default (respecting the
    // override, exactly as the real caller does) reproduces the target.
    const actualTimeS = estimateFlightStats(waypoints, solved!).timeS;
    expect(actualTimeS).toBeCloseTo(targetTimeS, 1);
  });

  it("with forceUniformSpeed: false, returns null when every waypoint already has its own speed override (the global speed has no effect on the total)", () => {
    const waypoints = [
      wp(50, 14, { useGlobalSpeed: false, speed: 5 }),
      wp(50.01, 14, { useGlobalSpeed: false, speed: 5 }),
    ];
    expect(
      computeSpeedForDuration(waypoints, 9999, { forceUniformSpeed: false }),
    ).toBeNull();
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
