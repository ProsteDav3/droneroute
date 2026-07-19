### Fixed

- The Orbit template's "keep the whole object framed" linking (radius/altitude/POI height/gimbal pitch) silently degraded to aiming the gimbal at a single point whenever the mission had no drone/camera model selected — the exact case where a pilot most needs the automatic framing, since they haven't picked hardware yet. It now uses a typical wide-angle lens as a stand-in field of view instead of skipping the framing math, so the whole target stays in frame by default; picking an actual drone still refines it to that camera's real field of view.
