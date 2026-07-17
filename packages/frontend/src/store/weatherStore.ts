import { create } from "zustand";
import type { WeatherForecastEntry } from "@droneroute/shared";
import { api } from "@/lib/api";

/** Wind speed/direction at the altitude band closest to the mission's flight height — see backend/src/services/weather.ts. */
export interface WindAloftReading {
  time: string;
  altitudeM: number;
  windSpeedMs: number | null;
  windFromDirectionDeg: number | null;
}

/** Latest planetary Kp geomagnetic index reading — see backend/src/services/weather.ts. */
export interface KpReading {
  time: string;
  kp: number;
}

interface WeatherState {
  forecast: WeatherForecastEntry[];
  isLoading: boolean;
  cachedLat: number | null;
  cachedLng: number | null;
  fetchForLocation: (lat: number, lng: number) => Promise<void>;

  windAloft: WindAloftReading | null;
  isWindAloftLoading: boolean;
  cachedWindAloftLat: number | null;
  cachedWindAloftLng: number | null;
  cachedWindAloftHeightM: number | null;
  fetchWindAloft: (lat: number, lng: number, heightM: number) => Promise<void>;

  kp: KpReading | null;
  isKpLoading: boolean;
  kpFetchedAt: number | null;
  fetchKpIndex: () => Promise<void>;
}

/** Skip refetching when the requested location is within ~1km of the cached one. */
const SAME_LOCATION_TOLERANCE_DEG = 0.01;
/** Skip refetching wind-aloft data when the flight height changed by less than this — the 80/120/180m bands are coarse enough that small height edits don't need a fresh request. */
const SAME_HEIGHT_TOLERANCE_M = 5;
/** Client-side floor between Kp requests, complementing the backend's own ~45min cache — the reading only updates a few times a day. */
const KP_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

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

  windAloft: null,
  isWindAloftLoading: false,
  cachedWindAloftLat: null,
  cachedWindAloftLng: null,
  cachedWindAloftHeightM: null,

  fetchWindAloft: async (lat, lng, heightM) => {
    const {
      isWindAloftLoading,
      cachedWindAloftLat,
      cachedWindAloftLng,
      cachedWindAloftHeightM,
    } = get();
    if (isWindAloftLoading) return;
    if (
      cachedWindAloftLat !== null &&
      cachedWindAloftLng !== null &&
      cachedWindAloftHeightM !== null &&
      Math.abs(cachedWindAloftLat - lat) < SAME_LOCATION_TOLERANCE_DEG &&
      Math.abs(cachedWindAloftLng - lng) < SAME_LOCATION_TOLERANCE_DEG &&
      Math.abs(cachedWindAloftHeightM - heightM) < SAME_HEIGHT_TOLERANCE_M
    ) {
      return;
    }

    set({ isWindAloftLoading: true });
    try {
      const data = await api.get<{ windAloft: WindAloftReading }>(
        `/weather/wind-aloft?lat=${lat}&lng=${lng}&heightM=${heightM}`,
      );
      set({
        windAloft: data.windAloft,
        cachedWindAloftLat: lat,
        cachedWindAloftLng: lng,
        cachedWindAloftHeightM: heightM,
      });
    } catch (err) {
      console.error("Failed to fetch wind-aloft data:", err);
    } finally {
      set({ isWindAloftLoading: false });
    }
  },

  kp: null,
  isKpLoading: false,
  kpFetchedAt: null,

  fetchKpIndex: async () => {
    const { isKpLoading, kpFetchedAt } = get();
    if (isKpLoading) return;
    if (
      kpFetchedAt !== null &&
      Date.now() - kpFetchedAt < KP_REFRESH_INTERVAL_MS
    ) {
      return;
    }

    set({ isKpLoading: true });
    try {
      const data = await api.get<{ kp: KpReading }>("/weather/kp-index");
      set({ kp: data.kp, kpFetchedAt: Date.now() });
    } catch (err) {
      console.error("Failed to fetch Kp index:", err);
    } finally {
      set({ isKpLoading: false });
    }
  },
}));
