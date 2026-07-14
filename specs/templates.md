# Templates

Create common flight patterns automatically instead of placing waypoints one by one.

## What you can do

- **Orbit**: fly a circular path around a center point. Choose radius, number of waypoints, and direction (clockwise or counter-clockwise). By default it flies a full 360° loop, but you can set a start angle and an end angle below 360° to fly an open arc instead (for example 270°) — the first and last waypoints land exactly on the bearings you asked for.
- **Rotate an orbit by dragging**: once an orbit is placed, drag the handle marker sitting on its first waypoint around the circle to rotate the whole arc — its width stays the same, only where it starts changes. Faster than typing an exact start angle when you just want to visually pick which side of the circle to skip.
- **Center an orbit on an address or coordinates**: type an address or a `lat, lng` pair into the search field at the top of the orbit panel to move the orbit's center there directly, instead of only being able to place it by clicking the map.
- **Grid survey**: fly a back-and-forth zigzag pattern over an area. Useful for mapping or photogrammetry.
- **Facade scan**: fly a vertical scanning pattern along a building face. Useful for inspections.
- **Pencil path**: draw a freehand path on the map and the app places evenly spaced waypoints along it.

## How it works

1. Select a template from the toolbar or press its shortcut key (O for orbit, G for grid, F for facade, Z for pencil).
2. Configure the template options in the panel that appears.
3. Click on the map to place the template.
4. The generated waypoints appear in the sidebar and can be edited individually.

## Good to know

- You can combine templates — for example, use a grid survey and then add an orbit around a specific structure.
- All generated waypoints behave like normal waypoints after placement. You can move, delete, or change their settings.
