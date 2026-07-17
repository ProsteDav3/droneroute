## Summary

Animated flythrough of the mission — a "Simulace letu" playback bar scrubs through the flight path with a live preview of the camera's field of view at every point along the way, not just at each waypoint.

## Changes

- New `lib/flightSimulation.ts`: `buildSimulationFrames` interpolates position, height, gimbal pitch, and heading between consecutive waypoints into a smooth frame sequence; heading recomputes a live bearing to the target POI on `towardPOI` legs instead of interpolating a fixed angle, so the camera keeps tracking the subject throughout the leg.
- Reused `CameraFrustum`'s existing frustum rendering for the simulated camera by exporting its `bearingTo`/`resolveHeading` helpers and converting each simulation frame into a synthetic waypoint (`frameToWaypoint`).
- New `store/flightSimulationStore.ts` holding playback state (play/pause, current frame, speed); `MapView` renders the current frame's camera frustum and drone position marker whenever a simulation is active, taking over from the waypoint-selection frustum.
- New `FlightSimulationPanel`: a floating "Simulace letu" launch button (shown once the mission has 2+ waypoints) that expands into a scrubber with play/pause, a waypoint-leg readout, and a 0.5x–4x speed selector.
