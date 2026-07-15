import { describe, it, expect } from "vitest";
import {
  groupForecastByDay,
  symbolLabel,
  symbolIconKey,
  assessFlightConditions,
  type DailyForecast,
} from "./weather";
import type { WeatherForecastEntry } from "@droneroute/shared";

function entry(
  time: string,
  overrides: Partial<WeatherForecastEntry> = {},
): WeatherForecastEntry {
  return {
    time,
    temperatureC: 20,
    windSpeedMs: 3,
    windFromDirectionDeg: 180,
    precipitationMm: 0,
    symbolCode: "cloudy",
    ...overrides,
  };
}

describe("groupForecastByDay", () => {
  it("groups entries by their UTC calendar day", () => {
    const days = groupForecastByDay([
      entry("2026-07-15T07:00:00Z"),
      entry("2026-07-15T12:00:00Z"),
      entry("2026-07-16T00:00:00Z"),
    ]);
    expect(days.map((d) => d.date)).toEqual(["2026-07-15", "2026-07-16"]);
  });

  it("computes min/max temperature, max wind, and total precipitation per day", () => {
    const days = groupForecastByDay([
      entry("2026-07-15T06:00:00Z", {
        temperatureC: 15,
        windSpeedMs: 2,
        precipitationMm: 0.5,
      }),
      entry("2026-07-15T12:00:00Z", {
        temperatureC: 25,
        windSpeedMs: 6,
        precipitationMm: 1.2,
      }),
      entry("2026-07-15T18:00:00Z", {
        temperatureC: 20,
        windSpeedMs: 4,
        precipitationMm: 0,
      }),
    ]);
    expect(days).toHaveLength(1);
    expect(days[0].minTempC).toBe(15);
    expect(days[0].maxTempC).toBe(25);
    expect(days[0].maxWindSpeedMs).toBe(6);
    expect(days[0].totalPrecipitationMm).toBeCloseTo(1.7);
  });

  it("prefers the midday (12:00) entry's symbol as the day's representative symbol", () => {
    const days = groupForecastByDay([
      entry("2026-07-15T06:00:00Z", { symbolCode: "cloudy" }),
      entry("2026-07-15T12:00:00Z", { symbolCode: "rain" }),
      entry("2026-07-15T18:00:00Z", { symbolCode: "clearsky_day" }),
    ]);
    expect(days[0].symbolCode).toBe("rain");
  });

  it("falls back to any non-null symbol when there's no midday entry", () => {
    const days = groupForecastByDay([
      entry("2026-07-15T06:00:00Z", { symbolCode: null }),
      entry("2026-07-15T09:00:00Z", { symbolCode: "fog" }),
    ]);
    expect(days[0].symbolCode).toBe("fog");
  });

  it("returns null aggregates for a day with no non-null values, without crashing", () => {
    const days = groupForecastByDay([
      entry("2026-07-15T06:00:00Z", {
        temperatureC: null,
        windSpeedMs: null,
        precipitationMm: null,
        symbolCode: null,
      }),
    ]);
    expect(days[0].minTempC).toBeNull();
    expect(days[0].maxTempC).toBeNull();
    expect(days[0].maxWindSpeedMs).toBeNull();
    expect(days[0].totalPrecipitationMm).toBeNull();
    expect(days[0].symbolCode).toBeNull();
  });

  it("returns days sorted chronologically regardless of input order", () => {
    const days = groupForecastByDay([
      entry("2026-07-17T00:00:00Z"),
      entry("2026-07-15T00:00:00Z"),
      entry("2026-07-16T00:00:00Z"),
    ]);
    expect(days.map((d) => d.date)).toEqual([
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
    ]);
  });
});

describe("symbolLabel", () => {
  it("returns a known human-readable label for a common symbol code", () => {
    expect(symbolLabel("lightrainshowers_day")).toBe("Slabé přeháňky");
    expect(symbolLabel("clearsky_night")).toBe("Jasno");
  });

  it("falls back to the raw (suffix-stripped) code for an unmapped symbol", () => {
    expect(symbolLabel("some_exotic_condition_day")).toBe(
      "some_exotic_condition",
    );
  });

  it("returns 'Neznámé' for null", () => {
    expect(symbolLabel(null)).toBe("Neznámé");
  });
});

