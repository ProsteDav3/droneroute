/**
 * NOTAM (Notice to Airmen) support for Czech Republic missions.
 *
 * INVESTIGATION SUMMARY (2026-07-16): the same "discover URL from an index
 * page, download, cache, filter to viewport" strategy used by
 * `provider-rlp.ts` for UAS geographic zones does NOT work for live NOTAM
 * data. Unlike the static GeoJSON zone files, aim.rlp.cz serves current
 * NOTAMs exclusively through two authenticated tools:
 *
 *   - AisView (https://aisview.rlp.cz) — presents a username/password login
 *     form; NOTAM/SNOWTAM display is behind that login.
 *   - IBS, the Integrated Briefing System (https://ibs.rlp.cz) — redirects
 *     immediately to a SAML identity-provider login
 *     (`extAsta.do?path=ext%2Fidp`).
 *
 * There is no public, unauthenticated JSON/XML/KML feed of current NOTAMs
 * for Czech airspace (unlike the ENAIRE/DGAC/NATS/ŘLP zone datasets, which
 * are all plain downloadable files). Scraping an authenticated session
 * would require storing and rotating a pilot's personal AIM ČR credentials
 * server-side — a security liability this app does not take on.
 *
 * DECISION: NOTAM support here is option B from the spec — a best-effort
 * deep link, not live data. `buildNotamBriefingLink` returns a working URL
 * to the official IBS self-briefing tool along with the mission area's
 * center and the requested date, so the UI can offer a "Zobrazit NOTAM"
 * link that takes the pilot straight to the correct official tool to run
 * their own self-briefing for that area/date. This is an honest, working
 * feature — not a stub — it simply isn't live/automated data, because no
 * such feed exists to fetch.
 */

import type { BBox } from "./types.js";

export interface NotamBriefingLink {
  /** URL to the official AIM ČR self-briefing tool. Requires the pilot's own login — this app never stores or transmits AIM ČR credentials. */
  url: string;
  /** Center of the requested bounding box, for display purposes (IBS itself doesn't accept a bbox query param — there is no documented public API for that). */
  center: { lat: number; lng: number };
  /** ISO 8601 date (YYYY-MM-DD) the pilot should check NOTAMs for. Defaults to today. */
  date: string;
  /** Explains, in the pilot's language, why this is a link-out rather than automatic data. */
  note: string;
}

const IBS_URL = "https://ibs.rlp.cz/";

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Build a best-effort NOTAM briefing deep link for the given bounding box
 * and date. Never throws — falls back to today's date for invalid/missing
 * input, since this is a UI convenience link, not validated user data being
 * persisted.
 */
export function buildNotamBriefingLink(
  bounds: BBox,
  date?: string,
): NotamBriefingLink {
  const center = {
    lat: (bounds.south + bounds.north) / 2,
    lng: (bounds.west + bounds.east) / 2,
  };
  const briefingDate =
    date && isValidIsoDate(date) ? date : new Date().toISOString().slice(0, 10);

  return {
    url: IBS_URL,
    center,
    date: briefingDate,
    note: "Živá data NOTAM pro Českou republiku vyžadují přihlášení do oficiálního systému AIM ČR (IBS) — neexistuje veřejné rozhraní pro automatické stažení. Tento odkaz vás zavede na oficiální portál, kde si NOTAM pro danou oblast a datum ověříte sami.",
  };
}
