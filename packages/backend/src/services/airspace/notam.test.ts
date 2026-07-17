import { describe, it, expect, vi, afterEach } from "vitest";
import { buildNotamBriefingLink } from "./notam.js";

describe("buildNotamBriefingLink", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the official IBS URL and the bbox center", () => {
    const link = buildNotamBriefingLink({
      south: 49,
      west: 14,
      north: 50,
      east: 16,
    });

    expect(link.url).toBe("https://ibs.rlp.cz/");
    expect(link.center).toEqual({ lat: 49.5, lng: 15 });
  });

  it("uses the provided ISO date when valid", () => {
    const link = buildNotamBriefingLink(
      { south: 49, west: 14, north: 50, east: 16 },
      "2026-08-01",
    );
    expect(link.date).toBe("2026-08-01");
  });

  it("falls back to today when the date is missing or invalid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-16T12:00:00Z"));

    const noDate = buildNotamBriefingLink({
      south: 49,
      west: 14,
      north: 50,
      east: 16,
    });
    expect(noDate.date).toBe("2026-07-16");

    const badDate = buildNotamBriefingLink(
      { south: 49, west: 14, north: 50, east: 16 },
      "not-a-date",
    );
    expect(badDate.date).toBe("2026-07-16");
  });

  it("includes an explanatory note about why this isn't live data", () => {
    const link = buildNotamBriefingLink({
      south: 49,
      west: 14,
      north: 50,
      east: 16,
    });
    expect(link.note.length).toBeGreaterThan(0);
  });
});
