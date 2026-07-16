import { describe, it, expect } from "vitest";
import { computeWeatherGoNoGo, mitigationLabel } from "./preflightChecklist";

describe("computeWeatherGoNoGo", () => {
  it("returns unknown when no forecast entry is available", () => {
    const result = computeWeatherGoNoGo(null);
    expect(result.status).toBe("unknown");
  });

  it("returns go when wind and precipitation are within limits", () => {
    const result = computeWeatherGoNoGo({
      time: "2026-07-16T10:00:00Z",
      temperatureC: 20,
      windSpeedMs: 3,
      windFromDirectionDeg: 180,
      precipitationMm: 0,
      symbolCode: "clearsky_day",
    });
    expect(result.status).toBe("go");
  });

  it("returns no-go when wind exceeds the threshold", () => {
    const result = computeWeatherGoNoGo({
      time: "2026-07-16T10:00:00Z",
      temperatureC: 20,
      windSpeedMs: 15,
      windFromDirectionDeg: 180,
      precipitationMm: 0,
      symbolCode: "clearsky_day",
    });
    expect(result.status).toBe("no-go");
    expect(result.reasons.join(" ")).toMatch(/Vítr/);
  });

  it("returns caution (not no-go) for light precipitation alone", () => {
    const result = computeWeatherGoNoGo({
      time: "2026-07-16T10:00:00Z",
      temperatureC: 15,
      windSpeedMs: 3,
      windFromDirectionDeg: 180,
      precipitationMm: 1.5,
      symbolCode: "rain",
    });
    expect(result.status).toBe("caution");
  });
});

describe("mitigationLabel", () => {
  it("returns the Czech label for a known mitigation value", () => {
    expect(mitigationLabel("ground_observer")).toBe("Pozorovatel na zemi");
  });

  it("falls back to the raw value for an unknown mitigation", () => {
    expect(mitigationLabel("something_else")).toBe("something_else");
  });
});
