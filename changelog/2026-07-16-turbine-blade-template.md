# Turbine blade inspection template

Added a seventh template, **Turbine**, for inspecting wind turbine blades
from close range — a distinct enough flight pattern (a small number of
very long, near-vertical passes radiating from a single hub, rather than
a flat area or a single wall) that neither Grid, Facade, nor Corridor fit
it well.

## What it does

- Click once on the map at the turbine's rotor hub.
- The app generates a close-proximity inspection flight for every blade —
  from root to tip, at a safe standoff distance from the blade surface,
  with the camera fixed on facing the rotor throughout the whole flight
  (the heading is baked into each waypoint, the same way the Orbit
  template already does, so it doesn't depend on a POI reference).
- Configurable: hub height and blade length (to match the actual
  turbine), how many blades (default 3, evenly spaced around the hub),
  the angle of the first blade (0° = straight up, matching a common
  locked "one blade up" service position — the rotor is normally not
  spinning during inspection), the rotor's compass orientation (must be
  set to match the real turbine — there's no sensible default), standoff
  distance, and how many passes per blade (2+ spreads across the blade's
  chord to cover the leading and trailing edge separately).
- Keyboard shortcut: **T**.
- Supports the same "Edit template" and "Save as preset" workflows as
  every other template.

## Implementation notes

- `generateTurbineInspection()` in `templates.ts` models the blades as
  lying in a vertical "sweep-plane" disc facing the rotor's compass
  bearing. Each blade radiates from the hub at its own angle within that
  disc, contributing partly to altitude and partly to a horizontal
  chordwise offset; the drone stands off in front of the disc and flies
  root-to-tip along each blade, with extra passes spread across the chord
  for edge coverage.
- Placement is a single click (not a drag or a freehand path) — closer to
  Orbit's quick single-click placement than to Pencil/Corridor's drawing
  gesture, so `TurbineDrawHandler.tsx` is a new, self-contained component
  (mirroring `CorridorDrawHandler.tsx`'s structure) with its own simple
  click-vs-drag detection, rather than adding a fourth type into the
  already-complex shared `TemplateDrawHandler.tsx`.
