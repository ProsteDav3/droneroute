# CLI: upload missions to DJI Cloud with `--cloud`

The `droneroute` CLI (`@prostedav3/droneroute`) can now push a mission
straight into a SkyRoute server's DJI Cloud platform instead of only
transferring a KMZ file over ADB/USB.

## What's new

- `droneroute mission.kmz --cloud` parses the KMZ back into mission JSON
  (config/waypoints/POIs) and POSTs it to the server's
  `POST /api/dji-cloud/upload`, the same endpoint the web app uses — the
  mission then shows up in DJI Pilot 2's **Cloud** tab.
- `droneroute login` prompts for a SkyRoute server URL, email, and
  password, then caches the resulting JWT in `~/.droneroute/config.json`
  (written with owner-only file permissions).
- Server and token can also be set per-invocation with `--server <url>`
  / `--token <jwt>`, or via the `DRONEROUTE_SERVER` / `DRONEROUTE_TOKEN`
  environment variables. Resolution order is: CLI flag → env var →
  cached config file → built-in default server.
- Without `--cloud`, behavior is unchanged — ADB/USB transfer stays the
  default.

## Notes

- The CLI is a standalone published npm package and can't depend on the
  private `@droneroute/shared`/backend workspace packages, so the
  KMZ → mission-JSON parsing logic is a small self-contained port of
  `packages/backend/src/services/kmzParser.ts` living in
  `packages/cli/src/kmzParser.ts`.
- `droneroute login` only works against servers running in self-hosted
  (email/password) auth mode — cloud-mode instances that only support
  Google sign-in return a clear error instead.
