# Draggable template panel, click-to-create orbit, live field updates, and fixed orbit POI marker

Four UI fixes/additions reported while planning an orbit mission.

## Added: drag the template config panel out of the way

The template config panel (Orbit/Grid/Facade/Solar/Pencil) always opened
bottom-center over the map, which could sit right on top of the area being
worked on — the only way to see underneath it was to zoom out. It can now
be dragged by its title bar (grab the grip icon next to the template name)
to anywhere within the map area. Position resets to the default on the next
template panel open.

## Fixed: orbit's locked POI marker moved when it shouldn't, and stole clicks from the orbit handle

When "Uzamknout POI" ("Lock POI") is checked, a second marker (blue) drops
at the flight circle's center to mark the fixed camera target, separate
from the orbit's own center handle (yellow). Both markers start at the
exact same spot right after locking. Two problems:

- The blue POI marker was draggable, so it was easy to nudge by accident —
  defeating the point of "locking" it — and then need to drag it back.
- The blue marker rendered after (visually on top of) the yellow orbit
  handle, so clicking to grab the orbit handle right after locking often
  grabbed the POI marker instead.

The POI marker is now fixed in place (not draggable) once locked, and
renders first so the orbit's center handle sits on top of it and is always
the one you actually grab.

## Added: create an Orbit with a single click/tap, not just a drag

Orbit could previously only be created by dragging on the map (drag start =
center, drag distance = radius) — a plain click did nothing. That made it
unusable on a tablet/touchscreen where a mouse-drag gesture isn't
practical. A plain click or tap now places a default-radius (30 m) orbit
immediately, ready to fine-tune in the config panel. Dragging still works
exactly as before for picking the exact radius by hand in one motion. Grid
and Facade still require a drag (they need two distinct corners, so a
single point has no sensible default).

## Fixed: template panel number fields required clicking away to take effect

`NumericInput` (used for radius, altitude, POI height, gimbal pitch, etc.
throughout the template panel) only committed its value on blur, so linked
fields (e.g. Orbit's radius/altitude/POI-height framing) wouldn't
recalculate until clicking somewhere else first. It now fires the same
update live, on every keystroke that parses to a valid number — min/max
clamping still only happens on blur, so typing a multi-digit number that
starts out of range isn't snapped mid-keystroke, and clearing the field to
retype doesn't briefly commit a fallback value.
