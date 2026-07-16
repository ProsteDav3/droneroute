# Preflight checklist PDF

Added a one-page preflight checklist export: airspace conflicts, mission
validation warnings (battery, obstacles), a weather go/no-go read, and the
mission's SORA-lite risk assessment and permit status, all in a single PDF
styled consistently with the existing "Stáhnout PDF report" export (same
fonts, margins, and table conventions).

The weather go/no-go uses simple wind (> 8 m/s) and precipitation (> 0.2 mm)
thresholds against the nearest available forecast entry — a starting point,
not a certified safety clearance; the mission-planning weather epic may
land its own per-drone scoring later.

## Implementation notes

- New `PreflightChecklistButton` component gathers everything it needs
  (waypoints, obstacles, airspace zones, weather forecast, risk assessment,
  permits) directly from stores/API rather than props, so it works
  standalone.
