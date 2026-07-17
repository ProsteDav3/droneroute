# DJI Cloud fleet status and live telemetry

Rounds out the DJI Cloud bridge from a one-way file-upload channel into
something that actually shows what's happening with the fleet.

## New

- **Fleet status panel** ("DJI Cloud — zařízení" in the sidebar): lists
  devices bound to the workspace with an online/offline indicator, and
  recent Health Management System (HMS) warnings the aircraft has
  reported — the same kind of alerts Pilot 2 shows, surfaced before you
  even connect the controller.
- **Live telemetry on the map**: while a bound aircraft is online and
  reporting position, it shows up as a moving marker (rotated to its
  heading) that updates in real time, no manual refresh needed. Backed by
  a small MQTT bridge (`services/mqttTelemetry.ts`) that subscribes to
  the DJI Cloud platform's broker and streams updates to the browser over
  Server-Sent Events.
- **Wayline library management**: mission uploads can now be deleted from
  the platform's workspace directly (`DELETE /api/dji-cloud/waylines/:id`)
  — useful for clearing out timestamped duplicates from retried uploads.
- **Wayline job history**: `GET /api/dji-cloud/jobs` surfaces flight job
  status/progress from the platform.

## Also fixed while wiring this up

Two loose ends from earlier PRs, now resolved:

- **PDF report map snapshot**: the mission PDF report now includes a
  snapshot of the current map view. This needed `MapView` to expose its
  underlying Mapbox instance (`onMapLoad` prop) and be constructed with
  `preserveDrawingBuffer: true` — the map-snapshot helper itself already
  existed but wasn't reachable from anywhere.
- **Embed widget routing**: `/embed/:token` now actually renders the
  read-only embeddable view — the backend endpoint and the page component
  existed, but no URL detection wired them into the app.
- **SkyRoute branding on the PDF report**: the mission PDF report now
  shows the SkyRoute drone mark and wordmark in its header, drawn with
  jsPDF's own vector primitives (same shape as `public/skyroute-icon.svg`)
  rather than an embedded raster image — so it's recognizably a SkyRoute
  document at a glance.

## Notes

- **Scope correction on "remote flight task dispatch"**: DJI's Cloud API
  only supports remotely _triggering_ a flight through a Dock (autonomous
  drone-in-a-box hardware) — a handheld RC + aircraft can't be commanded
  to take off from the cloud. This bridge exposes job _history/status_,
  not job _creation_, since the latter isn't applicable to an RC-flown
  fleet.
- The MQTT credentials used for the telemetry bridge come from the same
  login the KMZ-upload bridge already performs — no separate MQTT account
  needed.
- **Needs hardware verification**: this was built and unit-tested against
  the DJI Cloud reference platform's REST API directly, but a live
  aircraft's actual telemetry stream couldn't be verified from this
  environment — worth confirming the marker actually appears/moves during
  a real flight before relying on it operationally.
