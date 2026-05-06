import { create } from "zustand";
import { api } from "@/lib/api";

interface ConfigState {
  selfHosted: boolean;
  googleClientId: string | null;
  mapboxToken: string;
  loaded: boolean;
  fetchConfig: () => Promise<void>;
}

export const useConfigStore = create<ConfigState>((set) => ({
  selfHosted: true,
  googleClientId: null,
  mapboxToken: "",
  loaded: false,

  fetchConfig: async () => {
    try {
      const res = await api.get<{
        selfHosted: boolean;
        googleClientId?: string;
        mapboxToken?: string;
      }>("/config");
      set({
        selfHosted: res.selfHosted,
        googleClientId: res.googleClientId ?? null,
        mapboxToken: res.mapboxToken ?? "",
        loaded: true,
      });
    } catch {
      // Fallback to self-hosted if config endpoint fails
      set({
        selfHosted: true,
        googleClientId: null,
        mapboxToken: "",
        loaded: true,
      });
    }
  },
}));
