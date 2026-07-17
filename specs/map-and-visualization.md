# Map and visualization

An interactive map where you plan flights and see everything at a glance.

## What you can do

- Pan, zoom, and interact with a Mapbox GL JS satellite map.
- Switch between **satellite** and **street** (dark) map styles using the bottom-left buttons.
- Toggle between **2D** and **3D** view modes.
- Search for any location using the **geocoding search box** (top-left magnifying glass icon). Type a place name, address, or landmark and the map flies there.
- See the flight path as a dashed line connecting all waypoints.
- See colored lines from waypoints to POIs showing camera aim (green = correct pitch, red = needs adjustment).
- See obstacle polygons drawn on the map.
- Click extruded 3D buildings to **convert them to obstacles** via a popup.
- Use the floating toolbar to switch between waypoint mode, POI mode, and template tools.
- View an elevation graph below the waypoint list that shows altitude changes across the flight, with the real ground elevation along the path overlaid as a shaded terrain profile.
- See live previews when configuring templates before placing them.

## 3D mode

When you switch to 3D:

- **Terrain** — real-world elevation data from Mapbox DEM renders mountains and valleys.
- **Extruded buildings** — 3D buildings appear at zoom level 14+, with height and footprint from OpenStreetMap data.
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

- Click the **"Simulace letu"** button (bottom-center of the map, appears once your mission has 2+ waypoints) to start an animated flythrough of the flight path.
- A scrubber bar lets you play/pause, jump to any point in the flight, and change playback speed (0.5x–4x).
- A camera frustum follows the simulated drone position, showing exactly what the camera would see — including gimbal pitch — at every point along the path, not just at each waypoint.
- On legs where a waypoint's heading is set to **point toward a POI**, the simulated camera keeps tracking that POI continuously through the leg rather than snapping between fixed angles.
- The readout shows which leg of the mission ("WP X / Y") the simulation is currently flying.

## How it works

The map is the central workspace. Everything you do — placing waypoints, POIs, obstacles, or templates — happens directly on the map. The sidebar shows lists and settings, and the two stay in sync.

## Good to know

- The default view is **satellite** imagery in **2D** mode. Users can change these defaults in the **Visualization** tab of the settings dialog — the preferred view mode and map style are applied when the app loads.
- The map opens centered on Barcelona by default. Self-hosted instances can change the starting location by setting `DEFAULT_MAP_VIEW` in their environment (or `docker-compose.yml`), formatted as `lat,lng` or `lat,lng,zoom`, so the map opens on their local area. Invalid or out-of-range values fall back to the built-in default.
- You can click waypoints and POIs directly on the map to select and edit them.
- The geocoding search box collapses to an icon when not in use to save space.
- The same address-or-coordinates search also appears inline in the orbit template panel and in the waypoint/POI settings — entering a location there both flies the map there and moves the orbit center, waypoint, or POI to that exact spot.
- A Mapbox access token is required. Self-hosted instances must set `MAPBOX_TOKEN` in their `.env` file.

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
- Recent Health Management System (HMS) warnings reported by the aircraft — a fault code, a battery cell imbalance, and similar — appear at the bottom of the same panel.
- All of this updates automatically over a live connection; no manual refresh needed.

### Live mission progress

While a device is online and flying, a "Průběh mise" badge appears at the top of the map showing percent complete and an ETA to the last waypoint, worked out by matching the aircraft's live position against the currently open mission's own flight path.

- In the waypoint list, every waypoint the aircraft has already flown past gets a green checkmark badge and is dimmed, so you can see progress at a glance without watching the map.
- The ETA needs the aircraft to be moving at a meaningful speed — it shows "ETA neznámá" while stationary or just after takeoff, rather than an unreliable estimate.
- This assumes the mission open in the editor is the one actually flying — with one aircraft active at a time (the common case), that holds; it isn't a per-mission dispatch tracker for multiple simultaneous flights.
