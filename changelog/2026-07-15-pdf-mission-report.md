# PDF report for clients

Added a "Stáhnout PDF report" button next to the export/import buttons,
generating a client-facing summary of the planned mission: drone/camera
used, waypoint count, flight distance, estimated duration, altitude range,
photo/video action counts, and a table of every waypoint's coordinates,
altitude, and actions. Useful for handing a professional-looking summary to
a client alongside (or instead of) sharing the raw KMZ.

## Implementation notes

- Built with `jspdf` + `jspdf-autotable`, entirely client-side — no backend
  involvement needed since the report only reflects data already in the
  editor.
- These libraries pull in ~400kb of transitive dependencies the rest of the
  app never needs (via jsPDF's optional HTML-rendering support), so the
  report module is loaded with a dynamic `import()` on click rather than
  bundled into the main chunk — keeps the app's initial load unaffected.
- Drone/camera names are looked up from the existing `DRONE_MODELS` table;
  an unrecognized drone/payload combination (e.g. a KMZ imported from a
  third-party planner) shows the raw enum values instead of guessing a name.
- Very dense surveys (hundreds or thousands of waypoints) show only the
  first 200 rows in the waypoint table, with a note about how many more
  exist, so the report stays a reasonable length.
- Extracted the photo/video action-counting logic (previously only inline
  in the editor's footer stats) into a shared `countCaptureActions` helper
  in `lib/flightStats.ts`, reused by both the footer and the new report.
