import { describe, it, expect } from "vitest";
import {
  validateMissionCreate,
  validateMissionUpdate,
  validateMissionGeometry,
} from "./missionValidation.js";

const validWaypoint = {
  index: 0,
  name: "WP1",
  latitude: 41.25,
  longitude: 0.93,
  height: 30,
  speed: 5,
  gimbalPitchAngle: 0,
};

const validCreate = {
  name: "Test mission",
  config: { autoFlightSpeed: 5 },
  waypoints: [validWaypoint, { ...validWaypoint, index: 1, longitude: 0.94 }],
  pois: [],
  obstacles: [],
};

describe("validateMissionCreate", () => {
  it("accepts a well-formed mission", () => {
    expect(validateMissionCreate(validCreate)).toBeNull();
  });

  it("rejects a missing or blank name", () => {
    expect(validateMissionCreate({ ...validCreate, name: "" })).toBe(
      "neplatný název mise",
    );
    expect(validateMissionCreate({ ...validCreate, name: "   " })).toBe(
      "neplatný název mise",
    );
    expect(validateMissionCreate({ ...validCreate, name: 123 })).toBe(
      "neplatný název mise",
    );
  });

  it("rejects an over-long name", () => {
    expect(
      validateMissionCreate({ ...validCreate, name: "x".repeat(201) }),
    ).toBe("neplatný název mise");
  });

  it("rejects a non-object config", () => {
    expect(validateMissionCreate({ ...validCreate, config: "nope" })).toBe(
      "neplatná konfigurace mise",
    );
    expect(validateMissionCreate({ ...validCreate, config: [1, 2] })).toBe(
      "neplatná konfigurace mise",
    );
  });

  it("rejects waypoints that are not an array", () => {
    expect(validateMissionCreate({ ...validCreate, waypoints: {} })).toBe(
      "waypoints musí být pole",
    );
  });

  it("rejects out-of-range coordinates", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, latitude: 91 }],
      }),
    ).toBe("souřadnice bodu trasy mimo rozsah");
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, longitude: 200 }],
      }),
    ).toBe("souřadnice bodu trasy mimo rozsah");
  });

  it("rejects non-finite coordinates (NaN / Infinity)", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, latitude: Number.NaN }],
      }),
    ).toBe("souřadnice bodu trasy mimo rozsah");
    expect(
      validateMissionCreate({
        ...validCreate,
        waypoints: [{ ...validWaypoint, height: Number.POSITIVE_INFINITY }],
      }),
    ).toBe("neplatná výška bodu trasy");
  });

  it("rejects too many waypoints (DoS guard)", () => {
    const waypoints = Array.from({ length: 5001 }, (_, i) => ({
      ...validWaypoint,
      index: i,
    }));
    expect(validateMissionCreate({ ...validCreate, waypoints })).toBe(
      "příliš mnoho bodů trasy",
    );
  });

  it("validates POIs and obstacles", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        pois: [{ name: "P", latitude: 200, longitude: 0, height: 1 }],
      }),
    ).toBe("souřadnice POI mimo rozsah");
    expect(
      validateMissionCreate({
        ...validCreate,
        obstacles: [{ name: "O", vertices: [[91, 0]] }],
      }),
    ).toBe("vrchol překážky mimo rozsah");
    expect(
      validateMissionCreate({
        ...validCreate,
        obstacles: [{ name: "O", vertices: [[41, 0, 5]] }],
      }),
    ).toBe("vrchol překážky mimo rozsah");
  });

  it("validates buildings", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        buildings: [{ name: "B", height: 20, vertices: [[91, 0]] }],
      }),
    ).toBe("vrchol budovy mimo rozsah");
    expect(
      validateMissionCreate({
        ...validCreate,
        buildings: [
          {
            name: "B",
            height: -5,
            vertices: [
              [41, 0],
              [41, 1],
              [42, 1],
            ],
          },
        ],
      }),
    ).toBe("neplatná výška budovy");
  });

  it("validates templateGroups", () => {
    expect(
      validateMissionCreate({
        ...validCreate,
        templateGroups: "not an object",
      }),
    ).toBe("templateGroups musí být objekt");

    expect(
      validateMissionCreate({
        ...validCreate,
        templateGroups: { g1: { type: "not-a-real-type", params: {} } },
      }),
    ).toBe("neplatný typ skupiny šablony");

    expect(
      validateMissionCreate({
        ...validCreate,
        templateGroups: { g1: { type: "orbit", params: "not an object" } },
      }),
    ).toBe("neplatné parametry skupiny šablony");

    expect(
      validateMissionCreate({
        ...validCreate,
        templateGroups: {
          g1: { type: "orbit", params: { blob: "x".repeat(30000) } },
        },
      }),
    ).toBe("parametry skupiny šablony jsou příliš velké");

    expect(
      validateMissionCreate({
        ...validCreate,
        templateGroups: {
          g1: { type: "orbit", params: { radiusM: 80 } },
        },
      }),
    ).toBeNull();
  });
});

describe("validateMissionUpdate", () => {
  it("accepts an empty partial update", () => {
    expect(validateMissionUpdate({})).toBeNull();
  });

  it("only validates fields that are present", () => {
    expect(validateMissionUpdate({ name: "New name" })).toBeNull();
    expect(validateMissionUpdate({ name: "" })).toBe("neplatný název mise");
    expect(validateMissionUpdate({ waypoints: "bad" })).toBe(
      "waypoints musí být pole",
    );
  });
});

describe("validateMissionGeometry", () => {
  it("accepts valid geometry without requiring name/config", () => {
    expect(
      validateMissionGeometry({ waypoints: validCreate.waypoints }),
    ).toBeNull();
  });

  it("rejects invalid geometry", () => {
    expect(
      validateMissionGeometry({
        waypoints: [{ ...validWaypoint, latitude: 999 }],
      }),
    ).toBe("souřadnice bodu trasy mimo rozsah");
  });
});
