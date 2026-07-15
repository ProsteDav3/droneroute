# Draggable template panel + fixed orbit POI marker

Two UI fixes reported while planning an orbit mission.

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
