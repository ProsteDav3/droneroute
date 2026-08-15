## Summary

Stop the orbit panel deriving a gimbal angle outside the range it offers, and say so when the requested aim can no longer be reached.

## Changes

- Clamped every derived orbit pitch to the panel's own `-120°…45°` range, now defined once and shared by the geometry and the input. Aiming at a height above the aircraft — a 60 m subject aimed at 30 m, flown at 19 m from 10 m out — solved to roughly +48°, past the bound the field itself declares and past what the aircraft accepts in WPML.
- Added a warning for that case: a clamped pitch no longer points where the panel says it does, so it says the camera would have to look steeply upward and suggests raising the flight altitude or lowering the aim.
- Extended the browser test at 375 px to type into the fields rather than only assert they are visible, so it exercises real hit-testing — a visibility assertion passes straight through an element being covered.
