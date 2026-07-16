# Upload mission segments to DJI Cloud

Added a "Nahrát segmenty do DJI Cloud" button — the cloud equivalent of
the existing "Export segmentů" download. It splits the route into
consecutive one-leg missions (WP1→WP2, WP2→WP3, ...) and uploads each as
its own wayline into the configured DJI Cloud API platform, so every leg
appears individually in Pilot 2's Cloud tab.

## How it works

- `POST /api/dji-cloud/upload-segments` (login required, rate-limited,
  same validation as the whole-mission upload) reuses the existing
  `buildMissionSegments` splitter and uploads every leg's WPML 1.0.6 KMZ
  under a single platform login.
- Duplicate names are retried once under a timestamped name per segment,
  same as the whole-mission upload.
- If a segment fails partway through a multi-leg upload, the error toast
  reports how many legs already made it into the workspace ("3 z 5
  segmentů se ale už nahrálo"), so you don't re-run the whole upload and
  create redundant duplicates.
- The button only appears when the server has a DJI Cloud platform
  configured (`djiCloudEnabled`), sitting next to "Nahrát do DJI Cloud".

## Notes

- Rate limiting is now skipped under the test environment
  (`NODE_ENV=test`) so a full route suite — which fires more requests
  from the single loopback IP than the production per-minute budget
  allows — doesn't spuriously hit 429. No effect on any real deployment.
