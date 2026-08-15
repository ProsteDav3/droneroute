## Summary

Split the orbit panel's single "POI height" into an object height (what has to fit in shot) and an aim height (where the camera actually points), add a lock that holds the flight altitude still while the rest of the linked framing keeps working, and fix the gimbal pitch field silently switching the orbit to a different aiming rule.

## Changes

- Added an **aim height** to orbits: the exact height the camera points at, defaulting to the middle of the object and following it until you type your own value, after which it is taken literally. A 20 m building can now be shot looking at its roof, its middle, or its base. An "auto" button returns the field to following the middle.
- Renamed "POI height" to **object height** and documented it as the framing input it always was — it is what has to fit inside the camera's field of view, not where the camera looks.
- Added a **lock on flight altitude**, for flying at a height dictated by obstacles rather than by framing. With it locked, changing the radius re-aims the gimbal instead of moving the drone, editing the gimbal angle solves for a radius, and re-arcing a building orbit no longer re-derives the standoff. Typing an altitude still works — the lock only stops the framing math from moving it on its own.
- A locked altitude can no longer guarantee the whole object fits (moving the altitude is how the framing solve guarantees that), so the panel now checks the real geometry against the camera's field of view and **warns when the subject would be cropped**, instead of letting it through unannounced.
- Fixed the gimbal pitch field solving against the object's full height rather than the aim height. Retyping the angle the panel itself displayed moved the drone several metres upward and silently switched the orbit from aiming at the middle of the object to aiming at its top — after which it stayed there.
- A locked POI now points at the aim height whether or not the target is a building, replacing the previous building/non-building split, and a created POI is placed at the aim height rather than at the object's full height.

- Replaced the ground-to-top angle bisector with a single aiming rule: the camera points at a height. The bisector centres an object's angular extent marginally better but corresponds to no particular height, so an aim-height field could not state it truthfully and every inverse solve disagreed with the angle on screen by a degree or two — which at a 200 m radius is metres of altitude. Pitches on existing orbits shift by about a degree the first time a linked field is edited.
- Retyping the gimbal angle the panel already shows is now a no-op. The field works in whole degrees, and at a long radius one degree spans several metres of altitude, so re-solving otherwise landed in the middle of that degree's band instead of back where it started.

Stored orbits are not recalculated on load, export, or flight simulation, and the older locked-POI aiming rules are kept for orbits that carry no aim height — so nothing re-aims a mission that isn't edited.
