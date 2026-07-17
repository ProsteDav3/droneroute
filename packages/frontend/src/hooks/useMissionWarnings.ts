import { useMemo } from "react";
import { useAirspaceStore } from "@/store/airspaceStore";
import { getObstacleWarnings, getAirspaceWarnings } from "@/lib/geo";
import { estimateFlightStats, formatFlightDuration } from "@/lib/flightStats";
import type { Waypoint, Obstacle } from "@droneroute/shared";
import type { Warning } from "@/components/mission/WarningsPanel";

interface UseMissionWarningsArgs {
  waypoints: Waypoint[];
  obstacles: Obstacle[];
  autoFlightSpeed: number;
  maxBatteryMinutes: number;
}

/** Derives the map overlay's warning banners, the flight-time/distance
 * estimate shown in the sidebar footer, and the per-segment battery-cycle
 * summary — all purely computed from the current mission snapshot, with no
 * side effects of their own. Extracted out of App.tsx since none of it
 * depends on anything App-specific beyond the mission's own state. */
export function useMissionWarnings({
  waypoints,
  obstacles,
  autoFlightSpeed,
  maxBatteryMinutes,
}: UseMissionWarningsArgs) {
  const obstacleWarnings = useMemo(
    () => getObstacleWarnings(waypoints, obstacles),
    [waypoints, obstacles],
  );

  const airspaceZones = useAirspaceStore((s) => s.zones);
  const airspaceEnabled = useAirspaceStore((s) => s.enabled);
  const airspaceWarnings = useMemo(
    () =>
      airspaceEnabled ? getAirspaceWarnings(waypoints, airspaceZones) : [],
    [waypoints, airspaceZones, airspaceEnabled],
  );

  const flightStats = useMemo(
    () =>
      waypoints.length >= 2
        ? estimateFlightStats(waypoints, autoFlightSpeed)
        : null,
    [waypoints, autoFlightSpeed],
  );

  // Summary across a whole segmented project (export/save segments): each
  // consecutive-pair segment is its own standalone flight (own take-off,
  // own landing), so — unlike flightStats above, which ramps up/down once
  // for the full continuous route — this estimates each segment as its own
  // independent flight, then reports how many separate flights/battery
  // cycles the whole revisit schedule will actually need.
  const segmentsSummary = useMemo(() => {
    if (waypoints.length < 2) return null;
    const segmentCount = waypoints.length - 1;
    let totalTimeS = 0;
    let maxSegmentTimeS = 0;
    for (let i = 0; i < segmentCount; i++) {
      const { timeS } = estimateFlightStats(
        [waypoints[i], waypoints[i + 1]],
        autoFlightSpeed,
      );
      totalTimeS += timeS;
      maxSegmentTimeS = Math.max(maxSegmentTimeS, timeS);
    }
    return {
      segmentCount,
      totalTimeS,
      exceedsBattery: maxSegmentTimeS > maxBatteryMinutes * 60,
    };
  }, [waypoints, autoFlightSpeed, maxBatteryMinutes]);

  const warnings = useMemo(() => {
    const result: Warning[] = [];
    if (obstacles.length > 0 && obstacleWarnings.length > 0) {
      result.push({
        id: "obstacle",
        type: "obstacle",
        message: `${obstacleWarnings.length} upozornění na překážky — body trasy zasahují do zakázaných zón`,
      });
    }
    if (flightStats && flightStats.timeS > maxBatteryMinutes * 60) {
      result.push({
        id: "battery",
        type: "battery",
        message: `Doba letu (${formatFlightDuration(flightStats.timeS)}) přesahuje maximální kapacitu baterie (${maxBatteryMinutes} min)`,
      });
    }
    // Airspace zone warnings
    const prohibitedCount = airspaceWarnings.filter(
      (w) => w.severity === "prohibited",
    ).length;
    const restrictedCount = airspaceWarnings.filter(
      (w) => w.severity === "restricted",
    ).length;
    if (prohibitedCount > 0) {
      result.push({
        id: "airspace-prohibited",
        type: "airspace",
        message: `Trasa letu vstupuje do ${prohibitedCount} ${prohibitedCount === 1 ? "zakázané vzdušné zóny" : "zakázaných vzdušných zón"} — let není povolen`,
      });
    }
    if (restrictedCount > 0) {
      result.push({
        id: "airspace-restricted",
        type: "airspace",
        message: `Trasa letu vstupuje do ${restrictedCount} ${restrictedCount === 1 ? "omezené vzdušné zóny" : "omezených vzdušných zón"} — může být vyžadováno povolení`,
      });
    }
    return result;
  }, [
    obstacleWarnings,
    obstacles.length,
    flightStats,
    maxBatteryMinutes,
    airspaceWarnings,
  ]);

  return { warnings, flightStats, segmentsSummary };
}
