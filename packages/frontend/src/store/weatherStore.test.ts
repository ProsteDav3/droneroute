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

function resetStore() {
  useWeatherStore.setState({
    forecast: [],
    isLoading: false,
    cachedLat: null,
    cachedLng: null,
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
