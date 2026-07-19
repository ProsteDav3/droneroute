# Map and visualization

An interactive map where you plan flights and see everything at a glance.

## What you can do

- Pan, zoom, and interact with a Mapbox GL JS satellite map.
- Switch between **satellite** and **street** (dark) map styles using the bottom-left buttons.
- Toggle between **2D** and **3D** view modes.
- Search for any location using the **geocoding search box** (top-left magnifying glass icon). Type a place name, address, or landmark and the map flies there.
- Jump straight to your current position with the **locate-me control** (bottom-right of the map, next to the attribution). It centers the map on your GPS location and keeps a small live dot there as you move — no need to search an address when you're already on site. Even on a low-precision fix (e.g. no real GPS hardware, network-based positioning), it always zooms in close rather than zooming out to fit the whole uncertainty radius.
- See the flight path as a dashed line connecting all waypoints.
- **Color the flight path by height or speed** instead of a flat color — set "Barvení trasy" in the Visualization tab of the settings dialog to "Podle výšky" or "Podle rychlosti" and each segment is colored along a blue (low) → green → yellow → red (high) gradient, normalized against the whole mission's own min/max. A segment that crosses an obstacle still always renders red regardless of this setting — that's a safety warning, not a style choice.
- See colored lines from waypoints to POIs showing camera aim (green = correct pitch, red = needs adjustment).
- See obstacle polygons drawn on the map.
- Click extruded 3D buildings to **convert them to an obstacle or to a `Budova`** (building) object via a popup — the same kind of building you'd get from drawing one by hand, ready for Facade scans or orbit-from-building.
- Use the floating toolbar to switch between waypoint mode, POI mode, and template tools.
- View an elevation graph below the waypoint list that shows altitude changes across the flight, with the real ground elevation along the path overlaid as a shaded terrain profile.
- See live previews when configuring templates before placing them.
- Hide the sidebar for a fullscreen map view — click the collapse icon next to the SkyRoute logo, or press **Tab** (only while no input/button is focused, so it doesn't interfere with normal keyboard navigation). A small button in the map's top-left corner brings the sidebar back.
- On a phone or narrow tablet screen (below ~768px wide), the app opens straight into the fullscreen map instead of the sidebar, and the sidebar becomes a slide-over drawer with a tap-to-dismiss backdrop rather than sharing space with the map — the same collapse button and Tab shortcut open and close it.

## 3D mode

When you switch to 3D:

- **Terrain** — real-world elevation data from Mapbox DEM renders mountains and valleys.
- **Extruded buildings** — 3D buildings appear at zoom level 14+, with height and footprint from OpenStreetMap data.
- **Extruded `Budova` objects** — a building you've drawn by hand or converted from the map renders as a real 3D box at its actual height too, not a flat rectangle on the ground.
- **Elevated flight path** — the flight path line floats at each waypoint's configured altitude, interpolating between segments.
- **Elevated markers** — waypoint and POI markers are positioned at their configured height above ground.
- **Drop lines** — subtle vertical lines connect each waypoint marker down to the ground.
- **Vertical poles** — dashed lines from ground to waypoint altitude.
- **Ground shadow** — a faint gray line on the ground traces the flight path from above.
- **POI pointing lines** — green lines from waypoints to POIs are elevated to match their respective heights.
- **Camera frustum** — when a waypoint is selected and has a POI target, a translucent slate-gray cone is drawn from the waypoint toward the POI, visualizing the camera's field of view and gimbal pitch.
- The camera tilts to 45° pitch and you can freely rotate and tilt the view.

## 2D mode (default)

- Flat top-down view with no terrain elevation.
- No drop lines, poles, or ground shadow.
- All markers are placed at ground level.
- Flight path and POI lines are flat.
- Camera rotation and pitch are locked.

## Flight simulation

- Click the **"Simulace letu"** button (bottom-right of the map, above the locate-me control, appears once your mission has 2+ waypoints) to start an animated flythrough of the flight path.
- A scrubber bar lets you play/pause, jump to any point in the flight, and change playback speed (0.5x–4x) — **1x plays back at the drone's actual real-world flight time**, using the same distance/speed/hover/turn-overhead estimate the PDF report and flight-time readout use, so a fast short leg and a slow long one take exactly the amount of real time the drone itself would, and the total playback length always matches the mission's own estimated flight duration (shown next to the scrubber) rather than an arbitrary fixed pace.
- In top-down ("Shora") mode, a camera frustum follows the simulated drone position, showing exactly what the camera would see — including gimbal pitch — at every point along the path, not just at each waypoint.
- On legs where a waypoint's heading is set to **point toward a POI**, the simulated camera keeps tracking that POI continuously through the leg — both which way it's facing and how much it's tilted up or down — rather than snapping between fixed angles or drifting off-target (e.g. losing part of a tall building mid-orbit) between waypoints.
- The readout shows which leg of the mission ("WP X / Y") the simulation is currently flying.
- A **"Shora" / "3D let"** toggle switches the simulation view between the original fixed top-down overview and a real first-person flythrough — the camera sits exactly at the drone's own position, altitude, heading, and gimbal pitch, updated continuously in real time so it's always precisely where the drone is along the route, never trailing behind it. Switching to 3D let temporarily forces the map into 3D mode (restored to its prior 2D/3D state and original view when the simulation ends). While flying in this mode, waypoint/POI markers, the camera frustum, the flight path's ground-shadow/altitude poles, and the citywide 3D-building extrusion are all hidden — none of it is something a real onboard camera would show, and it's one less thing competing for the same frame budget the flight itself needs to stay smooth. Buildings you've actually added to the mission (via `Budova`) stay visible.
- While flying in "3D let" mode, a small monospace readout in the top-right corner shows the exact numbers driving the camera each frame (elapsed flight time, current leg, waypoint/ground/camera altitude, gimbal and heading angle, coordinates) — a temporary diagnostic aid while tracking down flythrough rendering issues, not a permanent piloting HUD.

## Measure tool

- Click the **ruler button** in the toolbar (or press **M**) to measure distances and areas on the map, entirely independent of the loaded mission's waypoints.
- Click the map to drop points — a running total distance is shown live, and once you've placed 3 or more points, the area the shape would enclose is shown too.
- Press **Escape** or click the undo icon to remove the last point; the trash icon clears the whole measurement.
- Starting another map tool (placing a waypoint, drawing an obstacle, opening a template, etc.) automatically ends the measurement, and starting a measurement exits whatever other tool was active — only one map tool works at a time.

## How it works

The map is the central workspace. Everything you do — placing waypoints, POIs, obstacles, or templates — happens directly on the map. The sidebar shows lists and settings, and the two stay in sync.

## Good to know

- The default view is **satellite** imagery in **2D** mode. Users can change these defaults in the **Visualization** tab of the settings dialog — the preferred view mode and map style are applied when the app loads.
- The app defaults to a **dark** color theme. Switch to **light** in the same Visualization tab under "Barevný motiv" — this re-themes the sidebar, dialogs, and panels. The map's own imagery and Mapbox's built-in controls (search box, building/airspace popups) intentionally stay dark in both modes, since they aren't meaningfully themeable and the map content dominates either way.
- The map opens centered on Barcelona by default. Self-hosted instances can change the starting location by setting `DEFAULT_MAP_VIEW` in their environment (or `docker-compose.yml`), formatted as `lat,lng` or `lat,lng,zoom`, so the map opens on their local area. Invalid or out-of-range values fall back to the built-in default.
- You can click waypoints and POIs directly on the map to select and edit them.
- The geocoding search box collapses to an icon when not in use to save space.
- The same address-or-coordinates search also appears inline in the orbit template panel and in the waypoint/POI settings — entering a location there both flies the map there and moves the orbit center, waypoint, or POI to that exact spot.
- A Mapbox access token is required. Self-hosted instances must set `MAPBOX_TOKEN` in their `.env` file.
- SkyRoute is installable as an app (Chrome/Edge: the install icon in the address bar; mobile: "Add to home screen") and its interface loads even without a network connection. A banner appears whenever the connection drops, since saving, loading missions, weather, and airspace data all still need to be online — only the app's own screens work offline, not your mission data.
- First-time visitors see a welcome dialog with the option to start a short guided tour that spotlights the map, its toolbar, the sidebar, and the save/export buttons in turn. Skipping or finishing it only asks once — replay it anytime from the help dialog's "Spustit prohlídku aplikace" link (the CircleHelp icon next to the SkyRoute logo).

## Airspace restriction zones

You can overlay airspace restriction zones on the map to check for drone no-fly areas:

- Toggle individual country providers by enabling their checkboxes in the **Visualization** tab of the settings dialog under **Extra layers**:
  - **Spain (ENAIRE)** — prohibited and restricted airspace zones.
  - **France (DGAC)** — UAS restriction zones for the open category and aeromodelling.
  - **United Kingdom (NATS)** — flight restriction zones around aerodromes, updated every 28 days.
  - **Czech Republic (ŘLP ČR)** — controlled airspace _and_ uncontrolled aerodrome traffic zones (ATZ), each shown as a grid of cells carrying the altitude above which flying inside that cell needs coordination (e.g. "GND - 120 m AGL"). This is the same official ŘLP dataset AisView and DronView are built on.
- Press **A** to toggle all providers on/off at once.
- Zones are classified as either **prohibited** (red) or **restricted** (orange).
- When the flight path enters a prohibited zone, a red warning banner appears at the bottom of the map.
- When the flight path enters a restricted zone, an orange warning banner appears indicating authorization may be required.
- A more detailed warning also lists which specific zone the route crosses and its altitude limit, e.g. "Trasa letu protíná zónu Řízený vzdušný prostor (limit 120 m AGL)".
- Zones update automatically as you pan the map — data is fetched for the current viewport with caching to avoid redundant requests.

## Custom map layers (WMS/XYZ)

- In the **Visualization** tab of the settings dialog, under **Vlastní vrstvy (WMS/XYZ)**, add any raster tile layer by name and URL template (e.g. a national cadastre or zoning-plan layer, using `{z}`/`{x}`/`{y}` placeholders) — useful for region-specific data the app doesn't ship built in.
- Each added layer has its own visibility checkbox and can be removed individually.
- Layers render on the map in the order they were added, below waypoints/POIs/obstacles but above the base map style.
- A one-click preset button adds the Czech national orthophoto (ČÚZK) pre-filled — no need to look up or type its tile URL yourself.

## NOTAM (Notice to Airmen)

- When your mission has waypoints, a "Zobrazit NOTAM pro tuto oblast" link appears next to the airspace warnings.
- Live NOTAM data for the Czech Republic requires an authenticated session with the official AIM ČR briefing system (there's no public feed to fetch automatically) — the link takes you straight to that official portal so you can check NOTAMs for your mission's area and date yourself.

## Terrain and ground clearance

- The elevation graph (see [Mission planning](mission-planning.md)) overlays real ground elevation from Mapbox's terrain data along the flight path.
- If the planned flight altitude comes within 15 m of the real ground anywhere along the path, a red warning banner appears at the bottom of the map naming the affected waypoint leg and how much clearance is missing — the same kind of banner used for prohibited airspace.
- This check compares your mission's own height reference against the terrain: for "relativně od vzletového bodu" and "nad mořem (EGM96)" height modes it's a genuine pre-flight risk check. For "nad terénem" (above ground level) mode, the aircraft already follows the terrain live using its own sensors, so no static warning is shown for that mode.
- Terrain data loads progressively as tiles become available — a brand-new mission or a far-off area may take a moment before the terrain line and warning appear.
- A separate warning appears if any waypoint flies higher than 120 m above real ground — the EU Open category altitude limit — computed against the same real terrain data (also skipped for above-ground-level mode, for the same reason as the collision check).
- Another warning appears if any waypoint is more than 2 km from the first waypoint (treated as the launch point). This is a general heads-up threshold, not a certified transmission-range figure for your specific aircraft — actual radio link range varies a lot by drone model, region, and terrain, so treat it as a prompt to double-check your own equipment's range rather than an authoritative limit.

## DJI Cloud live telemetry

When your server has a DJI Cloud platform configured (see [Upload to controller](upload-to-controller.md)):

- Any aircraft currently online and reporting a position shows up on the map as a live marker — an icon that rotates to match the aircraft's actual heading.
- Below the icon, a small label shows the aircraft's current altitude, horizontal speed, and battery percentage, updating in real time as new telemetry arrives. The battery icon changes color (green/amber/red) as it drops.
- The sidebar's **DJI Cloud — zařízení** panel lists every device bound to the workspace (aircraft and remote controllers), each with an online/offline indicator, live battery percentage when online, device model, and how long ago it last logged into the platform.
- Recent Health Management System (HMS) warnings reported by the aircraft — a fault code, a battery cell imbalance, and similar — appear at the bottom of the same panel. If the platform can't compute HMS data yet (e.g. a brand-new workspace with no device history), the device list itself still loads normally — only the warnings section is affected.
- All of this updates automatically over a live connection; no manual refresh needed.
- **When more than one device is bound**, click a device in the list to focus on it — the Mission Progress panel then tracks that device specifically instead of "whichever bound device happens to be online first". Click it again to go back to that default. With only one device bound, there's nothing to pick, so the list isn't clickable.

### Live mission progress

While a device is online and flying, a "Průběh mise" badge appears at the top of the map showing percent complete and an ETA to the last waypoint, worked out by matching the aircraft's live position against the currently open mission's own flight path.

- In the waypoint list, every waypoint the aircraft has already flown past gets a green checkmark badge and is dimmed, so you can see progress at a glance without watching the map.
- The ETA needs the aircraft to be moving at a meaningful speed — it shows "ETA neznámá" while stationary or just after takeoff, rather than an unreliable estimate.
- This assumes the mission open in the editor is the one actually flying — with one aircraft active at a time (the common case), that holds; it isn't a per-mission dispatch tracker for multiple simultaneous flights. With multiple devices bound, pick the flying one via the device focus described above.

### Media

The sidebar's **Média** panel lists photos and videos the aircraft or remote controller has already uploaded into the workspace's own cloud storage after a flight — file name, upload time, and a "Stáhnout" link that resolves the platform's own (presigned, expiring) download URL on click. SkyRoute doesn't copy or store these files itself, it just surfaces what's already there so you don't have to separately open the DJI Cloud platform's own console. Use the refresh icon to check for newly uploaded files without reopening the panel.

### Live video

The sidebar's **Živý přenos** panel lists every camera lens currently capable of streaming (i.e. currently online) — pick one to start watching. The aircraft pushes its feed to the server's own video relay and it plays back right there in the panel; stop it with the button below the player when you're done. If nothing is listed, no device is currently online with a camera. Self-hosted instances need `DJI_CLOUD_LIVE_HLS_BASE_URL` configured (see `.env.example`) for playback to work here — without it, starting a feed still works (the aircraft is still commanded to stream), there's just no video shown in this panel.

### Flight track recording (actual vs. planned)

A fleet without a DJI Dock has no after-the-fact flight history to pull from the cloud platform — there is no "flight task" record for a manually flown RC mission. Instead, the sidebar's **Záznam letu** panel lets you record the aircraft's actual GPS trace live, while flying:

- Click **Začít nahrávat let** before takeoff (the target device must be online — the focused device if more than one is bound, or the only bound device otherwise). The server appends a point every couple of seconds from the same live telemetry the map marker uses, tied to whichever mission is currently open.
- Click **Zastavit nahrávání** after landing to end the recording.
- Past recordings for the currently open mission are listed below, each with its start time. Click the eye icon to draw that recording's actual flown path on the map as a solid amber line, next to the dashed planned route — a quick visual check of how closely the flight matched the plan. Click it again (or open a different mission) to hide it.
- The trash icon deletes a recording permanently.

Recordings are tied to the mission open in the editor when you start recording, not retroactively — start it before the flight, not after.
