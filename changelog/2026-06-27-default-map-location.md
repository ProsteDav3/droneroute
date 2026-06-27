## Summary

Let self-hosted instances configure the map's starting location so it opens on
their local area instead of the built-in Barcelona default.

## Changes

- Add a `DEFAULT_MAP_VIEW` environment variable (`lat,lng` or `lat,lng,zoom`),
  surfaced to the frontend at runtime via the `/api/config` endpoint
- Validate the value — invalid, malformed, or out-of-range input falls back to
  the built-in default
- Document the new variable in `.env.example`, `docker-compose.yml`, the README,
  and the map spec
