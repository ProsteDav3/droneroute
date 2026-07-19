### Fixed

- Starting a live video feed still reported failure even with the correct `videoId`. Traced live: the aircraft accepts the command and replies success (`result: 0`) over MQTT, but the DJI Cloud reference server's own REST response then crashes trying to deserialize that reply into its response body — a bug in the platform itself, unrelated to the request. The stream is already live by the time that crash happens, so this specific, narrowly-matched error is now treated as success instead of failing the whole request.
