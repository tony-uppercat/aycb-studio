# AYCB v2 — Technical Report 2026-04-03 (Session 5)

## Summary
Review Hub audit + test suite + debug session. 26 bugs fixed, 88 new backend tests, 16 CLAUDE.md contradictions resolved, 86 CSS variable renames, 9 feature fixes from live iPad testing.

## Commits (9)
- `9930a92` [fix] Review Hub audit — 12 frontend bugs
- `2fbc9e6` [test] Backend test suite — 98 tests, zero warnings
- `8d78738` [fix] Silent failures logged, CLAUDE.md contradictions, Socket.IO LAN
- `87ae900` [refactor] --amber → --accent across 86 usages in 8 CSS files
- `6e68796` [feat] Review Hub debug session — 9 fixes + lucide-react
- `e091630` [fix] Report generator writes LF not CRLF
- `23a9689` [docs] Normalize daily report line endings

## Bugs Fixed (26)
- 12 from code audit (Lightbox props, download URL, sidebar, AbortController, etc.)
- 5 from test-driven discovery (FK violations, raw null, stale sessions)
- 9 from live iPad debug (drawing persistence, admin leaking, card stretch, etc.)

## Test Suite
- Backend: 10 → 98 tests across 14 files (new)
- Frontend: 115 tests (unchanged)
- Total: 213, all green, zero warnings

## Key Changes
- **lucide-react** installed, LightboxToolbar icons replaced
- **--amber → --accent** renamed in 8 CSS files (86 occurrences)
- **lifespan** replaced deprecated on_event("startup")
- **Socket.IO** direct WebSocket to backend:5101 (bypasses Vite proxy)
- **Drawing** immediate canvas render + auto-save + toast notification
- **Admin** permissions cleared on user switch, restart button in RH nav
- **References** drag & drop upload, project subfolder routing
- **Silent failures** all except:pass → _log(), corrupt JSON → .corrupt backup
- **pip install -e** fixed stale site-packages shadowing local source
- **write_text newline="\n"** prevents CRLF in generated files

## Lessons Learned (saved to memory)
1. Tests must cover failure paths, not just happy paths
2. Never except:pass — always log
3. Always Read file before Edit
4. write_text on Windows: always newline="\n"
5. Verify every doc claim against actual code
6. pip install -e not pip install — cache won, restart always wins
7. Never change backend IP/port

## Known Issues
- Backend must be restarted via AYCB Studio.bat to load new code
- iPad drawing real-time depends on WebSocket upgrade (needs backend restart with CORS fix)
- Review Hub frontend has zero test files (backend routes covered)

## Next Tasks
1. Restart backend via bat (loads all session changes)
2. Verify iPad real-time drawing after restart
3. Trashcan feature (feedback #1: 30-day recycle bin for deleted files)
