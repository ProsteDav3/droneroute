# Mission settings

Configure your drone model, camera, altitude reference, and safety options for the mission.

## What you can do

- **Choose your drone model**: M300 RTK, M350 RTK, M30/M30T, M30 Dock, Mavic 3E/3T/3M/3D/3TD, Mini 4 Pro, Matrice 4T (default for new missions — see note below).
- **Choose a camera/payload** available for the selected drone.
- **Set a global flight speed** and takeoff security height.
- **Set a target flight duration instead of a speed**: enter how long the flight should take (in seconds) and click "Dopočítat rychlost" to have the flight speed computed backward from the current route — handy when the flight time itself is the actual constraint (for example, a construction time-lapse project where every one of dozens of individual revisit flights needs to fit a fixed video-length budget) rather than a specific speed. Reports when the target isn't achievable within the app's supported speed range for the current route. By default, waypoints with their own individually-set speed keep it unaffected; if the mission has any, a checkbox appears to override them too and put the whole mission on one uniform, computed speed instead.
- **Choose a height reference**:
  - Relative to start point.
  - EGM96 (MSL) — altitude above mean sea level.
  - Above ground level.
- **Set what happens when the mission ends**: go home, land automatically, return to the first waypoint, or hover.
- **Set what happens if the remote controller connection is lost**: return home, land, or hover.
- **Set the transit speed** (speed used to fly to the first waypoint).
- **Set maximum battery minutes** so the app can warn you if the estimated flight time exceeds your battery capacity.
- **Move or rotate the whole mission at once**: enter a north/east offset (in meters) and click "Posunout", or an angle (degrees) and click "Otočit", to shift or rotate every waypoint, POI, obstacle, and building together — handy when the real-world object the mission was planned around has moved, without redrawing anything. Rotation pivots around the mission's own waypoint centroid. Heights are untouched by either.

## How it works

1. Open the mission settings panel in the sidebar.
2. Select your drone and camera.
3. Adjust altitude reference, speeds, and safety options.
4. The app uses these settings when exporting the mission file and when calculating flight time estimates.

## Good to know

- The available cameras change depending on which drone you select.
- If the estimated flight time exceeds the battery limit you set, a warning appears.
- The flight time estimate accounts for more than straight-line distance ÷
  speed: it adds acceleration/deceleration time at the start and end of the
  flight, extra time for waypoints that bring the drone to a full stop to
  turn, a smaller slowdown for sharp turns that aren't otherwise smoothed
  out, and any explicit hover-action time. It's still an estimate, not an
  exact match to what DJI's own apps calculate (their flight-dynamics model
  isn't published), but it's meaningfully closer than a flat distance/speed
  calculation.
- Height reference affects how altitude values are interpreted by the drone — choose the one that matches your operational needs. The default is **above ground level**.
- **Heading mode is only a default**: it applies to waypoints that don't have their own heading override. Templates that need the drone to track a target as it flies (Orbit, Turbine blade inspection, Facade's thermal recommendation) set each of their own waypoints to a specific mode regardless of this setting — so seeing a different heading mode on a selected waypoint than in Mission settings doesn't mean either one is wrong; the per-waypoint value is what actually flies.
- All height fields enforce a minimum of 1 meter.
- You can set default values for all mission settings in the **Mission defaults** tab of the settings dialog. New missions will use those defaults instead of the factory defaults.
- **Matrice 4T is the default drone for new missions**, with defaults (35 min max battery, 7 m/s flight speed) set from DJI's published specs. Its internal WPML drone/camera identifiers were confirmed by inspecting a real DJI Pilot 2 export from an RC Plus 2 + Matrice 4T.
