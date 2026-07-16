# Mission collaboration tools: comments, embed widget, version history, folders, duplicate

A batch of collaboration and organization features for saved and shared
missions: comments on shared missions, an embeddable read-only map widget,
per-mission version history with restore, folder organization alongside the
existing client/project field, and a proper server-side duplicate endpoint.

## What it does

- **Comments on shared missions**: anyone with a shared link can leave a
  comment (just a display name and text — no account required). Comments
  appear at the bottom of the shared mission page, oldest first.
- **Embed widget**: a shared mission can be embedded on another site via
  `<iframe src=".../embed/<shareToken>">` — a minimal read-only view with
  just the map and flight path, no editor chrome.
- **Version history**: every mission save now records a snapshot (capped at
  the 20 most recent per mission). A new "history" icon on each mission card
  lists past saves and lets you restore any of them — restoring itself
  becomes a new version, so history is never destroyed.
- **Folders**: assign a mission to a free-text folder from its card (folder
  icon), then filter the routes page down to a specific folder with a
  dropdown. Complements the existing client/project field rather than
  replacing it.
- **Search**: a search box above the mission grid filters by mission name.
- **Duplicate, server-side**: "Uložit jako kopii" now calls a dedicated
  `POST /api/missions/:id/duplicate` endpoint instead of round-tripping the
  full mission through the client, guaranteeing the copy never carries over
  the share token, comments, or version history.

## Implementation notes

- New tables: `mission_comments` (with a denormalized `share_token` column
  so the public comment endpoints resolve straight from the token, the same
  pattern already used by `GET /shared/:token`, without ever joining through
  `missions` or exposing ownership) and `mission_versions` (full JSON
  snapshot of a mission's editable content per save).
- New `folder TEXT` column on `missions`, added via the existing
  `ALTER TABLE ... ADD COLUMN` migration pattern.
- `GET /api/missions` now accepts optional `?folder=` (exact match) and
  `?search=` (name substring, `LIKE`-escaped so `%`/`_` in the query are
  treated literally) query parameters.
- `POST /api/missions/:id/duplicate`, `GET /api/missions/:id/versions`, and
  `POST /api/missions/:id/versions/:versionId/restore` are all auth +
  ownership scoped like every other mission route.
- `GET/POST /api/shared/:token/comments` are public (no auth) — POST is
  rate-limited (5/min/IP via a new `commentLimiter`) and both the author
  name (80 chars) and comment text (2000 chars) are length-validated
  server-side.
- `GET /api/embed/:shareToken` returns a deliberately minimal payload (name,
  config, waypoints, POIs, obstacles) — no owner email, no mission DB id, no
  share token.
- The `/embed/:token` page route explicitly removes the `X-Frame-Options`
  header (helmet's default is `SAMEORIGIN`, which would otherwise block
  third-party embedding) — this is the one deliberate exception to the
  site's frame policy; every other route keeps the strict default.

## Follow-ups for other in-flight work

- **MapView.tsx / PDF report snapshot**: a new `packages/frontend/src/lib/pdfSnapshot.ts`
  module (`captureMapSnapshot` + `addMapSnapshotToPdf`, both unit-tested)
  is ready to embed a live map frame into the mission PDF report, but two
  small changes outside this PR's file scope are needed to wire it up:
  1. `MapView.tsx`'s `<Map>` needs `preserveDrawingBuffer={true}` — without
     it, `canvas.toDataURL()` returns a blank image.
  2. `App.tsx`'s `handleDownloadReport` needs a reference to the live
     `mapboxgl.Map` instance (e.g. via an `onMapLoad` callback prop added to
     `MapView.tsx`) to call `captureMapSnapshot`/`addMapSnapshotToPdf` before
     `doc.save(...)`.
- **Global frame-ancestors hardening**: if a future security pass adds a
  stricter site-wide `X-Frame-Options`/`frame-ancestors` policy, the
  `/embed/:token` exception in `index.ts` needs to be preserved (or
  re-implemented) alongside it.
