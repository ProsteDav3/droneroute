import { describe, it, expect } from "vitest";
import {
  assessOverallFlightConditions,
  KP_CAUTION_THRESHOLD,
  type FlightConditionsInput,
} from "./flightConditions";
import type { DailyForecast } from "./weather";

function day(overrides: Partial<DailyForecast> = {}): DailyForecast {
  return {
    date: "2026-07-15",
    minTempC: 15,
    maxTempC: 22,
    maxWindSpeedMs: 3,
    totalPrecipitationMm: 0,
    symbolCode: "clearsky_day",
    ...overrides,
  };
}

function input(
  overrides: Partial<FlightConditionsInput> = {},
): FlightConditionsInput {
  return {
    day: day(),
    kp: 2,
    twilightStatus: "day",
    ...overrides,
  };
}

describe("assessOverallFlightConditions", () => {
  it("returns 'go' with no reasons when weather, Kp, and twilight are all favorable", () => {
    expect(assessOverallFlightConditions(input())).toEqual({
      verdict: "go",
      reasons: [],
    });
  });

  it("returns 'caution' from an elevated Kp index alone, with otherwise-calm weather and daylight", () => {
    const result = assessOverallFlightConditions(
      input({ kp: KP_CAUTION_THRESHOLD }),
    );
    expect(result.verdict).toBe("caution");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/geomagnetick/i);
  });

  it("does not flag Kp just below the caution threshold", () => {
    const result = assessOverallFlightConditions(
      input({ kp: KP_CAUTION_THRESHOLD - 0.1 }),
    );
    expect(result.verdict).toBe("go");
  });

  it("returns 'caution' from approaching civil twilight alone", () => {
    const result = assessOverallFlightConditions(
      input({ twilightStatus: "near-twilight" }),
    );
    expect(result.verdict).toBe("caution");
    expect(result.reasons).toHaveLength(1);
    expect(result.reasons[0]).toMatch(/soumrak/i);
  });

  it("returns 'caution' from being at/after civil twilight (night) alone", () => {
    const result = assessOverallFlightConditions(
      input({ twilightStatus: "night" }),
    );
    expect(result.verdict).toBe("caution");
    expect(result.reasons[0]).toMatch(/soumrak/i);
  });

  it("returns 'no-go' when the underlying weather assessment is no-go (wind exceeding threshold), even with otherwise-favorable Kp/twilight", () => {
    const result = assessOverallFlightConditions(
      input({ day: day({ maxWindSpeedMs: 15 }) }),
    );
    expect(result.verdict).toBe("no-go");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("combines a no-go weather verdict with caution-level Kp/twilight reasons without downgrading the verdict", () => {
    const result = assessOverallFlightConditions(
      input({
        day: day({ maxWindSpeedMs: 15 }),
        kp: 6,
        twilightStatus: "night",
      }),
    );
    expect(result.verdict).toBe("no-go");
    // wind no-go reason + Kp caution reason + twilight caution reason
    expect(result.reasons.length).toBe(3);
  });

  it("combines a caution-level weather verdict with an additional caution factor into a still-caution verdict with both reasons", () => {
    const result = assessOverallFlightConditions(
      input({ day: day({ maxWindSpeedMs: 9 }), kp: 6 }),
    );
    expect(result.verdict).toBe("caution");
    expect(result.reasons.length).toBe(2);
  });

  it("treats a missing forecast (day: null) as no weather-based factor, judging purely on Kp/twilight", () => {
    const allGood = assessOverallFlightConditions(
      input({ day: null, kp: 1, twilightStatus: "day" }),
    );
    expect(allGood).toEqual({ verdict: "go", reasons: [] });

    const kpFlag = assessOverallFlightConditions(input({ day: null, kp: 7 }));
    expect(kpFlag.verdict).toBe("caution");
  });

  it("treats a missing Kp reading (null) as unknown, not as a reason to flag", () => {
    const result = assessOverallFlightConditions(input({ kp: null }));
    expect(result).toEqual({ verdict: "go", reasons: [] });
  });
});
