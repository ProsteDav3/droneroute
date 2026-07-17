## Summary

The bulk-edit panel's height field could only set every selected waypoint to the same absolute altitude. Adding a new "Posunout výšku o" (shift height by) control lets you nudge a selection's heights up or down by a fixed amount while keeping their relative differences — useful after moving a scene's ground object when the flight profile itself is still correct.

## Changes

- New relative height offset field + "Použít" button in `BulkActionToolbar`, next to the existing absolute "Výška" field.
- Reuses the existing `setWaypointHeights` mission-store action (one undo-history entry for the whole selection) rather than looping `updateWaypoint` calls.
- Accepts negative values to lower a selection's height; clamps the result to a minimum of 1 m per waypoint.
