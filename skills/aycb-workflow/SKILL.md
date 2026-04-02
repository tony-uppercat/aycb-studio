---
name: aycb-workflow
description: >
  Manage AYCB Studio v2 development sessions: start, execute, compact, and close.
  Trigger on: "continue", "let's work", "next", "compact", "end session", "report",
  "what's next", or any session management phrase.
---

# AYCB v2 Workflow — Session Rhythm

## Session Lifecycle

```
OPEN → ORIENT → EXECUTE → COMPACT (if needed) → CLOSE
```

## 1. OPEN

Read in order:
1. `CLAUDE.md` (auto-read)
2. Latest `reports/*_technical.md`

Orient in 3-4 lines max:
```
Current state: [what was done last]
Open issues: [any, or "none"]
Next: [what's queued]
```

## 2. EXECUTE

One task at a time:
1. Do the thing
2. Run tests
3. Brief confirmation: "Done. [what]. Tests pass."

Commit only when Antonio asks or when a logical batch is complete.

### Pacing

| Signal | Action |
|---|---|
| "vai" / "next" | Proceed |
| "stop" / "aspetta" | Pause, summarize |
| "quick" | Minimal, fast |
| "properly" | Full implementation |
| "compact" | Run /compact |

### Checkpoint every 2-3 tasks:
```
Progress: [X/Y done]
Completed: [list]
Remaining: [list]
```

### When things break:
1. Stop
2. State what broke (1-2 lines)
3. Fix it (Antonio trusts autonomous fixes)

## 3. COMPACT

When to compact:
- After ~50 messages
- After completing a batch of work
- When context feels stale

Template:
```
/compact Preserve: 1) Current step. 2) Files changed. 3) Open issues. 4) Next task. Re-read CLAUDE.md.
```

## 4. CLOSE

When Antonio says "reports", "end session", "done":

1. Generate owner report → `reports/YYYY-MM-DD_owner.md`
2. Generate technical report → `reports/YYYY-MM-DD_technical.md`
3. Commit reports

### Owner Report
```markdown
# AYCB v2 — Session Report [DATE]

## What We Did
[2-3 sentences, plain language]

## What Changed
[Features/fixes in plain language]

## Current State
[What works now, what's left]

## Next Session
[What to do first]
```

### Technical Report
```markdown
# AYCB v2 — Technical Report [DATE]

## Files Changed
- Created: [paths]
- Modified: [paths]

## Tests
- Passing: [count]

## Known Issues
- [any]

## Next Tasks
1. [specific task]
2. [specific task]
```

## NEVER DO

- Start working without checking latest report
- Skip reports at end of session
- Continue past failing tests
- Make micro-commits (batch related work)
- Give long status recaps
