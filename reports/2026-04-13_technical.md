# AYCB v2 — Technical Report 2026-04-13

## Summary
Fixed Bracket Parser data flow: override/pin values weren't propagating to output. Two memo bugs in `useBracketParser.ts`. Also committed pending LAN access fixes.

---

## Bug Fixed

### Bracket Parser override/pin values not propagating — `useBracketParser.ts`

**Root cause 1:** `resolvedValues` memo (L116-127) computed template substitution values using only `overrides` and `jsonDefs`, completely ignoring `bracketPinValues`. The `bracketPinValuesJson` dependency was present (triggering recomputation) but pin values were never read in the logic. Template mode output always showed original/jsonDef values regardless of pin connections.

**Root cause 2:** `outputPins` memo (L149-156) was missing `bracketPinValuesJson` from its dependency array. Per-pin outputs to downstream nodes used a stale `resolveVal` closure that captured outdated `bracketPinValues`.

**Fix:** `resolvedValues` now delegates to `resolveVal()` which has the correct priority chain (pin > override > jsonDef > name). `outputPins` deps now include `bracketPinValuesJson`. Single resolution logic, no duplication.

---

## Files Changed

| File | Change |
|---|---|
| `frontend/src/nodes/bracket-parser/useBracketParser.ts` | `resolvedValues` uses `resolveVal`; `outputPins` deps include `bracketPinValuesJson` |
| `frontend/src/review/services/socket.ts` | Socket.IO relative path (no cross-port for LAN) |
| `src/api.py` | CORS wildcard for LAN access |
| `src/cli.py` | Default host `0.0.0.0` for LAN bind |

---

## Tests
- Frontend: 32 bracket parser tests pass
- No regressions

---

## Next Tasks
1. Ctrl+Alt drag copy: original should stay in place, copy gets dragged (`useKeyboardShortcuts.ts`)
2. 2K default resolution in Generate Image
3. Pricing display in model dropdown
4. Selection issue investigation
