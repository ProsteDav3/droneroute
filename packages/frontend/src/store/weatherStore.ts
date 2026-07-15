import { create } from "zustand";
import type { WeatherForecastEntry } from "@droneroute/shared";
import { api } from "@/lib/api";

interface WeatherState {
  forecast: WeatherForecastEntry[];
  isLoading: boolean;
  cachedLat: number | null;
  cachedLng: number | null;
  fetchForLocation: (lat: number, lng: number) => Promise<void>;
}

/** Skip refetching when the requested location is within ~1km of the cached one. */
const SAME_LOCATION_TOLERANCE_DEG = 0.01;

export const useWeatherStore = create<WeatherState>((set, get) => ({
  forecast: [],
  isLoading: false,
  cachedLat: null,
  cachedLng: null,

  fetchForLocation: async (lat, lng) => {
    const { cachedLat, cachedLng, isLoading } = get();
    if (isLoading) return;
    if (
      cachedLat !== null &&
      cachedLng !== null &&
      Math.abs(cachedLat - lat) < SAME_LOCATION_TOLERANCE_DEG &&
      Math.abs(cachedLng - lng) < SAME_LOCATION_TOLERANCE_DEG
    ) {
      return;
    }

    set({ isLoading: true });
    try {
      const data = await api.get<{ forecast: WeatherForecastEntry[] }>(
        `/weather/forecast?lat=${lat}&lng=${lng}`,
      );
      set({ forecast: data.forecast, cachedLat: lat, cachedLng: lng });
    } catch (err) {
      console.error("Failed to fetch weather forecast:", err);
    } finally {
      set({ isLoading: false });
    }
  },
}));
