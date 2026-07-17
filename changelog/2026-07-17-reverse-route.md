## Summary

One-click "Obrátit trasu" button in the map toolbar flips a mission's whole flying order — the last waypoint becomes the first — useful for time-lapse missions that fly the same physical path back and forth.

## Changes

- New `reverseWaypoints` mission-store action: reverses the waypoint array and re-indexes it in a single update (one undo-history entry), clearing the current selection.
- New toolbar button, shown once a mission has 2+ waypoints.
