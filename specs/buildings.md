# Buildings

Draw building footprints on the map so the app can recommend orbit settings automatically instead of guessing radius and altitude by hand.

## What you can do

- Draw a building's footprint either as a 2-corner rectangle or by clicking out an irregular polygon, and set its real height. Each edge shows its real length on the map as you draw, so you know the actual footprint dimensions before committing to them.
- Every drawn building keeps showing each edge's real length on the map after it's placed, too — not just while drawing — so you can always see a building's actual side dimensions at a glance.
- See a list of all buildings in the sidebar, with area and height, and edit or delete them.
- Place a point of interest (POI) on a building to have its height copied automatically, and to pre-fill the Orbit template panel with a recommended flight altitude, radius, and gimbal pitch for orbiting that building — instead of typing those numbers in by hand.
- Click the orbit icon next to a building in the sidebar list for the same pre-filled Orbit panel directly, without placing a POI first.
- Click an extruded 3D building on the map (from OpenStreetMap data, at zoom 14+) and choose **Převést na budovu** in the popup to add it as a building without drawing it by hand — its footprint and height come straight from the map data.
- Large complexes are often split into several separate footprints in OpenStreetMap. Hold **Shift** and click each adjacent fragment to add it to the selection, then choose **Sloučit a převést na budovu** to merge them into one accurate building outline (a true polygon union, not just a bounding box) instead of converting each fragment one at a time. The merged building's height is the tallest of the selected fragments.

## How it works

1. Press **H** or click the "Building" button in the toolbar to enter building drawing mode.
2. Choose **Rect** (click-and-drag two opposite corners) or **Polygon** (click to place each corner, then click near the first point or double-click to close the shape).
3. Enter the building's height in the panel that appears, then click Apply.
4. To create an orbit around it, either:
   - Click the orbit icon next to that building in the sidebar list, or
   - Switch to **Add POI** (press **P**) and click somewhere inside the building's footprint. The new POI's height is set to the building's height.

   Either way, the Orbit template panel opens pre-filled with a center, radius, altitude, and gimbal pitch recommended for orbiting that building — adjust any of these before applying, exactly as with a manually placed orbit.

## Good to know

- The recommended radius clears every corner of the footprint (not just a bounding box average), plus a safety margin, so it works for rotated or non-rectangular buildings too.
- Placing a POI on a building only pre-fills the Orbit panel's values — it does not generate a flight path automatically. You still need to open the Orbit template and click Apply.
- Buildings are a planning aid, similar to [obstacles](obstacles.md) — they don't generate a flight path themselves and aren't included in the exported KMZ.
