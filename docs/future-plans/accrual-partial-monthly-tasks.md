# Partial monthly FX tasks

- [x] Commit the read-boundary plan before implementation.
- [x] Opt in the monthly HTTP read and recognize its explicit partial response.
- [x] Keep monthly errors local and withhold derived seasonality/averages.
- [x] Verify missing/known FX, repair, request identity and native behavior.
- [x] Run focused checks and update server progress records.

Verified: monthly HTTP failing-before503, then known/missing FX and dated-rate repair with strict internal service coverage; focused UI210 and stale-response47 tests; frontend whole-source gate1202 files/23459 tests. Parent task list retains final merged-source validation.
