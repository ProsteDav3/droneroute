## Summary

Live DJI Cloud telemetry now actually shows telemetry — altitude, speed, and battery — instead of just a moving dot on the map.

## Changes

- The live aircraft marker on the map now shows a small readout below the icon: altitude, horizontal speed, and battery percentage, all updating in real time. The icon rotates to the aircraft's heading; the readout stays upright.
- The sidebar's DJI Cloud device panel now shows each device's live battery percentage (cross-referenced from the telemetry stream), device model, and how long ago it last logged into the platform.
- Documented all of this in `specs/map-and-visualization.md` (previously undocumented).
- Swept remaining `console.error` calls in `routes/djiCloud.ts` to the structured logger.
