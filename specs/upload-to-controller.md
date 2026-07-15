# Upload to controller

Send a mission file directly to a DJI controller connected to your computer.

## What you can do

- Upload a KMZ mission file to a USB-connected DJI remote controller.
- Auto-detect connected controllers, including both consumer/prosumer
  controllers (DJI Fly) and enterprise controllers like DJI RC Plus / RC
  Plus 2 running DJI Pilot 2 (e.g. paired with a Matrice 4T).
- Choose which controller to upload to if more than one is connected.

## How it works

1. Connect your DJI remote controller to your computer via USB.
2. Open a terminal and run `npx droneroute mission.kmz` (replacing `mission.kmz` with your file name).
3. The tool detects the controller and uploads the mission.
4. On DJI Fly controllers, the mission appears as a new route, ready to
   fly. On DJI Pilot 2 controllers, open Pilot 2's import/route-library
   screen to find and load the uploaded file.

## Good to know

- This is a command-line tool — you run it from the terminal, not from the web app.
- The tool can detect controllers connected via USB storage mode or via ADB (Android Debug Bridge).
- If multiple controllers are connected, you'll be asked to choose one.
- On Windows, most DJI controllers connect via MTP, which doesn't get a
  drive letter — ADB detection (requires installing Android platform-tools
  and enabling USB debugging on the controller) is usually the reliable
  path there.
- DJI Pilot 2 support is best-effort: the mission-import folder location
  was found by directly inspecting a real controller rather than from
  published DJI documentation, so it isn't guaranteed to match every
  Pilot 2 controller or version.
