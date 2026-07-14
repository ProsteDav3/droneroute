## Summary

Draw a building's footprint (2-corner rectangle or a click-drawn polygon)
and height on the map. Placing a POI on it copies the height onto the POI
and pre-fills the Orbit template panel with a recommended radius,
altitude, and gimbal pitch — no more guessing an orbit radius by hand for
a rooftop inspection.

## Changes

- `Building` (shared type): `{ id, name, height, vertices }` — mirrors
  `Obstacle`'s shape, persisted per-mission the same way.
- `missionStore`:
  - New `buildings` array, `isDrawingBuilding` / `buildingDrawMode`
    ("rectangle" | "polygon") / `drawingBuildingVertices` state, and the
    matching CRUD + vertex-editing actions (`addBuilding`,
    `updateBuilding`, `removeBuilding`, `moveBuildingVertex`,
    `addBuildingVertex`, `removeBuildingVertex`, `selectBuilding`).
    Mutually exclusive with every other drawing mode, same as obstacles.
  - `addPoi()` now checks whether the new POI falls inside any building's
    footprint; if so, the POI's height is set to the building's height,
    and a new `pendingOrbitParams` field is seeded with a center (the
    footprint's centroid), radius (farthest corner from the centroid plus
    a 15m clearance), and altitude/gimbal pitch computed from the
    building's height via the existing `computeAltitudeForPitch` helper.
    This only pre-fills values — it does not generate any waypoints.
- `TemplateDrawHandler`: a new effect mirrors the existing
  "reopen an applied template" effect — when `pendingOrbitParams` is set,
  it loads those values into the Orbit panel with `confirmed = true`,
  switches to orbit mode, and clears the pending state, exactly as if you
  had dragged out an orbit by hand.
- `lib/templates.ts`: new `computeOrbitSeedForBuilding(vertices)` pure
  helper (centroid + half-diagonal-plus-clearance radius), reused by both
  the store and its tests.
- New `BuildingDrawHandler`, `BuildingPolygon`, and `BuildingList`
  components — footprint drawing (rectangle drag or click-to-place
  polygon, mirroring the obstacle-drawing pattern), map rendering with a
  height label, and a sidebar list with rename/height-edit/delete.
- Toolbar: a **"Building"** toggle (key **H**) with a Rect/Polygon
  sub-mode switch, next to the existing Obstacle button.
- Backend: `buildings` column + migration, validated the same way as
  obstacles (`missionValidation.ts`), persisted through mission
  create/update/list/get.

## Known limitations

- Buildings are a planning aid, like obstacles — they aren't exported in
  the generated KMZ and don't appear on the public shared-mission page.
- Placing a POI on a building only pre-fills the Orbit panel; it doesn't
  auto-generate or apply an orbit. You still open the Orbit template and
  click Apply.

## Tests

- `packages/frontend/src/lib/templates.test.ts`: `computeOrbitSeedForBuilding`
  centroid/radius correctness and winding-order invariance.
- `packages/frontend/src/store/missionStore.test.ts`: building CRUD,
  POI-on-building pre-fills `pendingOrbitParams` and copies height,
  POI away from any building leaves both untouched, and `clearMission`
  resets `pendingOrbitParams` (regression — this was missing initially
  and let a stale seed leak into the next mission).
- `packages/backend/src/services/missionValidation.test.ts`: building
  vertex range and height validation.
- `npm run build`, `npm run lint`, `npx prettier --check`,
  `npm run test -w packages/backend` (38/38),
  `npm run test -w packages/frontend` (22/22).
