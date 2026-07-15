/**
 * Airspace provider registry.
 *
 * Import country-specific providers here and add them to the `providers` array.
 * The `fetchZones` function fans out to every registered provider in parallel.
 */

import type { AirspaceProvider, AirspaceZone, BBox } from "./types.js";
import { enaireProvider } from "./provider-enaire.js";
import { dgacProvider } from "./provider-dgac.js";
import { natsProvider } from "./provider-nats.js";
import { rlpProvider } from "./provider-rlp.js";

const providers: AirspaceProvider[] = [
  enaireProvider,
  dgacProvider,
  natsProvider,
  rlpProvider,
];

/**
 * Query registered providers and return a merged list of zones that
 * intersect the given bounding box.
 *
 * @param providerIds – when supplied, only query these providers.
 */
export async function fetchZones(
  bounds: BBox,
  providerIds?: string[],
): Promise<AirspaceZone[]> {
  const active =
    providerIds && providerIds.length > 0
      ? providers.filter((p) => providerIds.includes(p.id))
      : providers;

  const results = await Promise.allSettled(
    active.map((p) => p.fetchZones(bounds)),
  );

  const zones: AirspaceZone[] = [];
  for (const r of results) {
    if (r.status === "fulfilled") {
      zones.push(...r.value);
    }
  }
  return zones;
}

/** Return metadata for all registered providers. */
export function listProviders() {
  return providers.map((p) => ({ id: p.id, name: p.name }));
}

export { providers };
export type { AirspaceProvider, AirspaceZone, BBox } from "./types.js";
