## Summary

Stop the orbit panel's "Mířit na výšku" field silently switching from automatic to a pinned value just because it was focused and left.

## Changes

- `NumericInput` no longer reports a change on blur when the value did not change. Blurring an untouched field used to fire `onChange(value)` anyway — harmless for a plain number, but a field whose _unset_ state means "automatic" (the orbit panel's aim height: unset = follow the middle of the object) got pinned to whatever it happened to display, just by being tabbed through. That is how a user's orbit ended up with the aim height baked in at the object's full height, and why re-applying the template ("Upravit šablonu" → Použít) could not move its POI to the middle: the stored params said "the user chose 9".
- The behaviour is now what the panel promises: the aim height follows half the object height until you actually type a value; a typed value stays put (so an orbit can deliberately aim at the roof); the "auto" button returns it to following.

For an orbit already saved with the pinned value: open "Upravit šablonu", click **auto** next to "Mířit na výšku", then Použít and save — the POI moves to the middle.
