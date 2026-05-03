# Upload to controller

Send a mission file directly to a DJI controller connected to your computer.

## What you can do

- Upload a KMZ mission file to a USB-connected DJI remote controller.
- Auto-detect connected controllers.
- Choose which controller to upload to if more than one is connected.

## How it works

1. Connect your DJI remote controller to your computer via USB.
2. Open a terminal and run `npx droneroute mission.kmz` (replacing `mission.kmz` with your file name).
3. The tool detects the controller and uploads the mission.
4. The mission appears as a new route on the controller, ready to fly.

## Good to know

- This is a command-line tool — you run it from the terminal, not from the web app.
- The tool can detect controllers connected via USB storage mode or via ADB (Android Debug Bridge).
- If multiple controllers are connected, you'll be asked to choose one.