describe("symbolIconKey", () => {
  it("classifies rain, snow/sleet, fog, clear, and default conditions", () => {
    expect(symbolIconKey("lightrainshowers_day")).toBe("rain");
    expect(symbolIconKey("heavysnow")).toBe("snow");
    expect(symbolIconKey("sleet")).toBe("snow");
    expect(symbolIconKey("fog")).toBe("fog");
    expect(symbolIconKey("clearsky_day")).toBe("sun");
    expect(symbolIconKey("fair_night")).toBe("sun");
    expect(symbolIconKey("cloudy")).toBe("cloud");
    expect(symbolIconKey(null)).toBe("cloud");
  });
});

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

describe("assessFlightConditions", () => {
  it("returns 'go' with no reasons for calm, dry, mild conditions", () => {
    expect(assessFlightConditions(day())).toEqual({
      verdict: "go",
      reasons: [],
    });
  });

  it("returns 'no-go' for a thunderstorm regardless of otherwise-calm conditions", () => {
    const result = assessFlightConditions(
      day({ symbolCode: "rainandthunder" }),
    );
    expect(result.verdict).toBe("no-go");
    expect(result.reasons).toContain("Bouřka");
  });

  it("returns 'no-go' for wind above the no-go threshold", () => {
    const result = assessFlightConditions(day({ maxWindSpeedMs: 15 }));
    expect(result.verdict).toBe("no-go");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("returns 'caution' (not 'no-go') for moderately strong wind", () => {
    const result = assessFlightConditions(day({ maxWindSpeedMs: 9 }));
    expect(result.verdict).toBe("caution");
  });

  it("returns 'no-go' for extreme cold or heat", () => {
    expect(assessFlightConditions(day({ minTempC: -20 })).verdict).toBe(
      "no-go",
    );
    expect(assessFlightConditions(day({ maxTempC: 45 })).verdict).toBe("no-go");
  });

  it("returns 'no-go' for heavy precipitation and 'caution' for light precipitation", () => {
    expect(
      assessFlightConditions(day({ totalPrecipitationMm: 5 })).verdict,
    ).toBe("no-go");
    expect(
      assessFlightConditions(day({ totalPrecipitationMm: 1 })).verdict,
    ).toBe("caution");
  });

  it("a no-go reason is never downgraded by an additional caution-level factor, and both reasons are surfaced", () => {
    const result = assessFlightConditions(
      day({ maxWindSpeedMs: 15, totalPrecipitationMm: 1 }),
    );
    expect(result.verdict).toBe("no-go");
    expect(result.reasons.length).toBe(2);
  });

  it("lands exactly on the threshold boundaries as documented (caution, not no-go, at the no-go threshold itself)", () => {
    // Wind: caution starts at 8, no-go starts strictly above 12.
    expect(assessFlightConditions(day({ maxWindSpeedMs: 7.9 })).verdict).toBe(
      "go",
    );
    expect(assessFlightConditions(day({ maxWindSpeedMs: 8 })).verdict).toBe(
      "caution",
    );
    expect(assessFlightConditions(day({ maxWindSpeedMs: 12 })).verdict).toBe(
      "caution",
    );
    expect(assessFlightConditions(day({ maxWindSpeedMs: 12.1 })).verdict).toBe(
      "no-go",
    );

    // Precipitation: caution starts at 0.5, no-go starts at 2.5 (inclusive).
    expect(
      assessFlightConditions(day({ totalPrecipitationMm: 0.4 })).verdict,
    ).toBe("go");
    expect(
      assessFlightConditions(day({ totalPrecipitationMm: 0.5 })).verdict,
    ).toBe("caution");
    expect(
      assessFlightConditions(day({ totalPrecipitationMm: 2.5 })).verdict,
    ).toBe("no-go");

    // Temperature: no caution band — go right up to the boundary, no-go strictly beyond it.
    expect(assessFlightConditions(day({ minTempC: -10 })).verdict).toBe("go");
    expect(assessFlightConditions(day({ minTempC: -10.1 })).verdict).toBe(
      "no-go",
    );
    expect(assessFlightConditions(day({ maxTempC: 40 })).verdict).toBe("go");
    expect(assessFlightConditions(day({ maxTempC: 40.1 })).verdict).toBe(
      "no-go",
    );
  });

  it("treats null forecast fields as unknown, not as a reason to flag", () => {
    const result = assessFlightConditions(
      day({
        maxWindSpeedMs: null,
        minTempC: null,
        maxTempC: null,
        totalPrecipitationMm: null,
        symbolCode: null,
      }),
    );
    expect(result).toEqual({ verdict: "go", reasons: [] });
  });
});
