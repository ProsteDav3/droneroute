import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  useOnboardingStore,
  hasTourCompleted,
  TOUR_STEPS,
} from "./onboardingStore";

// The frontend test environment is plain Node (no jsdom), which has no
// localStorage global — stub a minimal in-memory implementation since
// onboardingStore reads/writes it directly (matches authStore.test.ts).
function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    clear: () => data.clear(),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  } as Storage;
}

describe("useOnboardingStore", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    useOnboardingStore.setState({ active: false, stepIndex: 0 });
  });

  it("starts inactive", () => {
    expect(useOnboardingStore.getState().active).toBe(false);
  });

  it("start activates the tour at step 0", () => {
    useOnboardingStore.getState().start();

    expect(useOnboardingStore.getState()).toMatchObject({
      active: true,
      stepIndex: 0,
    });
  });

  it("next advances the step index", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().next();

    expect(useOnboardingStore.getState().stepIndex).toBe(1);
  });

  it("prev never goes below step 0", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().prev();

    expect(useOnboardingStore.getState().stepIndex).toBe(0);
  });

  it("next on the last step finishes the tour and marks it completed", () => {
    useOnboardingStore.setState({
      active: true,
      stepIndex: TOUR_STEPS.length - 1,
    });

    useOnboardingStore.getState().next();

    expect(useOnboardingStore.getState().active).toBe(false);
    expect(hasTourCompleted()).toBe(true);
  });

  it("stop ends the tour early and still marks it completed", () => {
    useOnboardingStore.getState().start();
    useOnboardingStore.getState().next();
    useOnboardingStore.getState().stop();

    expect(useOnboardingStore.getState()).toMatchObject({
      active: false,
      stepIndex: 0,
    });
    expect(hasTourCompleted()).toBe(true);
  });

  it("hasTourCompleted is false until the tour is stopped or finished", () => {
    expect(hasTourCompleted()).toBe(false);
  });
});
