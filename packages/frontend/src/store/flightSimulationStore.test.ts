import { describe, it, expect, beforeEach } from "vitest";
import { useFlightSimulationStore } from "./flightSimulationStore";

describe("useFlightSimulationStore", () => {
  beforeEach(() => {
    useFlightSimulationStore.getState().stop();
    useFlightSimulationStore.getState().setCameraMode("top");
  });

  it("defaults to top-down camera mode", () => {
    expect(useFlightSimulationStore.getState().cameraMode).toBe("top");
  });

  it("setCameraMode switches to flythrough", () => {
    useFlightSimulationStore.getState().setCameraMode("flythrough");

    expect(useFlightSimulationStore.getState().cameraMode).toBe("flythrough");
  });

  it("setCameraMode does not reset playback state", () => {
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().setPlayheadS(4);

    useFlightSimulationStore.getState().setCameraMode("flythrough");

    expect(useFlightSimulationStore.getState().playheadS).toBe(4);
    expect(useFlightSimulationStore.getState().isActive).toBe(true);
  });

  it("camera mode survives stop/start (it's a display preference, not per-run state)", () => {
    useFlightSimulationStore.getState().setCameraMode("flythrough");
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().stop();

    expect(useFlightSimulationStore.getState().cameraMode).toBe("flythrough");
  });

  it("start sets the real flight duration and begins playing when it's non-zero", () => {
    useFlightSimulationStore.getState().start(42);

    const state = useFlightSimulationStore.getState();
    expect(state.durationS).toBe(42);
    expect(state.playheadS).toBe(0);
    expect(state.isPlaying).toBe(true);
  });

  it("start with a zero duration does not start playing", () => {
    useFlightSimulationStore.getState().start(0);

    expect(useFlightSimulationStore.getState().isPlaying).toBe(false);
  });

  it("advancePlayhead moves the playhead forward without exceeding the duration", () => {
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().advancePlayhead(3);

    expect(useFlightSimulationStore.getState().playheadS).toBe(3);
  });

  it("advancePlayhead clamps to the duration and stops playback at the end", () => {
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().advancePlayhead(999);

    const state = useFlightSimulationStore.getState();
    expect(state.playheadS).toBe(10);
    expect(state.isPlaying).toBe(false);
  });

  it("setPlayheadS clamps to [0, durationS] and pauses (scrubbing)", () => {
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().setPlayheadS(999);

    expect(useFlightSimulationStore.getState().playheadS).toBe(10);
    expect(useFlightSimulationStore.getState().isPlaying).toBe(false);
  });

  it("togglePlay restarts from the beginning once the playhead reached the end", () => {
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().advancePlayhead(10);
    expect(useFlightSimulationStore.getState().isPlaying).toBe(false);

    useFlightSimulationStore.getState().togglePlay();

    const state = useFlightSimulationStore.getState();
    expect(state.isPlaying).toBe(true);
    expect(state.playheadS).toBe(0);
  });
});
