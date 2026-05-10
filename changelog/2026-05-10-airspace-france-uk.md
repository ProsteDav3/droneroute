## Summary

Add airspace restriction zones for France (DGAC) and the United Kingdom (NATS) alongside the existing Spain (ENAIRE) provider. Users can now enable each country independently via checkboxes in the Visualization settings.

## Changes

- Add France provider querying the Géoplateforme WFS for UAS restriction zones (open category)
- Add United Kingdom provider that downloads and caches the NATS KMZ flight restriction dataset (updated every AIRAC cycle)
- Replace the single "Airspace restrictions" checkbox with per-country toggles: Spain (ENAIRE), France (DGAC), United Kingdom (NATS)
- Backend now accepts an optional `providers` query parameter to limit which providers are queried
- Add `/api/airspace/providers` endpoint listing available providers
