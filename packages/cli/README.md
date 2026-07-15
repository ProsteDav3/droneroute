<p align="center">
  <img src="https://raw.githubusercontent.com/fcsonline/droneroute/main/droneroute.png" alt="DroneRoute" width="120" />
</p>

# droneroute

Upload DJI waypoint mission KMZ files to RC controllers via USB.

```bash
npx droneroute mission.kmz
```

## What it does

1. Detects DJI RC controllers connected via USB or mounted SD cards
2. If multiple controllers are found, lets you choose one
3. For DJI Fly controllers: creates a new mission slot so DJI Fly recognizes
   the file immediately. For DJI Pilot 2 (enterprise) controllers: places
   the file in Pilot 2's mission-import folder — open it from Pilot 2's own
   import/route-library screen.

No need to manually create placeholder missions, browse the filesystem, or rename files with UUIDs.

## Prerequisites

- **Node.js 18+** — required to run `npx`
- **adb (Android Debug Bridge)** — needed for USB-connected controllers on
  every platform, not just as a fallback:
  - macOS: `brew install android-platform-tools`
  - Linux: `apt install adb`
  - Windows: included with [Android SDK platform-tools](https://developer.android.com/tools/releases/platform-tools)
  - **This is usually required on both Windows and macOS**, for the same
    underlying reason: most DJI RC units (including DJI RC Plus 2 in our
    own testing) connect over USB using MTP, not USB mass storage.
    - **Windows** shows the controller under "This PC," but MTP devices
      don't get a drive letter, so the direct-mount detection below can't
      read it.
    - **macOS has no built-in MTP support at all** — Finder won't show an
      MTP-connected controller under `/Volumes` (or anywhere else) without
      installing a separate MTP client (e.g. Android File Transfer), and
      even then that tool doesn't expose the device as a real mounted
      volume other programs (including this one) can read from. In
      practice, adb is the only reliable method on a Mac too, not just a
      fallback for edge cases.
    - Install adb and enable USB debugging on the controller (Settings →
      Developer Options → USB Debugging) to use adb-based detection.
- The direct-mount detection below (no adb needed) only helps when a
  controller/SD card genuinely mounts as USB mass storage — e.g. inserting
  an SD card into a card reader, which macOS, Windows, and Linux all mount
  as a normal volume/drive without any extra tooling.

## Supported controllers

**DJI Fly** (consumer/prosumer), any controller with waypoint support:

- DJI RC
- DJI RC 2
- DJI RC Pro / RC Pro 2
- DJI RC-N1 / RC-N2

**DJI Pilot 2** (enterprise — pairs with M30/M300/M350/Matrice 4-series
drones, e.g. Matrice 4T):

- DJI RC Plus / RC Plus 2 and similar enterprise controllers

DJI Pilot 2 support is **best-effort**: the mission-import folder
(`DJI/Mission/KML/` on the controller's internal storage) was found by
directly inspecting a DJI RC Plus 2 over USB — DJI hasn't published this
path, and the folder was empty at inspection time, so the exact file-naming
convention Pilot 2 expects (a flat file, as implemented here, vs. some other
structure) isn't confirmed. If the mission doesn't appear in Pilot 2's
import screen after uploading, please open an issue with what you see —
that's exactly the kind of feedback needed to correct this.

## Creating KMZ missions

You can create DJI WPML-compliant KMZ files with:

- **[DroneRoute](https://droneroute.io)** — free, open-source web-based mission planner
- DJI Pilot 2
- DJI FlightHub 2
- Any tool that generates DJI WPML KMZ files

## How it works

DJI Fly stores waypoint missions on the controller at:

```
Android/data/dji.go.v5/files/waypoint/<uuid>/<uuid>.KMZ
```

Each mission lives in a folder named with a UUID, containing a single KMZ file with the same UUID as its filename. This tool generates a new UUID, creates the folder, and places your KMZ file with the matching name. DJI Fly picks it up as a new mission entry.

DJI Pilot 2 (best-effort, see the caveat above) stores missions to import at:

```
DJI/Mission/KML/<your-file-name>.KMZ
```

This tool places your KMZ file there directly (sanitized filename, no UUID
wrapper) — open it from Pilot 2's own import/route-library screen rather
than expecting it to appear automatically.

## Examples

Upload a mission to the only connected controller:

```bash
npx droneroute my-survey.kmz
```

If multiple controllers are connected, an interactive prompt appears:

```
$ npx droneroute my-survey.kmz

Searching for DJI controllers...

Multiple DJI controllers found. Select one:
❯ DJI RC 2 (adb: 3A2F4B1C)
  SD card (/Volumes/DJI_RC)

Uploading my-survey.kmz...
✓ Mission uploaded successfully
  Mission ID: 550E8400-E29B-41D4-A716-446655440000

Open DJI Fly on the controller and look for the new
mission in the waypoint list.
```

## Troubleshooting

| Problem                                                        | Solution                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "No DJI controllers found"                                     | Connect the controller via USB and power it on. Ensure the cable supports data transfer (not charge-only). On macOS/Windows, this usually means adb isn't installed/set up yet — see Prerequisites above.                                     |
| adb not found                                                  | Install Android platform-tools: `brew install android-platform-tools` (macOS) or `apt install adb` (Linux).                                                                                                                                   |
| macOS: controller doesn't show up anywhere, not even in Finder | Expected — macOS has no built-in MTP support. Don't rely on Finder/`/Volumes`; install adb and enable USB debugging on the controller instead.                                                                                                |
| Permission denied on waypoint path                             | Enable USB debugging on the controller: Settings > Developer Options > USB Debugging.                                                                                                                                                         |
| Controller not detected by adb                                 | Try a different USB cable or port. Enable "File Transfer" mode when the USB dialog appears on the controller.                                                                                                                                 |
| Mission doesn't appear in DJI Fly                              | Open the waypoint mission list and scroll — new missions appear at the end. Tap on it to load it into the editor.                                                                                                                             |
| Mission doesn't appear in DJI Pilot 2                          | Pilot 2 support is best-effort and doesn't auto-appear like DJI Fly — open Pilot 2's import/route-library screen and browse to `DJI/Mission/KML/` manually. If it's not there or the path is wrong for your controller, please open an issue. |
| SD card method: directory not found                            | The waypoint/mission directory is only created after you save at least one mission via DJI Fly / DJI Pilot 2 on the controller.                                                                                                               |

## License

MIT
