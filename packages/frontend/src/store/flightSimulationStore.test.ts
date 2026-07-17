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
    useFlightSimulationStore.getState().setFrameIndex(4);

    useFlightSimulationStore.getState().setCameraMode("flythrough");

    expect(useFlightSimulationStore.getState().frameIndex).toBe(4);
    expect(useFlightSimulationStore.getState().isActive).toBe(true);
  });

  it("camera mode survives stop/start (it's a display preference, not per-run state)", () => {
    useFlightSimulationStore.getState().setCameraMode("flythrough");
    useFlightSimulationStore.getState().start(10);
    useFlightSimulationStore.getState().stop();

    expect(useFlightSimulationStore.getState().cameraMode).toBe("flythrough");
  });
});
