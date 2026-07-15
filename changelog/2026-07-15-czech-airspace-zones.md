# Czech Republic airspace zones

The airspace restriction overlay (Settings → Visualization → Extra layers)
previously only covered Spain (ENAIRE), France (DGAC), and the United
Kingdom (NATS) — not the Czech Republic, despite being the app's home
market.

Added **ŘLP ČR (Czech Republic)** as a fourth provider, using the official
UAS geographic zone data published by Řízení letového provozu (Air
Navigation Services of the CR) at https://aim.rlp.cz/?p=uas-gz. Zones are
shown as a grid of cells, each carrying the altitude (AGL) above which
flying inside that cell requires coordination with air traffic control —
classified as **restricted**, the same category NATS uses for zones around
UK aerodromes.

## Implementation notes

- ŘLP publishes several GeoJSON files; only `GRID_CTR` (controlled
  airspace, ~7 MB) is used. The individually-named zone files (`LKR*.json`)
  were skipped — some are tens of megabytes for a single zone identifier
  (e.g. railway-corridor restrictions with thousands of polygons), too
  large to reasonably fetch and cache for this purpose.
- Like the NATS provider, the data is a static whole-file download (no
  bbox-filtered query API), served from a dated "actual" folder that
  changes as ŘLP publishes new data cycles — the current URL is discovered
  from the index page rather than hardcoded, and the downloaded dataset is
  cached server-side for 24 hours.
