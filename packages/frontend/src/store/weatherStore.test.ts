import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWeatherStore } from "./weatherStore";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);

const SAMPLE_FORECAST = [
  {
    time: "2026-07-15T07:00:00Z",
    temperatureC: 20,
    windSpeedMs: 3,
    windFromDirectionDeg: 180,
    precipitationMm: 0,
    symbolCode: "cloudy",
  },
];

const SAMPLE_WIND_ALOFT = {
  time: "2026-07-15T08:00:00Z",
  altitudeM: 80,
  windSpeedMs: 4.2,
  windFromDirectionDeg: 190,
};

const SAMPLE_KP = { time: "2026-07-15 06:00:00.000", kp: 3.33 };

function resetStore() {
  useWeatherStore.setState({
    forecast: [],
    isLoading: false,
    cachedLat: null,
    cachedLng: null,
    windAloft: null,
    isWindAloftLoading: false,
    cachedWindAloftLat: null,
    cachedWindAloftLng: null,
    cachedWindAloftHeightM: null,
    kp: null,
    isKpLoading: false,
    kpFetchedAt: null,
  });
}

describe("weatherStore", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("fetches and stores the forecast for a new location", async () => {
    mockedApi.get.mockResolvedValue({ forecast: SAMPLE_FORECAST });

    await useWeatherStore.getState().fetchForLocation(50.06, 14.43);

    expect(mockedApi.get).toHaveBeenCalledWith(
      "/weather/forecast?lat=50.06&lng=14.43",
    );
    expect(useWeatherStore.getState().forecast).toEqual(SAMPLE_FORECAST);
  });

  it("does not refetch when called again for a location within tolerance", async () => {
    mockedApi.get.mockResolvedValue({ forecast: SAMPLE_FORECAST });

    await useWeatherStore.getState().fetchForLocation(50.06, 14.43);
    await useWeatherStore.getState().fetchForLocation(50.0601, 14.4301);

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it("refetches when called for a location outside tolerance", async () => {
    mockedApi.get.mockResolvedValue({ forecast: SAMPLE_FORECAST });

    await useWeatherStore.getState().fetchForLocation(50.06, 14.43);
    await useWeatherStore.getState().fetchForLocation(51.5, 15.5);

    expect(mockedApi.get).toHaveBeenCalledTimes(2);
  });

  it("resets isLoading to false even when the request fails, and logs instead of throwing", async () => {
    mockedApi.get.mockRejectedValue(new Error("network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      useWeatherStore.getState().fetchForLocation(50.06, 14.43),
    ).resolves.toBeUndefined();

    expect(useWeatherStore.getState().isLoading).toBe(false);
    expect(useWeatherStore.getState().forecast).toEqual([]);
    consoleSpy.mockRestore();
  });

  it("skips a concurrent call while a fetch is already in flight", async () => {
    let resolveFetch!: (value: { forecast: typeof SAMPLE_FORECAST }) => void;
    mockedApi.get.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const first = useWeatherStore.getState().fetchForLocation(50.06, 14.43);
    // Fires while the first call is still pending (isLoading is already true).
    const second = useWeatherStore.getState().fetchForLocation(60, 20);

    resolveFetch({ forecast: SAMPLE_FORECAST });
    await Promise.all([first, second]);

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });
});

describe("weatherStore.fetchWindAloft", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("fetches and stores wind-aloft data for a new location/height", async () => {
    mockedApi.get.mockResolvedValue({ windAloft: SAMPLE_WIND_ALOFT });

    await useWeatherStore.getState().fetchWindAloft(50.06, 14.43, 80);

    expect(mockedApi.get).toHaveBeenCalledWith(
      "/weather/wind-aloft?lat=50.06&lng=14.43&heightM=80",
    );
    expect(useWeatherStore.getState().windAloft).toEqual(SAMPLE_WIND_ALOFT);
  });

  it("does not refetch for the same location and a height within tolerance", async () => {
    mockedApi.get.mockResolvedValue({ windAloft: SAMPLE_WIND_ALOFT });

    await useWeatherStore.getState().fetchWindAloft(50.06, 14.43, 80);
    await useWeatherStore.getState().fetchWindAloft(50.06, 14.43, 82);

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it("refetches when the height changes beyond tolerance", async () => {
    mockedApi.get.mockResolvedValue({ windAloft: SAMPLE_WIND_ALOFT });

    await useWeatherStore.getState().fetchWindAloft(50.06, 14.43, 80);
    await useWeatherStore.getState().fetchWindAloft(50.06, 14.43, 150);

    expect(mockedApi.get).toHaveBeenCalledTimes(2);
  });

  it("resets isWindAloftLoading to false and logs instead of throwing on failure", async () => {
    mockedApi.get.mockRejectedValue(new Error("network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      useWeatherStore.getState().fetchWindAloft(50.06, 14.43, 80),
    ).resolves.toBeUndefined();

    expect(useWeatherStore.getState().isWindAloftLoading).toBe(false);
    expect(useWeatherStore.getState().windAloft).toBeNull();
    consoleSpy.mockRestore();
  });
});

describe("weatherStore.fetchKpIndex", () => {
  beforeEach(() => {
    resetStore();
    vi.clearAllMocks();
  });

  it("fetches and stores the latest Kp reading", async () => {
    mockedApi.get.mockResolvedValue({ kp: SAMPLE_KP });

    await useWeatherStore.getState().fetchKpIndex();

    expect(mockedApi.get).toHaveBeenCalledWith("/weather/kp-index");
    expect(useWeatherStore.getState().kp).toEqual(SAMPLE_KP);
  });

  it("does not refetch again within the client-side refresh interval", async () => {
    mockedApi.get.mockResolvedValue({ kp: SAMPLE_KP });

    await useWeatherStore.getState().fetchKpIndex();
    await useWeatherStore.getState().fetchKpIndex();

    expect(mockedApi.get).toHaveBeenCalledTimes(1);
  });

  it("resets isKpLoading to false and logs instead of throwing on failure", async () => {
    mockedApi.get.mockRejectedValue(new Error("network error"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      useWeatherStore.getState().fetchKpIndex(),
    ).resolves.toBeUndefined();

    expect(useWeatherStore.getState().isKpLoading).toBe(false);
    expect(useWeatherStore.getState().kp).toBeNull();
    consoleSpy.mockRestore();
  });
});
