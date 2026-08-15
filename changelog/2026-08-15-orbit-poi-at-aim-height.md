## Summary

Make an orbit's created POI sit at the aim height (the middle of the object by default) in every case, so the aircraft looks where the panel says — not at the roof.

## Changes

- An orbit with a locked POI ("Uzamknout POI") or a manually drawn orbit created its POI at the object's **full** height and aimed the per-waypoint gimbal at that same roofline, while the panel and the framing math assumed the middle. Field-observed on a Matrice 4T: object 9 m produced a POI at 9 m and pitch −38° at waypoint 1, where the middle is 4.5 m / −48°. The aircraft tracks the POI point written into the mission, so it looked at the roof. The POI is now placed at the aim height (`aimHeight ?? objectHeight / 2`) — the same default the gimbal solve and the panel use — and a locked POI's per-waypoint pitch aims at that height, building or not.
- Removed the last two "aim at the ground-to-roof bisector for a building" branches (in the orbit generator's locked-POI pitch and in the 3D flythrough), which produced a pitch that matched no height the file actually carried, so the preview and the flown angle disagreed. The flythrough now points at the POI at the height the POI actually has.
