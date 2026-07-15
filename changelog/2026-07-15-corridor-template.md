# Corridor template for bridges and linear structures

Added a sixth template, **Corridor**, for inspecting bridges, pipelines,
power lines, roads, railways, and other linear infrastructure that a
single flat area (Grid) or a single wall (Facade) template don't fit well.

## What it does

- Draw the structure's centerline the same way as the Pencil template
  (click-and-drag a freehand path).
- The app flies multiple parallel passes offset to the sides of that
  centerline — useful for photographing a bridge deck from both sides, or
  a pipeline/power line corridor from more than one angle, instead of
  flying directly over it once.
- Configurable: lateral spacing between passes, how many passes to fly (an
  odd count includes an exact centerline pass; an even count straddles it
  symmetrically), altitude, speed, gimbal pitch, reverse direction, and
  photo/video capture mode — same options as the other path-based
  templates.
- Passes alternate direction (lawn-mower style) so the aircraft doesn't
  need a long non-flying transit back to the start between each one.
- Keyboard shortcut: **L**.
- Supports the same "Edit template" and "Save as preset" workflows as
  every other template.

## Implementation notes

- `generateCorridor()` in `templates.ts` resamples the drawn path, computes
  a smoothed local tangent bearing at each point (circular mean of the
  incoming/outgoing segment bearings, so an offset pass doesn't kink at
  every drawn point), then offsets perpendicular to that tangent by each
  pass's lateral distance.
- `CorridorDrawHandler.tsx` mirrors `PencilDrawHandler.tsx`'s freehand-path
  drawing UX exactly, since both templates start from the same kind of
  drawn-path input.
