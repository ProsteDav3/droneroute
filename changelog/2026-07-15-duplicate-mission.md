# Duplicate a saved mission

Added a "Duplikovat" button (copy icon) to each mission card in "Moje
trasy". Useful for recurring inspections — a monthly FVE thermography
flight, a periodic facade check, a construction time-lapse orbit — where
the next visit should reuse the exact same flight plan while the previous
visit's mission stays around as its own separate record instead of being
overwritten.

## Implementation notes

- Reuses the existing `POST /missions` endpoint — no backend changes.
  The frontend parses the saved mission's JSON columns (the same way
  "load" and "export" already do) and re-submits them as a new mission
  named "\<original\> (kopie)".
- The copy never inherits the original's `share_token` — duplicating an
  already-shared mission produces an unshared copy, since the new
  `POST /missions` call doesn't carry that field over.
