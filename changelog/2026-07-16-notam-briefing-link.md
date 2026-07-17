# NOTAM briefing link

Investigated a scrapeable static NOTAM feed for aim.rlp.cz, following the
same "discover URL from an index page, download, cache" strategy the
airspace zone providers use. It doesn't exist: live Czech NOTAMs are served
exclusively through AisView (username/password login) and IBS, the
Integrated Briefing System (redirects straight to a SAML identity-provider
login) — there's no public JSON/XML/KML feed to fetch, unlike the static
UAS zone datasets.

Landed the documented fallback instead: `GET /api/notam` returns a
best-effort deep link to the official IBS self-briefing tool, with the
mission area's center and requested date included for display. A "Zobrazit
NOTAM pro tuto oblast" link now appears next to the airspace warnings
whenever the mission has waypoints.

This is a working, honest feature — not live data, because no such feed
exists to scrape without storing a pilot's personal AIM ČR credentials
server-side, which this app won't take on.
