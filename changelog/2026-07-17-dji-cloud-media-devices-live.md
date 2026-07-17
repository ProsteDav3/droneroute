## Summary

Three DJI Cloud features: browse media uploaded from a flight, focus telemetry/progress tracking on one device when several are bound, and watch a live video feed.

## Changes

- New **Média** panel — lists photos/videos already uploaded into the workspace's cloud storage (`GET /api/dji-cloud/media`), with a per-file download link resolved on click (`GET /api/dji-cloud/media/:fileId/url`). SkyRoute doesn't store or proxy the files, only surfaces what's there.
- New **device focus**: clicking a device in the "DJI Cloud — zařízení" list (when 2+ are bound) makes the Mission Progress panel track that device specifically, instead of implicitly picking "whichever bound device is online first".
- New **Živý přenos** panel — lists live-capable cameras (`GET /api/dji-cloud/live/capacity`) and starts/stops a feed (`POST /api/dji-cloud/live/start` / `/stop`), playing it back via HLS (`hls.js`, lazy-loaded — only downloaded when this panel is actually opened, so it doesn't cost every visitor part of the main bundle). Self-hosted instances need a new optional `DJI_CLOUD_LIVE_HLS_BASE_URL` env var pointing at an RTMP-in/HLS-out relay (e.g. MediaMTX) for playback here — starting a feed still works without it, there's just no video shown.
- Fixed a pre-existing bug in `fetchDevicesAndHms`: a Health Management System (HMS) fetch failure (which the DJI Cloud reference platform returns when a workspace has no device history yet — the common case for a freshly bound workspace) was taking the whole device list down with it via `Promise.all`. Now fetched independently (`Promise.allSettled`) so a HMS-only failure just means an empty warnings list, not a hidden device list.

## Verification

All three new endpoints were exercised against a real DJI Cloud API deployment (not just unit-tested against a mocked upstream) — login, media listing, and live capacity listing all round-tripped successfully end-to-end in a real browser session. No physical device was online during testing, so the actual video playback pixels and the multi-device focus behavior couldn't be observed with live data — those are structurally implemented and unit-tested, but await a real flight to fully confirm.
