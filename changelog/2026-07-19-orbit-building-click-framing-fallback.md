### Fixed

- Clicking a POI directly on a building to create an orbit (the "place a POI on a building" / "orbit this building" flow) still fell back to a fixed -45° gimbal pitch whenever the mission's selected drone had no known camera field of view — the same gap PR #126 fixed for the Orbit panel's own "Propojeno" linked editing, but in a separate code path (`orbitParamsForBuilding`) that wasn't covered by that fix. It now uses the same typical-wide-angle-lens fallback, so the whole building is framed by default here too, not just when editing the panel's fields afterward.
