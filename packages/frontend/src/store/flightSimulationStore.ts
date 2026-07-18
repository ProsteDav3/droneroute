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
  /** Elapsed real flight time, seconds — the single source of truth for
   * playback position. A frame index (for the scrubber, or "which frame is
   * the top-down dot at") is derived by whichever component has the actual
   * frame list, via `findFrameBracket` in lib/flightSimulation.ts, not
   * stored here — frames are spaced evenly by distance within a leg, not by
   * time, so there's no fixed frames-per-second rate to track a raw index
   * against. */
  playheadS: number;
  /** Total real flight duration for the current mission, seconds — the
   * drone's own actual estimated flight time, not an arbitrary playback
   * length, so `1x` plays back exactly as fast as the mission would really
   * fly. */
  durationS: number;
  /** Playback speed multiplier: 1 plays at the drone's real-world pace, 2
   * twice as fast, 0.5 half as fast. */
  speed: number;
  cameraMode: SimulationCameraMode;
  start: (durationS: number) => void;
  stop: () => void;
  togglePlay: () => void;
  setPlayheadS: (playheadS: number) => void;
  setSpeed: (speed: number) => void;
  setCameraMode: (mode: SimulationCameraMode) => void;
  advancePlayhead: (deltaS: number) => void;
}

export const useFlightSimulationStore = create<FlightSimulationState>(
  (set, get) => ({
    isActive: false,
    isPlaying: false,
    playheadS: 0,
    durationS: 0,
    speed: 1,
    cameraMode: "top",

    start: (durationS) =>
      set({
        isActive: true,
        isPlaying: durationS > 0,
        playheadS: 0,
        durationS,
      }),

    stop: () =>
      set({ isActive: false, isPlaying: false, playheadS: 0, durationS: 0 }),

    togglePlay: () =>
      set((state) => {
        if (!state.isPlaying && state.playheadS >= state.durationS) {
          // Replay from the start when toggling play after reaching the end.
          return { isPlaying: true, playheadS: 0 };
        }
        return { isPlaying: !state.isPlaying };
      }),

    setPlayheadS: (playheadS) =>
      set((state) => ({
        playheadS: Math.max(0, Math.min(playheadS, state.durationS)),
        isPlaying: false,
      })),

    setSpeed: (speed) => set({ speed }),

    setCameraMode: (cameraMode) => set({ cameraMode }),

    advancePlayhead: (deltaS) => {
      const { playheadS, durationS } = get();
      const next = playheadS + deltaS;
      if (next >= durationS) {
        set({ playheadS: durationS, isPlaying: false });
      } else {
        set({ playheadS: next });
      }
    },
  }),
);
