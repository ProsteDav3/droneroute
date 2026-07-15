import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchForecast } from "./weather.js";

function metnoResponse(timeseries: any[], expiresInMs = 30 * 60 * 1000) {
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "expires"
          ? new Date(Date.now() + expiresInMs).toUTCString()
          : null,
    },
    json: async () => ({
      properties: { timeseries },
    }),
  };
}

const SAMPLE_ENTRY = {
  time: "2026-07-15T07:00:00Z",
  data: {
    instant: {
      details: {
        air_temperature: 19.2,
        wind_speed: 2.7,
        wind_from_direction: 6.6,
      },
    },
    next_1_hours: {
      summary: { symbol_code: "cloudy" },
      details: { precipitation_amount: 0.3 },
    },
    next_6_hours: {
      summary: { symbol_code: "partlycloudy_day" },
      details: { precipitation_amount: 0.7 },
    },
    next_12_hours: {
      summary: { symbol_code: "lightrain" },
      details: {},
    },
  },
};

describe("fetchForecast", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("maps a well-formed upstream response to the simplified shape", async () => {
    (fetch as any).mockResolvedValue(metnoResponse([SAMPLE_ENTRY]));

    const forecast = await fetchForecast(51.1, 20.1);

    expect(forecast).toEqual([
      {
        time: "2026-07-15T07:00:00Z",
        temperatureC: 19.2,
        windSpeedMs: 2.7,
        windFromDirectionDeg: 6.6,
        precipitationMm: 0.3, // prefers next_1_hours over next_6_hours
        symbolCode: "cloudy", // prefers next_1_hours over next_6_hours/next_12_hours
      },
    ]);
  });

  it("falls back to next_6_hours precipitation/symbol when next_1_hours has none", async () => {
    const entry = {
      ...SAMPLE_ENTRY,
      time: "2026-07-16T00:00:00Z",
      data: {
        ...SAMPLE_ENTRY.data,
        next_1_hours: undefined,
      },
    };
    (fetch as any).mockResolvedValue(metnoResponse([entry]));

    const forecast = await fetchForecast(52.2, 21.2);

    expect(forecast[0].precipitationMm).toBe(0.7);
    expect(forecast[0].symbolCode).toBe("partlycloudy_day");
  });

  it("falls back to next_12_hours symbol when neither next_1_hours nor next_6_hours has one", async () => {
    const entry = {
      time: "2026-07-17T00:00:00Z",
      data: {
        instant: { details: {} },
        next_12_hours: { summary: { symbol_code: "lightrain" }, details: {} },
      },
    };
    (fetch as any).mockResolvedValue(metnoResponse([entry]));

    const forecast = await fetchForecast(53.3, 22.3);

    expect(forecast[0].precipitationMm).toBeNull();
    expect(forecast[0].symbolCode).toBe("lightrain");
  });

  it("caches per-location responses and doesn't re-fetch within the TTL", async () => {
    (fetch as any).mockResolvedValue(metnoResponse([SAMPLE_ENTRY]));

    await fetchForecast(54.4, 23.4);
    await fetchForecast(54.4, 23.4);
    await fetchForecast(54.4001, 23.4001); // rounds to the same cache key

    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("treats nearby-but-distinct coordinates as separate cache entries", async () => {
    (fetch as any).mockResolvedValue(metnoResponse([SAMPLE_ENTRY]));

    await fetchForecast(55.5, 24.5);
    await fetchForecast(56.6, 25.6);

    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("falls back to the default TTL (rather than an instantly-expired or permanently-valid cache) when Expires is already in the past", async () => {
    (fetch as any).mockResolvedValue(
      metnoResponse([SAMPLE_ENTRY], -60 * 1000), // Expires: 1 minute ago
    );

    await fetchForecast(60.1, 29.1);
    await fetchForecast(60.1, 29.1);

    // If the past Expires had produced a negative/zero TTL, the second call
    // would see an already-expired cache entry and re-fetch. Falling back to
    // DEFAULT_TTL_MS means the second call is still a cache hit.
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("evicts the oldest cache entry once the 500-entry cap is reached", async () => {
    (fetch as any).mockResolvedValue(metnoResponse([SAMPLE_ENTRY]));

    // Fill the cache past its cap with distinct locations (spaced well
    // beyond the ~1km/0.01° cache-key rounding, so each is a separate entry).
    for (let i = 0; i < 501; i++) {
      await fetchForecast(i * 0.1, 30);
    }
    const callsAfterFilling = (fetch as any).mock.calls.length;

    // The very first location inserted should have been evicted — asking
    // for it again must be a cache miss (a fresh fetch call).
    await fetchForecast(0, 30);

    expect((fetch as any).mock.calls.length).toBe(callsAfterFilling + 1);
  });

  it("throws when the upstream response is not ok", async () => {
    (fetch as any).mockResolvedValue({ ok: false, status: 503 });

    await expect(fetchForecast(57.7, 26.7)).rejects.toThrow(
      "Weather provider returned 503",
    );
  });

  it("throws when the upstream response has no timeseries", async () => {
    (fetch as any).mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ properties: {} }),
    });

    await expect(fetchForecast(58.8, 27.8)).rejects.toThrow(
      "Unexpected response shape from weather provider",
    );
  });

  it("sends an identifying User-Agent header, as MET Norway's terms require", async () => {
    (fetch as any).mockResolvedValue(metnoResponse([SAMPLE_ENTRY]));

    await fetchForecast(59.9, 28.9);

    const [, options] = (fetch as any).mock.calls[0];
    expect(options.headers["User-Agent"]).toMatch(/DroneRoute/);
  });
});
