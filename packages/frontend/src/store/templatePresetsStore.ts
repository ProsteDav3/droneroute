import { create } from "zustand";
import type { TemplatePreset } from "@droneroute/shared";
import { api } from "@/lib/api";

interface TemplatePresetsState {
  presets: TemplatePreset[];
  isLoading: boolean;
  fetchPresets: () => Promise<void>;
  createPreset: (
    name: string,
    type: string,
    params: Record<string, unknown>,
  ) => Promise<void>;
  renamePreset: (id: string, name: string) => Promise<void>;
  removePreset: (id: string) => Promise<void>;
}

export const useTemplatePresetsStore = create<TemplatePresetsState>(
  (set, get) => ({
    presets: [],
    isLoading: false,

    fetchPresets: async () => {
      set({ isLoading: true });
      try {
        const presets = await api.get<TemplatePreset[]>("/template-presets");
        set({ presets });
      } catch (err) {
        console.error("Failed to fetch template presets:", err);
      } finally {
        set({ isLoading: false });
      }
    },

    createPreset: async (name, type, params) => {
      const created = await api.post<TemplatePreset>("/template-presets", {
        name,
        type,
        params,
      });
      set({ presets: [created, ...get().presets] });
    },

    renamePreset: async (id, name) => {
      await api.put(`/template-presets/${id}`, { name });
      set({
        presets: get().presets.map((p) => (p.id === id ? { ...p, name } : p)),
      });
    },

    removePreset: async (id) => {
      await api.delete(`/template-presets/${id}`);
      set({ presets: get().presets.filter((p) => p.id !== id) });
    },
  }),
);
