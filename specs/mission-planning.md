# Mission planning

Plan a drone flight by placing waypoints on the map and configuring what the drone should do at each one.

## What you can do

- Place waypoints by clicking on the map.
- Move an existing waypoint to an address or exact coordinates by typing it into the search field in the waypoint's settings, instead of only being able to drag it on the map.
- Set altitude, speed, gimbal pitch (camera angle), and heading for each waypoint.
- Choose a heading mode: follow the flight path, set a fixed angle, smooth transition between angles, or aim toward a point of interest.
- Choose a turn mode: smooth curve, stop at the waypoint then continue, or fly through without stopping.
- Reorder waypoints by dragging them in the sidebar list.
- Reverse the whole route's flying order with one click ("Obrátit trasu" in the map toolbar) — the last waypoint becomes the first. Handy for time-lapse missions that should fly the same physical path back and forth.
- Select multiple waypoints at once (Ctrl+click, Shift+click, or Ctrl+A) and edit them all in bulk.
- Set a target flight duration for a selection of waypoints instead of a speed: enter how long that stretch of the route should take (in seconds) in the bulk-edit panel and click "Dopočítat rychlost" to have the speed for those waypoints computed backward from the selected path.
- Shift the height of a selection of waypoints relatively instead of setting them all to one value: the bulk-edit panel's "Posunout výšku o" field adds (or, with a negative number, subtracts) the same amount from each selected waypoint's own height, preserving whatever altitude differences they already had — unlike the "Výška" field next to it, which sets every selected waypoint to the same absolute height.
- See an estimated time-of-arrival badge next to each waypoint (after the first) in the sidebar list — how long into the flight the aircraft is expected to reach that point, accounting for cruise speed, hover actions, and turn/stop overhead, not just a naive distance/speed guess.
- Rename waypoints by double-clicking their name.
- Use a global speed for the whole flight, or set a different speed for each waypoint.
- Use a global altitude for the whole flight, or set a different altitude for each waypoint.
- Undo/redo any content edit (waypoints, POIs, obstacles, buildings, mission settings, applied templates) with Ctrl+Z / Ctrl+Shift+Z, or the undo/redo buttons in the map's top-left corner. Undo doesn't step through selection changes or tool-mode switches — only actual edits to the mission's content. Loading a different (or brand new) mission clears the undo history, since "undo" shouldn't jump back into a previous mission's content.
- If your browser tab closes or crashes with unsaved changes, reopening the editor offers to recover your last autosaved draft (saved automatically to your browser's local storage a couple of seconds after each edit). You can restore it or discard it — declining just dismisses the prompt without deleting the draft, in case you want to come back to it. Saving the mission for real clears the autosaved draft.

## How it works

1. Press **W** or click the waypoint button in the toolbar to enter waypoint mode.
2. Click on the map to place waypoints. They appear as numbered markers.
3. Click a waypoint in the sidebar or on the map to select it and open its settings.
4. Adjust altitude, speed, heading, and turn mode as needed.
5. Add actions to any waypoint (see below).

### Waypoint actions

At each waypoint, you can tell the drone to:

- **Take a photo**.
- **Start or stop recording** video.
- **Rotate the gimbal** to a specific angle.
- **Smooth gimbal movement** (gradual interpolation to a new angle).
- **Rotate the drone** (yaw) clockwise or counter-clockwise.
- **Hover** in place for a set number of seconds.
- **Zoom** to a specific focal length.
- **Focus** on a specific point or set to infinite focus.

## Good to know

- The flight path is drawn on the map as an animated dashed line. The animation speed reflects the drone's configured speed at each segment.
- You can mix manual waypoints with template-generated ones — they all work the same once placed. Template-generated waypoints have one extra trick: select them all and you can reopen and adjust the original template instead of redrawing it — see [Templates](templates.md#editing-an-already-applied-template).
- The sidebar shows an elevation graph so you can visualize altitude changes across the flight. It also overlays the real ground elevation beneath the path (from the map's terrain data) as a dashed line, so you can see at a glance whether the flight stays comfortably above the terrain — not just above the heights you configured.
- **Terrain following**: below the elevation graph, enter a target height and click "Použít" to recompute every waypoint's height so the flight maintains that clearance above the real ground the whole way — useful when your mission's height reference doesn't already track terrain on its own. Hidden for the "nad terénem" (above ground level) height mode, since the aircraft already does this live via its own sensors.
