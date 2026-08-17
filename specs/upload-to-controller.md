# Upload to controller

Send a mission file directly to a DJI controller connected to your computer.

## What you can do

- Upload a KMZ mission file to a USB-connected DJI remote controller.
- Auto-detect connected controllers, including both consumer/prosumer
  controllers (DJI Fly) and enterprise controllers like DJI RC Plus / RC
  Plus 2 running DJI Pilot 2 (e.g. paired with a Matrice 4T).
- Choose which controller to upload to if more than one is connected.
- Alternatively, upload straight to a SkyRoute server's DJI Cloud
  platform with `--cloud` — no USB cable or connected controller
  required; the mission shows up in DJI Pilot 2's Cloud tab instead.

## How it works

1. Connect your DJI remote controller to your computer via USB.
2. Open a terminal and run `npx @prostedav3/droneroute mission.kmz` (replacing `mission.kmz` with your file name).
3. The tool detects the controller and uploads the mission.
4. On DJI Fly controllers, the mission appears as a new route, ready to
   fly. On DJI Pilot 2 controllers, open Pilot 2's import/route-library
   screen to find and load the uploaded file.

### Uploading to DJI Cloud instead

1. Run `npx @prostedav3/droneroute login` once to sign in to your
   SkyRoute server (prompts for server URL, email, and password) — the
   auth token is cached locally.
2. Run `npx @prostedav3/droneroute mission.kmz --cloud` to upload
   straight into the server's configured DJI Cloud platform.
3. Open DJI Pilot 2's Cloud tab on the remote controller to find the
   uploaded mission.

This requires the mission to have at least 2 waypoints, and the target
server to have a DJI Cloud platform configured and support self-hosted
(email/password) login.

Re-uploading a mission with the same name overwrites the existing wayline in place, instead of piling up a new timestamped duplicate on every retry.

The DJI Cloud platform only accepts wayline names up to 64 characters, so a longer one is shortened from the middle before upload — both ends are kept, so you can still tell which mission it is and, for segment uploads, which leg (`…-seg-3-of-11`) you're looking at.

### Managing the wayline library

The web app's **DJI Cloud — wayline knihovna** panel (in the sidebar, below the fleet status panel, when your server has DJI Cloud configured) lists every file currently in the workspace's wayline library and lets you delete ones you no longer need — handy for cleaning up old missions or duplicates created before the overwrite behavior above existed.

When a whole batch has to go — a 71-segment upload superseded by a re-plan, say — two buttons clear the library wholesale: **Smazat všechny mise** and **Smazat všechny segmenty**, counted and handled separately so segments can be swept without touching the missions they came from (and the other way round). Neither deletes on the first click: it arms, and a second button spelling out the count („Opravdu smazat 71 segmentů“) performs it. Progress is shown as it runs; if one delete fails the rest still go, and the list only drops the rows that were really deleted.

## Good to know

- This is a command-line tool — you run it from the terminal, not from the web app.
- The tool can detect controllers connected via USB storage mode or via ADB (Android Debug Bridge).
- If multiple controllers are connected, you'll be asked to choose one.
- On Windows and macOS, most DJI controllers connect via MTP, not USB mass
  storage — Windows shows the device but without a drive letter, and macOS
  doesn't natively support MTP at all (nothing shows up in Finder). On
  both platforms, ADB detection (installing Android platform-tools and
  enabling USB debugging on the controller) is the reliable path — treat
  it as required, not just a fallback for edge cases.
- DJI Pilot 2 support is best-effort: the mission-import folder location
  was found by directly inspecting a real controller rather than from
  published DJI documentation, so it isn't guaranteed to match every
  Pilot 2 controller or version.
