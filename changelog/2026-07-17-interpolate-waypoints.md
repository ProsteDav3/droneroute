## Summary

New "Interpolovat" control in the bulk-edit toolbar inserts N evenly-spaced waypoints between two adjacent ones — quicker than manually placing and adjusting each point when a segment needs finer coverage.

## Changes

- New `interpolateBetween` mission-store action: given two adjacent waypoint indices and a count, linearly interpolates position, height, speed, and gimbal pitch between them and inserts the new points (single undo-history entry). No-op if the two indices aren't adjacent.
- New count input + "Interpolovat" button in the bulk-edit toolbar, shown only when exactly two adjacent waypoints are selected (interpolating "between" a non-adjacent or 3+ selection would be ambiguous).
- Newly inserted waypoints carry no actions and no template-group tag, and are auto-selected after insertion.
