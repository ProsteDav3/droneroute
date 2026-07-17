# SORA-lite risk assessment and permit tracking

Added a lightweight risk-assessment questionnaire per mission (ground/air
risk class plus a mitigations checklist — ground observer, safety net,
parachute system, geofencing, reduced-area operations), and permit/
authorization tracking (description, reference, expiry date, issuer).
Both are explicitly simplified planning aids, not an authoritative SORA
submission or a replacement for official paperwork.

Expired or soon-to-expire (within 14 days) permits now surface a warning
in the same banner area as the other flight warnings.

## Implementation notes

- New tables: `mission_risk_assessments` (one row per mission, upserted via
  `PUT /api/risk-assessments/:missionId`) and `mission_permits` (CRUD via
  `/api/permits`).
- All routes require auth and verify the caller owns the referenced
  mission before reading/writing.
