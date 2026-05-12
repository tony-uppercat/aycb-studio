## Summary

<!-- 1-3 sentences on what this PR does and why. Tie to an issue if
     applicable (e.g. "Closes #42"). -->

## Changes

<!-- Bullet list of the concrete changes. Group by concern if the PR
     touches multiple subsystems. -->

-

## Test plan

<!-- What did you actually run? Mark completed boxes. The CI will run
     pytest + tsc + vitest automatically; this section is for the
     checks CI can't cover. -->

- [ ] `python -m pytest` passes locally
- [ ] `cd frontend && npx tsc --noEmit` clean
- [ ] `cd frontend && npx vitest run` passes locally
- [ ] `python scripts/audit_smoke.py` 10/10 (if backend was touched)
- [ ] Manual UI verification in browser (if frontend was touched)

## Notes for reviewer

<!-- Anything subtle to pay attention to: a rename, a migration step,
     a behaviour change that is intentional. Link prior audits or
     design docs in reports/ when relevant. -->
