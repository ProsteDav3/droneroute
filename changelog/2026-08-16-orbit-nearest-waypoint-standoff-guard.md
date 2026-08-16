## Summary

Stop an orbit being applied when one of its waypoints would come closer to the locked camera target than the subject needs to fit in frame — the case where a waypoint flies over the building and the shot shows its roof.

## Changes

- The config panel now checks the **waypoints actually flown** against the minimum standoff for the subject (its height, and for a real building its widest silhouette from the flown bearings too). When one is too close it names the waypoint with both distances and disables **Použít** until the radius or the centre is moved.
- Previously the check compared the orbit's `radiusM` — the distance from its own centre — against that minimum. With a POI locked off-centre those are different numbers: on a reported mission a waypoint passed 5.9 m from a 9 m cottage that needs 9.4 m, while the check saw "17 m, fine" and stayed silent. The centre-drag clamp did use the right distance, but only ran while the centre was being dragged; changing the radius, the arc or the waypoint count afterwards re-broke it with nothing looking.
- The drag clamp and the new guard now share one helper (`orbitMinStandoffM`), so they cannot disagree about how much room the subject needs.
