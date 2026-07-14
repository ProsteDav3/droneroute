# Templates

Create common flight patterns automatically instead of placing waypoints one by one.

## What you can do

- **Orbit**: fly a circular path around a center point. Choose radius, number of waypoints, and direction (clockwise or counter-clockwise). By default it flies a full 360° loop, but you can set a start angle and an end angle below 360° to fly an open arc instead (for example 270°) — the first and last waypoints land exactly on the bearings you asked for.
- **Rotate an orbit by dragging**: once an orbit is placed, drag the handle marker sitting on its first waypoint around the circle to rotate the whole arc — its width stays the same, only where it starts changes. Faster than typing an exact start angle when you just want to visually pick which side of the circle to skip.
- **Center an orbit on an address or coordinates**: type an address or a `lat, lng` pair into the search field at the top of the orbit panel to move the orbit's center there directly, instead of only being able to place it by clicking the map.
- **Nudge the orbit center by dragging**: while the orbit panel is open (before clicking Apply), drag the handle marker on the center point to fine-tune its exact position — handy right after a location search puts you close but not exactly on the spot.
- **POI height and linked gimbal pitch**: set the real height of the point the camera should look at (e.g. a rooftop) in the orbit panel's POI height field. Flight altitude and gimbal pitch stay linked by default — edit either one and the other recalculates automatically from the radius and POI height, so you rarely need to compute the camera angle by hand. Click the lock icon next to gimbal pitch to freeze the two apart and edit them independently.
- **Pre-filled from a building**: place a POI on a drawn [building](buildings.md) and the orbit panel opens automatically with a center, radius, altitude, and gimbal pitch recommended for orbiting that building's footprint and height — adjust any field before applying, just like a manually placed orbit.
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry.
- **Facade scan**: fly a vertical scanning pattern along a building face. Useful for inspections.
- **Pencil path**: draw a freehand path on the map and the app places evenly spaced waypoints along it.
- **Solar panel survey**: trace the outline of a solar panel array (square, rectangle, or any other shape, including L-shaped or otherwise irregular fields) by clicking points on the map, then click near the first point (or double-click) to close the shape. The app generates a lawn-mower flight path clipped exactly to that outline — the drone never flies past the edges you traced. Flight lines automatically run parallel to the shape's longest edge, matching typical panel rows. Each waypoint gets a straight-down (nadir) gimbal and a thermal (IR) photo action by default, since this template is built for FVE/PV thermography flights.

## How it works

1. Select a template from the toolbar or press its shortcut key (O for orbit, G for grid, F for facade, Z for pencil, S for solar panel survey).
2. Configure the template options in the panel that appears.
3. For Orbit, Grid, and Facade: click-and-drag on the map to place the template. For Solar: click to place each boundary point, then click near the first point or double-click to close the shape. For Pencil: click-and-drag to draw a freehand path.
4. The generated waypoints appear in the sidebar and can be edited individually.

## Editing an already-applied template

Realized the orbit's radius was too small only after clicking Apply? You don't have to delete it and start over:

1. Select all the waypoints that came from that template (e.g. Ctrl+A / Cmd+A if they're the only waypoints, or Shift-click to select the range).
2. If the whole selection came from one template application, an **"Edit template"** button appears in the selection toolbar.
3. Click it to reopen that template's settings panel with its original values — adjust radius, spacing, altitude, or any other field, and the preview updates live, just like when you first placed it.
4. Click Apply again to replace the old waypoints with the updated ones (or Cancel to leave them as they were).

This works for Orbit, Grid, Facade, Pencil, and Solar. It does **not** survive saving and reloading a mission yet — after a save/reload, template-generated waypoints behave like any manually placed ones (still fully editable individually, just not as a re-adjustable group).

## Good to know

- You can combine templates — for example, use a grid survey and then add an orbit around a specific structure.
- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.
