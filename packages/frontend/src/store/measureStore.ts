import { create } from "zustand";

interface MeasureState {
  isActive: boolean;
  points: [number, number][];
  toggle: () => void;
  stop: () => void;
  addPoint: (point: [number, number]) => void;
  undoLastPoint: () => void;
  clear: () => void;
}

/**
 * Standalone ruler/area tool state — deliberately kept out of
 * `missionStore` since it never touches mission content (waypoints, POIs,
 * obstacles), just measures distances/areas on the map independently of
 * whatever mission is loaded.
 */
export const useMeasureStore = create<MeasureState>((set) => ({
  isActive: false,
  points: [],

  toggle: () =>
    set((state) => ({
      isActive: !state.isActive,
      points: state.isActive ? state.points : [],
    })),

  stop: () => set({ isActive: false }),

  addPoint: (point) => set((state) => ({ points: [...state.points, point] })),

  undoLastPoint: () => set((state) => ({ points: state.points.slice(0, -1) })),

  clear: () => set({ points: [] }),
}));
