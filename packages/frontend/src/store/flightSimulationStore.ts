import { create } from "zustand";

/** "top" mirrors the original behavior — a fixed overhead view with just a
 * moving dot + camera frustum. "flythrough" instead drives the map's own
 * camera (center/bearing/pitch/zoom) to chase the drone frame by frame, for
 * an actual 3D flyover instead of watching a marker crawl across a static
 * map. */
export type SimulationCameraMode = "top" | "flythrough";

interface FlightSimulationState {
  isActive: boolean;
  isPlaying: boolean;
  frameIndex: number;
  frameCount: number;
  /** Frames advanced per second while playing. */
  speed: number;
  cameraMode: SimulationCameraMode;
  start: (frameCount: number) => void;
  stop: () => void;
  togglePlay: () => void;
  setFrameIndex: (index: number) => void;
  setSpeed: (speed: number) => void;
  setCameraMode: (mode: SimulationCameraMode) => void;
  advanceFrame: () => void;
}

export const useFlightSimulationStore = create<FlightSimulationState>(
  (set, get) => ({
    isActive: false,
    isPlaying: false,
    frameIndex: 0,
    frameCount: 0,
    speed: 10,
    cameraMode: "top",

    start: (frameCount) =>
      set({
        isActive: true,
        isPlaying: frameCount > 1,
        frameIndex: 0,
        frameCount,
      }),

    stop: () =>
      set({ isActive: false, isPlaying: false, frameIndex: 0, frameCount: 0 }),

    togglePlay: () =>
      set((state) => {
        if (!state.isPlaying && state.frameIndex >= state.frameCount - 1) {
          // Replay from the start when toggling play after reaching the end.
          return { isPlaying: true, frameIndex: 0 };
        }
        return { isPlaying: !state.isPlaying };
      }),

    setFrameIndex: (index) =>
      set((state) => ({
        frameIndex: Math.max(0, Math.min(index, state.frameCount - 1)),
        isPlaying: false,
      })),

    setSpeed: (speed) => set({ speed }),

    setCameraMode: (cameraMode) => set({ cameraMode }),

    advanceFrame: () => {
      const { frameIndex, frameCount } = get();
      const next = frameIndex + 1;
      if (next >= frameCount) {
        set({ frameIndex: frameCount - 1, isPlaying: false });
      } else {
        set({ frameIndex: next });
      }
    },
  }),
);
