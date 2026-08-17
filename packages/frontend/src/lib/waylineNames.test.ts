import { describe, it, expect } from "vitest";
import { isSegmentWayline } from "./waylineNames";

describe("isSegmentWayline", () => {
  it("recognises the names SkyRoute gives segments", () => {
    expect(isSegmentWayline("KCP-seg-1-of-71")).toBe(true);
    expect(isSegmentWayline("KCP-seg-71-of-71")).toBe(true);
    expect(isSegmentWayline("KCP-seg-07-of-71")).toBe(true);
    expect(isSegmentWayline("KCP-seg-71-of-71-20260817-160029")).toBe(true);
  });

  it("recognises a name the 64-character limit shortened from the middle", () => {
    // Middle-truncation keeps both ends, so a long mission name can lose the
    // "-seg-N" part while the "-of-N" tail survives. Treating that as a whole
    // mission would leave orphaned segments behind on a bulk clean-up.
    expect(
      isSegmentWayline("Velmi-dlouhy-nazev-mise-ktery-se-nevesel-of-71"),
    ).toBe(true);
    expect(
      isSegmentWayline("Velmi-dlouhy-nazev-mise-of-71-20260817-160029"),
    ).toBe(true);
  });

  it("treats whole missions as whole missions", () => {
    expect(isSegmentWayline("KCP")).toBe(false);
    expect(isSegmentWayline("KCP-20260817-160023")).toBe(false);
    expect(isSegmentWayline("Petrovice-C9")).toBe(false);
    expect(isSegmentWayline("Chalupa")).toBe(false);
  });

  it("does not mistake an unrelated file for a segment", () => {
    // Uploaded from Pilot 2 or another tool — a bulk delete must not sweep
    // these up just because a number appears somewhere in the name.
    expect(isSegmentWayline("Inspekce-of-site-A")).toBe(false);
    expect(isSegmentWayline("segment")).toBe(false);
    expect(isSegmentWayline("of-71-uvodni-let")).toBe(false);
    expect(isSegmentWayline("KCP-seg-1-of-71-zaloha")).toBe(false);
  });
});
