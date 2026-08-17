/**
 * Telling a segment wayline apart from a whole-mission one, by name.
 *
 * Segments are uploaded as `<mission>-seg-3-of-71`, optionally with a
 * `-YYYYMMDD-HHMMSS` suffix when a name collision forced a new one. Long
 * names are shortened from the middle before upload (the platform caps them
 * at 64 characters), which can eat the `-seg-N` part while leaving the
 * `-of-N` tail intact — so the tail is accepted on its own as well. Anything
 * else counts as a whole mission, including files created outside SkyRoute.
 */
const TIMESTAMP_SUFFIX = String.raw`(?:-\d{8}-\d{6})?`;
const FULL = new RegExp(String.raw`-seg-\d+-of-\d+${TIMESTAMP_SUFFIX}$`);
const TRUNCATED_TAIL = new RegExp(String.raw`-of-\d+${TIMESTAMP_SUFFIX}$`);

export function isSegmentWayline(name: string): boolean {
  return FULL.test(name) || TRUNCATED_TAIL.test(name);
}
