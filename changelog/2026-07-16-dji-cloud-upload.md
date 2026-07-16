# Upload missions straight to DJI Cloud

Added a "Nahrát do DJI Cloud" button that pushes the current mission
directly into a DJI Cloud API platform's wayline library — it then shows
up in DJI Pilot 2's **Cloud** tab on the remote controller with no manual
KMZ transfer.

## How it works

- The server bridges to a self-hosted DJI Cloud API platform (the stack
  Pilot 2 connects to via Settings → Cloud Service → Open Platforms),
  configured through three environment variables: `DJI_CLOUD_URL`,
  `DJI_CLOUD_USERNAME`, `DJI_CLOUD_PASSWORD` (a web-type account on the
  platform). When they're absent the feature is disabled and the button
  stays hidden (`djiCloudEnabled` in `/api/config`).
- `POST /api/dji-cloud/upload` (login required, rate-limited) validates
  the mission like the KMZ export does, generates the WPML 1.0.6 KMZ,
  logs into the platform with the service account, and uploads the file
  into its workspace.
- Duplicate names don't fail: if the platform's storage refuses the
  first upload, the file is retried once under a timestamped name and
  the toast reports what it was stored as.

## Notes

- Requires the WPML 1.0.6 native-format export (previous changelog
  entry) — Pilot 2 strictly validates cloud-delivered waylines and
  rejects older formats it happily accepts via manual import.
- The endpoint requires a signed-in SkyRoute account so the public
  instance can't be used anonymously to spam the workspace; the DJI
  platform credentials never leave the server.
