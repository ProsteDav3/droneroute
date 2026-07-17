# Czech airspace: add uncontrolled aerodrome zones (ATZ)

Re-verified the ŘLP ČR airspace provider against aim.rlp.cz's official UAS
geographic zone index — it's confirmed to be the same authoritative source
AisView and DronView front, and the existing `GRID_CTR`-only approach was
missing its natural counterpart: **GRID_ATZ**, restricted areas in
_uncontrolled_ airspace (aerodrome traffic zones around uncontrolled
airfields).

Added `GRID_ATZ` alongside `GRID_CTR` — same file format, same parser,
fetched and cached together. Pilots now see both controlled and
uncontrolled grid-based restrictions, not just the controlled half.

## Implementation notes

- The individually-named zone files (`LKR*.json`) are still skipped: some
  are hundreds of megabytes for a single zone identifier (e.g. built-up-area
  restrictions), and unlike `GRID_CTR`/`GRID_ATZ` there's no cheaper
  "index-only" version to request instead — the only way to get
  name/bbox/altitude out of them is to download the same oversized
  polygon-heavy file. Adding a lighter-weight secondary layer for that
  category isn't actually free, so it's left out for now.
- Each grid dataset is discovered and downloaded independently
  (`Promise.allSettled`), so a missing/renamed link for one doesn't take
  down the other.
