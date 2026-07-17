# Flight logbook

Added a simple flight logbook: log an actual flight against a saved
mission (date, duration in minutes, free-text notes), list logged flights,
and delete entries. This is basic record-keeping, not a full EU-compliant
logbook with every regulatory field — deeper regulatory-field coverage is
a possible future enhancement.

New `flight_logs` table and `/api/flight-logs` CRUD routes (auth required,
scoped to the requesting user — never a client-supplied user id). Entries
optionally reference a mission; when they do, the referenced mission's
ownership is verified server-side too.
