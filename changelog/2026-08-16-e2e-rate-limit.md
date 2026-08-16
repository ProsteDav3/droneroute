## Summary

Stop the end-to-end suite tripping the API rate limiter, which made whatever spec happened to run last fail with a "too many requests" page instead of its own content.

## Changes

- The Playwright harness now starts the backend with `DISABLE_RATE_LIMIT=1`. The whole suite hits one loopback IP and legitimately exceeds the production 100-requests-per-minute budget, so the last specs to run were served 429s — the mission-list visual spec rendered "Příliš mnoho požadavků" and failed on missing fixtures, which reads like an app bug rather than a harness limit. Adding any new spec pushed the suite over that edge.
- The limiter's test escape is now an explicit `DISABLE_RATE_LIMIT` flag alongside the existing `NODE_ENV=test` (vitest). The Playwright harness runs the real production build and must not claim `NODE_ENV=test`, which would also silence the backend logs a failing CI job depends on. No deployment sets either.
