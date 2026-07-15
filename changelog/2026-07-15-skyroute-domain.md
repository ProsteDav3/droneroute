## Summary

Switches the app's canonical domain from `dronmapa.skydata.cz` to
`skyroute.skydata.cz`, matching the SkyRoute rebrand.

## Changes

- `og:url` in `packages/frontend/index.html` updated to
  `https://skyroute.skydata.cz`.
- Added a new Fly.io TLS certificate for `skyroute.skydata.cz` on the
  `skydata-droneroute-kcp` app (`flyctl certs add`).

## Known limitations

- The old `dronmapa.skydata.cz` Fly cert and DNS record are still live —
  removing them is a separate, deliberate decision left to the user since
  it affects external DNS they manage themselves.
- The new domain requires a DNS record (A/AAAA or CNAME, per
  `flyctl certs setup skyroute.skydata.cz`) added by the user before the
  certificate can validate and the domain becomes reachable.

## Tests

- `npm run build` passing (frontend/backend logic unaffected — single
  static meta-tag change).
