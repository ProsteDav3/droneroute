import { create } from "zustand";
import { DEFAULT_MAP_VIEW, type MapViewState } from "@droneroute/shared";
import { api } from "@/lib/api";

interface ConfigState {
  selfHosted: boolean;
  /** True when the backend has a DJI Cloud platform configured (missions can be pushed straight to Pilot 2's Cloud tab). */
  djiCloudEnabled: boolean;
  googleClientId: string | null;
  mapboxToken: string;
  defaultMapView: MapViewState;
  loaded: boolean;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  selfHosted: true,
  djiCloudEnabled: false,
  googleClientId: null,
  mapboxToken: "",
  defaultMapView: DEFAULT_MAP_VIEW,
  loaded: false,

  fetchConfig: async () => {
    try {
      const res = await api.get<{
        selfHosted: boolean;
        djiCloudEnabled?: boolean;
        googleClientId?: string;
        mapboxToken?: string;
        defaultMapView?: MapViewState;
      }>("/config");
      set({
        selfHosted: res.selfHosted,
        djiCloudEnabled: res.djiCloudEnabled ?? false,
        googleClientId: res.googleClientId ?? null,
        mapboxToken: res.mapboxToken ?? "",
        defaultMapView: res.defaultMapView ?? DEFAULT_MAP_VIEW,
        loaded: true,
      });
    } catch {
      // Fallback to self-hosted if config endpoint fails
      set({
        selfHosted: true,
        djiCloudEnabled: false,
        googleClientId: null,
        mapboxToken: "",
        defaultMapView: DEFAULT_MAP_VIEW,
        loaded: true,
      });
    }
  },
}));
