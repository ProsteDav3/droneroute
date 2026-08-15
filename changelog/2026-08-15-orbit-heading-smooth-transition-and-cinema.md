## Summary

Make orbit, facade and turbine templates actually turn the aircraft toward their target during flight, and add a "Cinema video" pacing to the orbit panel that caps the flight at 3 m/s.

## Changes

- **Fixed target-facing templates never turning toward their subject.** Orbit, Facade and Turbine waypoints carried a per-waypoint bearing under `headingMode: "fixed"`. In DJI's WPML, `fixed` means "keep the yaw the aircraft arrived with after the waypoint action" and the bearing is only read in `smoothTransition` — so the bearing was ignored and, on a Matrice 4T, the aircraft flew the entire orbit nose-first wherever it happened to point on reaching waypoint 1, with the camera panning across everything except the building. The generators now emit `smoothTransition` + the same bearing, whose contract is "yaw to this angle at the waypoint, transition evenly to the next" and which every model in the spec honours.
- The store no longer rewrites those waypoints to `towardPOI` on apply. The flown mission's own file, retrieved back from DJI Cloud, showed `towardPOI` correctly written with the POI's coordinates on every waypoint — that is what the aircraft was given and did not act on — so templates do not rely on it. Waypoints still keep a `poiId` reference to the POI the template created, for the editor, KMZ round-trip and 3D flythrough.
- Added **Cinema video** to the orbit panel's capture picker: continuous recording as with Video, but every waypoint capped at 3 m/s instead of the 5 m/s survey pace. Modelled as a flag beside the capture mode rather than a third mode value, since the generators and every other panel branch on `"video"`/`"photo"` and a third value would slip through them and record nothing.
- The capture toggle now reports mode and cinema pacing in one callback so a panel applies both in a single state update.
