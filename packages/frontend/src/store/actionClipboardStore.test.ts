import { describe, it, expect, beforeEach } from "vitest";
import {
  useActionClipboardStore,
  cloneActionsForPaste,
} from "./actionClipboardStore";
import type { WaypointAction } from "@droneroute/shared";

function action(actionId: number, hoverTime: number): WaypointAction {
  return {
    actionId,
    actionType: "hover",
    params: { hoverTime },
  };
}

describe("useActionClipboardStore", () => {
  beforeEach(() => {
    useActionClipboardStore.getState().clear();
  });

  it("starts empty", () => {
    expect(useActionClipboardStore.getState().actions).toBeNull();
  });

  it("copy stores a snapshot, not a live reference to the source array", () => {
    const source = [action(0, 5)];
    useActionClipboardStore.getState().copy(source);

    source.push(action(1, 10));

    expect(useActionClipboardStore.getState().actions).toHaveLength(1);
  });

  it("clear empties the clipboard", () => {
    useActionClipboardStore.getState().copy([action(0, 5)]);
    useActionClipboardStore.getState().clear();

    expect(useActionClipboardStore.getState().actions).toBeNull();
  });
});

describe("cloneActionsForPaste", () => {
  it("re-numbers actionId sequentially from 0, regardless of the source ids", () => {
    const cloned = cloneActionsForPaste([action(7, 5), action(12, 10)]);

    expect(cloned.map((a) => a.actionId)).toEqual([0, 1]);
  });

  it("deep-clones each action so mutating the result never affects the source", () => {
    const source = [action(0, 5)];
    const cloned = cloneActionsForPaste(source);

    (cloned[0].params as { hoverTime: number }).hoverTime = 999;

    expect((source[0].params as { hoverTime: number }).hoverTime).toBe(5);
  });

  it("returns an empty array for an empty input", () => {
    expect(cloneActionsForPaste([])).toEqual([]);
  });
});
