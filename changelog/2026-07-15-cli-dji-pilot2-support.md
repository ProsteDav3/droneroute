## Summary

Extends the `npx droneroute` upload-to-controller CLI tool (`packages/cli`)
to support DJI Pilot 2 enterprise controllers (e.g. DJI RC Plus / RC Plus
2, paired with M30/M300/M350/Matrice 4-series drones) in addition to the
existing DJI Fly consumer/prosumer controllers.

## Changes

- `constants.ts`: split the previous single `WAYPOINT_PATH` into
  `FLY_WAYPOINT_PATH` (`Android/data/dji.go.v5/files/waypoint`, unchanged)
  and a new `PILOT_MISSION_PATH` (`DJI/Mission/KML`) for DJI Pilot 2.
- `device.ts`/`volumes.ts`/`adb.ts`: `DjiDevice` now carries an `appKind:
"fly" | "pilot2"`, detected by checking which mission directory actually
  exists on the device (both for mounted volumes and adb-connected
  devices), with model-string hints only used as a secondary signal.
- `upload.ts`: DJI Fly keeps its existing UUID-subfolder convention. DJI
  Pilot 2 places a flat, sanitized-filename KMZ directly in the mission
  folder — a different convention, since Pilot 2's exact expected layout
  isn't confirmed (see below).
- `index.ts`: the post-upload success message is now app-aware — DJI Fly
  still says "look in the waypoint list"; DJI Pilot 2 says to check the
  import/route-library screen instead, since it doesn't auto-surface new
  missions the way DJI Fly does.

## Known limitations (read before relying on this operationally)

- **The DJI Pilot 2 path is best-effort, not a confirmed DJI spec.** It was
  found by directly inspecting a DJI RC Plus 2's internal storage over USB
  (`DJI/Mission/KML/`, marked with a `.nomedia` file — the standard
  Android "don't index this as media" convention). The folder was empty at
  inspection time, so the exact file-naming convention Pilot 2 expects (a
  flat file, as implemented, vs. some other structure) is unconfirmed.
  Test on real hardware before relying on it; if the mission doesn't show
  up in Pilot 2's import screen, that's useful feedback to refine this.
- **On both Windows and macOS, most DJI controllers (including the RC
  Plus 2 used for this research) connect via MTP, not USB mass storage** —
  the existing "mounted volume" detection can't see them at all in that
  case, regardless of DJI Fly vs. Pilot 2. Windows shows the device but
  without a drive letter; macOS has no built-in MTP support, so nothing
  shows up in Finder either. Treat ADB detection (installing Android
  platform-tools and enabling USB debugging on the controller) as the
  reliable path on both platforms, not just a fallback — README/spec
  updated accordingly.
- Model-string hints for DJI Pilot 2 controllers (`DJI_PILOT2_MODEL_HINTS`)
  are unverified against real `adb devices -l` output — the actual
  detection gate is always "does the mission directory exist," not the
  hint match, so this doesn't block functionality, only affects the
  device label shown before that check runs.
- Code review flagged that DJI Pilot 2 uploads (unlike DJI Fly) don't
  generate a fresh UUID per upload — re-running the tool with a
  same-named file silently overwrites the previous upload at the same
  path. Accepted as a reasonable tradeoff given the whole Pilot 2 path is
  already best-effort/unconfirmed; noted here for awareness.

## Tests

- `npm run build -w packages/cli` (`tsc`) passes; this package has no test
  suite (pre-existing — unchanged by this PR).
- Manually verified (on the machine used for this change, without adb
  installed) that `findMountedDevices()`/`detectDevices()` return an empty
  array without throwing when neither adb nor a mounted drive-letter
  device is present — confirms the new code path doesn't regress the
  existing graceful "no controllers found" behavior.
