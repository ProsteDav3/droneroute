### Fixed

- Fixed the flight simulation playback bar sometimes silently swallowing clicks meant for a template config panel's Apply/Cancel buttons — both float in the same bottom-center spot over the map, and a stacking-context quirk (Mapbox's own map container forces its own z-index scope) let the simulation bar win regardless of its lower declared z-index. The simulation bar now stays hidden while a template is being placed or edited.
