import {
  assessFlightConditions,
  type DailyForecast,
  type FlightVerdict,
} from "./weather";
import type { TwilightStatus } from "./sunPosition";

/**
 * Kp is a 0-9 planetary geomagnetic activity index. Kp ≥ 5 marks a "minor
 * geomagnetic storm" per NOAA's scale, loosely associated with degraded GPS
 * positioning accuracy — phrased conservatively here since the actual
 * impact on any given receiver varies and isn't something this app can
 * measure directly.
 */
export const KP_CAUTION_THRESHOLD = 5;

export interface OverallFlightAssessment {
  verdict: FlightVerdict;
  /** Human-readable reasons behind the verdict, across all contributing factors — empty for "go". */
  reasons: string[];
}

export interface FlightConditionsInput {
  /** Today's aggregated weather forecast, or null while it hasn't loaded yet. */
  day: DailyForecast | null;
  /** Latest planetary Kp index, or null while it hasn't loaded yet / is unavailable. */
  kp: number | null;
  twilightStatus: TwilightStatus;
}

/**
 * Combines the existing weather-based go/caution/no-go verdict
 * (assessFlightConditions — wind, temperature, precipitation, storm risk)
 * with two additional planning signals — geomagnetic activity and
 * proximity to civil twilight — into a single overall recommendation.
 * Reuses the weather thresholds as-is rather than redefining them, so the
 * two verdicts (this one and the per-day weather badge) never drift out
 * of sync. Deliberately conservative and advisory only — a planning aid,
 * not an authoritative go/no-go authority.
 */
export function assessOverallFlightConditions(
  input: FlightConditionsInput,
): OverallFlightAssessment {
  const noGoReasons: string[] = [];
  const cautionReasons: string[] = [];

  if (input.day) {
    const weather = assessFlightConditions(input.day);
    if (weather.verdict === "no-go") {
      noGoReasons.push(...weather.reasons);
    } else if (weather.verdict === "caution") {
      cautionReasons.push(...weather.reasons);
    }
  }

  if (input.kp !== null && input.kp >= KP_CAUTION_THRESHOLD) {
    cautionReasons.push(
      `Zvýšená geomagnetická aktivita (Kp ${input.kp.toFixed(1)}) — GPS přesnost může být snížená`,
    );
  }

  if (input.twilightStatus === "night") {
    cautionReasons.push(
      "Blízko občanského soumraku nebo po něm — mohou platit pravidla pro noční létání, ověřte národní předpisy",
    );
  } else if (input.twilightStatus === "near-twilight") {
    cautionReasons.push(
      "Blíží se občanský soumrak — mohou platit pravidla pro noční létání, ověřte národní předpisy",
    );
  }

  if (noGoReasons.length > 0) {
    // Same rule as the underlying weather assessment: caution-level factors
    // are still surfaced alongside no-go ones for context, but never
    // downgrade the verdict itself.
    return { verdict: "no-go", reasons: [...noGoReasons, ...cautionReasons] };
  }
  if (cautionReasons.length > 0) {
    return { verdict: "caution", reasons: cautionReasons };
  }
  return { verdict: "go", reasons: [] };
}
