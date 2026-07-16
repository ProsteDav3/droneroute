import { describe, it, expect } from "vitest";
import {
  getSunTimes,
  assessTwilightStatus,
  type SunTimes,
} from "./sunPosition";

// Prague, mid-summer — a location/date with a well-separated, unambiguous
// sunrise/sunset/twilight sequence.
const PRAGUE_LAT = 50.0755;
const PRAGUE_LNG = 14.4378;
const SUMMER_DATE = new Date("2026-07-15T12:00:00Z");

describe("getSunTimes", () => {
  it("returns a chronologically consistent sequence of sun events", () => {
    const t = getSunTimes(SUMMER_DATE, PRAGUE_LAT, PRAGUE_LNG);

    // Prague in mid-summer is nowhere near a latitude where any of these
    // events fail to occur, so non-null assertions are safe here.
    expect(t.civilDawn!.getTime()).toBeLessThan(t.sunrise!.getTime());
    expect(t.sunrise!.getTime()).toBeLessThan(
      t.morningGoldenHourEnd!.getTime(),
    );
    expect(t.morningGoldenHourEnd!.getTime()).toBeLessThan(
      t.solarNoon.getTime(),
    );
    expect(t.solarNoon.getTime()).toBeLessThan(
      t.eveningGoldenHourStart!.getTime(),
    );
    expect(t.eveningGoldenHourStart!.getTime()).toBeLessThan(
      t.sunset!.getTime(),
    );
    expect(t.sunset!.getTime()).toBeLessThan(t.civilDusk!.getTime());
  });

  it("sets morning golden hour to start at sunrise and evening golden hour to end at sunset", () => {
    const t = getSunTimes(SUMMER_DATE, PRAGUE_LAT, PRAGUE_LNG);

    expect(t.morningGoldenHourStart).toEqual(t.sunrise);
    expect(t.eveningGoldenHourEnd).toEqual(t.sunset);
  });
});

function sunTimesAround(nowIsoRef: string): SunTimes {
  // A fixed, well-separated set of sun events around a reference instant,
  // so assessTwilightStatus can be tested independently of the real
  // astronomical calculation.
  const ref = new Date(nowIsoRef).getTime();
  const hours = (h: number) => new Date(ref + h * 60 * 60 * 1000);
  return {
    sunrise: hours(-6),
    sunset: hours(6),
    solarNoon: hours(0),
    morningGoldenHourStart: hours(-6),
    morningGoldenHourEnd: hours(-5),
    eveningGoldenHourStart: hours(5),
    eveningGoldenHourEnd: hours(6),
    civilDawn: hours(-6.5),
    civilDusk: hours(6.5),
  };
}

describe("assessTwilightStatus", () => {
  const REF = "2026-07-15T12:00:00Z";
  const sun = sunTimesAround(REF);

  it("returns 'day' well inside civil daylight", () => {
    const now = new Date(REF); // solar noon
    expect(assessTwilightStatus(now, sun)).toBe("day");
  });

  it("returns 'near-twilight' shortly before civil dusk", () => {
    const now = new Date(sun.civilDusk!.getTime() - 10 * 60 * 1000);
    expect(assessTwilightStatus(now, sun)).toBe("near-twilight");
  });

  it("returns 'night' at or after civil dusk", () => {
    expect(assessTwilightStatus(sun.civilDusk!, sun)).toBe("night");
    const wellAfter = new Date(sun.civilDusk!.getTime() + 60 * 60 * 1000);
    expect(assessTwilightStatus(wellAfter, sun)).toBe("night");
  });

  it("returns 'night' before civil dawn and 'near-twilight' shortly after it", () => {
    const wellBefore = new Date(sun.civilDawn!.getTime() - 60 * 60 * 1000);
    expect(assessTwilightStatus(wellBefore, sun)).toBe("night");

    const shortlyAfter = new Date(sun.civilDawn!.getTime() + 10 * 60 * 1000);
    expect(assessTwilightStatus(shortlyAfter, sun)).toBe("near-twilight");
  });

  it("treats a null civilDusk/civilDawn (polar day/night edge case) as unknown rather than flagging night", () => {
    const polarSun: SunTimes = { ...sun, civilDusk: null, civilDawn: null };
    expect(assessTwilightStatus(new Date(REF), polarSun)).toBe("day");
  });
});
