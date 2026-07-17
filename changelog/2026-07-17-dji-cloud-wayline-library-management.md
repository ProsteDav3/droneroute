## Summary

DJI Cloud uploads no longer pile up timestamped duplicates on every retry, and the wayline library can now be managed straight from SkyRoute.

## Changes

- Re-uploading a mission (or a segment) under the same name now overwrites the existing wayline in the workspace's library in place, instead of always minting a new `name-20260101-120000` file. Falls back to the old timestamped-name behavior only if the overwrite itself fails.
- New **DJI Cloud — wayline knihovna** sidebar panel: lists every file in the workspace's library with its last-updated date, and lets you delete ones you no longer need.
- New backend `GET /api/dji-cloud/waylines` endpoint (list) backing both features.
