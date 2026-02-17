# D33: Quarantine for Rejected Observations

**Date:** 2026-02-17
**Status:** Adopted
**Participants:** Wayne, Cole

## Decision

The daemon writes rejected observations to `queue/quarantine.jsonl` with the rejection reason attached. This applies to security rejections (injection detection, credential detection) and validation failures (malformed JSON, missing required fields, invalid types). 

Normal pipeline filtering (duplicates, below-threshold importance) does NOT go to quarantine — those are expected behavior, not errors.

Each quarantine entry includes the original observation data plus:
- `rejected_at`: ISO timestamp
- `reason`: rejection category (e.g., "injection_detected", "validation_failed", "malformed_json")
- `detail`: specific explanation

## Rationale

- Costs almost nothing to implement (one append per rejection)
- Provides a diagnostic record when things go wrong — agent bugs, schema drift, false positives
- Quarantine file is empty when the system is healthy (it's insurance)
- Logs rotate and evidence vanishes; quarantine file persists for review
- Limited scope (errors only, not normal filtering) prevents noise accumulation
