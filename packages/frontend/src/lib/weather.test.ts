import { describe, it, expect } from "vitest";
import { groupForecastByDay, symbolLabel, symbolIconKey } from "./weather";
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
    expect(symbolLabel("lightrainshowers_day")).toBe("Light rain showers");
    expect(symbolLabel("clearsky_night")).toBe("Clear sky");
  });

  it("falls back to the raw (suffix-stripped) code for an unmapped symbol", () => {
    expect(symbolLabel("some_exotic_condition_day")).toBe(
      "some_exotic_condition",
    );
  });

  it("returns 'Unknown' for null", () => {
    expect(symbolLabel(null)).toBe("Unknown");
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
