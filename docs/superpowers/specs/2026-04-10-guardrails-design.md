# Guardrails & Productivity Kit — Design Spec

**Goal:** Reduce the top 3 friction points from insights report: buggy code (66), wrong debugging (48), unsolicited changes (14).

---

## 1. Post-Edit Type Check Hook

**Where:** `.claude/settings.local.json` (project-level, not global)

**Trigger:** After every `Edit` or `Write` tool call

**Command:** `cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20`

**Behavior:**
- Runs TypeScript compiler in check-only mode after each edit
- Shows first 20 lines of errors if any
- Timeout 30s — if tsc hangs, hook is skipped
- Claude sees the errors and must fix them before proceeding

**Why project-level:** tsc is specific to this project's frontend. Global hook would break other projects.

**Limitation:** This fires on ALL edits, not just .ts/.tsx files. Acceptable tradeoff — tsc is fast (~2-3s) and catching errors on backend edits that affect shared types is actually useful.

---

## 2. CLAUDE.md Additions

### Rule: Scope Discipline (add under ## Rules)

```
13. Modify ONLY the files specified or directly required. Never add useEffect, hooks, refactors, or "improvements" not requested. Never modify .env as a side effect. If something else needs changing, ask first.
```

### Rule: Debugging Protocol (add under ## Rules)

```
14. After 2 failed fix attempts: STOP. Invoke superpowers:systematic-debugging skill. Check console/terminal errors, last 3 commits, declare root cause before proposing any fix. Never try a 3rd fix without root cause.
```

### Section: Backend Wiring Check (add after ## Running)

```
## Backend Changes Checklist

After modifying any backend endpoint or model:
1. Verify frontend types match the new response shape
2. Verify UI components reference correct endpoints
3. Verify new fields appear in dropdowns/forms
4. Test the endpoint with curl before claiming done
```

---

## 3. Skill: /restart

**Where:** `skills/restart-backend/SKILL.md`

**What it does:**
1. Kill all python processes via PowerShell: `Get-Process python | Stop-Process -Force`
2. Wait 2 seconds for ports to free
3. Launch uvicorn: `python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload`
4. Wait 4 seconds, then verify `curl localhost:5101/api/health`
5. Report success or failure

**Safety:** Kills ALL python processes. User must be aware. This is acceptable because on this machine, the only python processes are AYCB-related.

---

## What NOT to do

- Do NOT add pre-commit git hooks — the CLAUDE.md already says "run tests before every commit"
- Do NOT add hooks that block on Python syntax checks — too noisy, pytest catches these better
- Do NOT add scope-limiting hooks that parse tool input JSON — too fragile, the CLAUDE.md rule is enough
- Do NOT restructure existing skills or CLAUDE.md sections — only append
