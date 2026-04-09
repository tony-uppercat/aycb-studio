# Guardrails & Productivity Kit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add post-edit type checking, CLAUDE.md scope/debug rules, and a /restart skill to reduce buggy code, wrong debugging, and unsolicited changes.

**Architecture:** Three independent changes — a project-level settings file, CLAUDE.md rule additions, and a new skill folder. No code changes, no dependencies.

**Tech Stack:** Claude Code hooks (settings.local.json), Markdown (CLAUDE.md, SKILL.md)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `.claude/settings.local.json` | Post-edit tsc hook |
| Modify | `CLAUDE.md` | Add rules 13, 14 + Backend Wiring Check section |
| Create | `skills/restart-backend/SKILL.md` | Backend restart skill |

---

### Task 1: Post-edit type check hook

**Files:**
- Create: `.claude/settings.local.json`

- [ ] **Step 1: Create project-level settings**

```json
{
  "hooks": {
    "postToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "cd frontend && npx tsc --noEmit --pretty 2>&1 | head -20",
            "timeout": 30000
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Verify hook works**

Edit any .tsx file (e.g., add a blank line to `frontend/src/nodes/prompt-editor/PromptEditorNode.tsx` then remove it). The hook should run tsc and show no errors.

- [ ] **Step 3: Verify hook catches errors**

Temporarily add a type error to a .tsx file (e.g., `const x: number = "hello"`). The hook should show the error. Then remove the error.

---

### Task 2: CLAUDE.md scope and debugging rules

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add rule 13 (Scope Discipline)**

After rule 12 in the `## Rules (Non-Negotiable)` section, add:

```markdown
13. Modify ONLY the files specified or directly required. Never add useEffect, hooks, refactors, or "improvements" not requested. Never modify .env as a side effect. If something else needs changing, ask first.
```

- [ ] **Step 2: Add rule 14 (Debugging Protocol)**

```markdown
14. After 2 failed fix attempts: STOP. Invoke superpowers:systematic-debugging skill. Check console/terminal errors, last 3 commits, declare root cause before proposing any fix. Never try a 3rd fix without root cause.
```

- [ ] **Step 3: Add Backend Wiring Check section**

After the `## Running` section (after the restart mechanism checklist), add:

```markdown
## Backend Changes Checklist

After modifying any backend endpoint or model:
1. Verify frontend types match the new response shape.
2. Verify UI components reference correct endpoints.
3. Verify new fields appear in dropdowns/forms.
4. Test the endpoint with curl before claiming done.
```

---

### Task 3: Restart backend skill

**Files:**
- Create: `skills/restart-backend/SKILL.md`

- [ ] **Step 1: Create the skill file**

```markdown
---
name: restart-backend
description: >
  Kill the running backend and relaunch with --reload.
  Trigger on: "restart", "riavvia", "backend morto", "non risponde".
---

# Restart Backend

## Steps

1. Kill all Python processes:
   ```powershell
   powershell.exe -Command "Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force"
   ```

2. Wait for port to free:
   ```bash
   sleep 2
   ```

3. Verify port is free:
   ```bash
   curl -s --max-time 2 http://localhost:5101/api/health && echo "ERROR: backend still alive" || echo "OK: port free"
   ```

4. Relaunch with --reload (background):
   ```bash
   cd C:/Users/upper/Documents/00_aycb_v2 && python -m uvicorn src.api:app --host 0.0.0.0 --port 5101 --reload &
   ```

5. Wait and verify:
   ```bash
   sleep 4 && curl -s http://localhost:5101/api/health
   ```

6. Confirm the `started_at` timestamp is recent (within last 30 seconds).

## If it fails

- Check if another process holds port 5101: `netstat -ano | grep :5101`
- Kill specific PID: `taskkill //PID <pid> //F`
- If nothing works, user must close the CMD window manually and relaunch AYCB Studio.bat
```

- [ ] **Step 2: Verify skill is discoverable**

The skill should appear in the skill list when starting a new session. No registration needed — skills/ folder is auto-discovered per CLAUDE.md.

---

### Task 4: Commit

- [ ] **Step 1: Commit all guardrail changes**

```bash
git add .claude/settings.local.json CLAUDE.md skills/restart-backend/SKILL.md \
  docs/superpowers/specs/2026-04-10-guardrails-design.md \
  docs/superpowers/plans/2026-04-10-guardrails.md
git commit -m "[feat] Guardrails — post-edit tsc hook, scope/debug rules, restart skill"
```
