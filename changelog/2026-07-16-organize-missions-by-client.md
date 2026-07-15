# Organize missions by client/project

Added a free-text "Klient / zakázka" (client/project) field to missions,
useful once you're managing flights for several different clients or
recurring orders instead of just your own projects.

## What it does

- A new field under the mission name in the editor lets you tag the
  mission with a client or project name (optional).
- The routes page ("Moje trasy") shows this tag on each mission card.
- Once at least one saved mission has a client set, a filter box appears
  above the mission grid — type any part of a client/project name to
  narrow the list down to just that client's missions.
- Duplicating a mission carries over its client/project tag (unlike the
  share link, which intentionally does not carry over).

## Implementation notes

- New `client TEXT` column on the `missions` table (nullable, added via
  the existing `ALTER TABLE ... ADD COLUMN` migration pattern used for
  every other optional column on this table).
- Validated server-side the same way the mission name already is (optional
  string, capped at 200 characters) — `validateMissionCreate`/
  `validateMissionUpdate` both updated.
- No fixed client list — this is intentionally just a free-text tag with
  substring filtering, not a separate "clients" entity, to keep the
  feature simple and avoid a whole new management UI for something that's
  easy enough to type consistently by hand.
