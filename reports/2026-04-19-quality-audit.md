# Quality Audit Report: AYCB Studio v2

**Date:** 2026-04-19
**Branch:** dev
**Commits:** 144 (single author)
**Auditor:** Claude (quality-auditor skill)

---

## Executive Summary

**Overall Score: 6.0/10 — Good (local-first single-user tool); Risky for team/production deployment**

AYCB Studio v2 is a strongly-architected local-first node studio with **exemplary auto-discovery patterns** and **innovative features** (cascade execution, perf-log self-review loop) that exceed ComfyUI and Automatic1111 in design elegance. However, it has **two critical security issues**, **zero CI/CD**, and **structural debt** (13 model-registry sites, 31 files >300 LOC) that cap its production-readiness.

### Top 3 Strengths

1. **Auto-discovery node + router architecture** (`nodes/index.ts`, `api.py:63-78`) — new node = one folder, zero other edits
2. **Innovation & design discipline** — cascade Shift+Click, lazy Review Hub SPA, browser perf logger with 3-day review cycle
3. **Input sanitization + error logging rigor** — `_sanitize_filename()` (`shared.py:72`), zero `except: pass` in production

### Top 3 Critical Issues

1. **Hardcoded ADMIN_PIN "1312"** (`media.py:36`, `userStore.ts:5`) — 4-digit, no rate limiting, no hash
2. **Open CORS** (`allow_origins=["*"]` at `api.py:71`) + **path traversal** in `upload.py:22-26` (no `_sanitize_filename` call)
3. **Zero CI/CD** — no GitHub Actions, no pre-commit hooks, manual test discipline only

---

## Detailed Scores

| Dimension | Score | Rating | Priority |
|-----------|-------|--------|----------|
| Code Quality | 5/10 | Below average | **High** |
| Architecture | 6/10 | Good | Medium |
| Documentation | 6/10 | Good | Medium |
| Usability | 7/10 | Very Good | Low |
| Performance | 6/10 | Good | Medium |
| Security | 7.5/10 | Very Good* | **High** (*criticals) |
| Testing | 8/10 | Excellent | Low |
| Maintainability | 5/10 | Below average | **High** |
| Developer Experience | 7/10 | Very Good | Medium |
| Accessibility | 4/10 | Poor | Medium |
| CI/CD | 2/10 | Critical | **High** |
| Innovation | 8/10 | Excellent | — |

**Weighted Overall: 6.0/10**

---

## Dimension Analysis

### 1. Code Quality — 5/10

- **Metrics:** 31 files >300 LOC (max 700 in `FlowCanvas.tsx`), 55 >250, zero `except: pass`, zero TODO/FIXME/HACK across 40k LOC
- **Strengths:** `_log()` buffer discipline (`shared.py:24-28`), retry logic on Gemini 429 (`gemini.py:72-122`), size-limited uploads (50MB images, 500MB video)
- **Weaknesses:** god components (`FlowCanvas` 700, `ConsolePanel` 615, `useGenerateImage` 490 exposing 30+ return values), filename sanitization scattered across 7 inline regex sites in `bridge.py`
- **Fix:** consolidate filename sanitization to one helper; split `FlowCanvas` per CLAUDE.md rule 1

### 2. Architecture — 6/10

- **Strengths:** `import.meta.glob` node discovery (`nodes/index.ts:5-40`), `pkgutil.iter_modules` backend auto-discovery (`api.py:63-78`), Review Hub layering routes→queries→db
- **Critical Weakness:** **Model registry fragmented across 13 sites** — adding a Veo model requires edits to `vertex_video_gen.py`, `useGenerateVideo.ts`, `MODEL_PRICING`, providers, and 9 others. Flagged as C3 in 2026-04-18 audit.
- **Also:** transactional gaps in Review Hub (5 endpoints do disk+DB without rollback), Review Hub `app.py` duplicates router list twice verbatim (`app.py:11-24` + `:119-132`) while parent uses auto-discovery
- **Fix:** create `src/models_registry.py` single source; auto-discover RH routers matching parent pattern

### 3. Documentation — 6/10

- **Strengths:** `CLAUDE.md` (321 lines) is comprehensive; two dedicated skills (`aycb-workflow`, `aycb-node-creator`) prescribe patterns
- **Weaknesses:** zero per-node README; no OpenAPI/Swagger; no `.env.example`; CLAUDE.md says "21 nodes" while code has 28 (drift); known bug (`db.py` hardcode) acknowledged but unfixed
- **Fix:** `.env.example` + `SETUP.md` + enable FastAPI auto-generated `/api/docs` (10 min)

### 4. Usability — 7/10

- Design tokens enforced (`#F52776` accent on `#0a0a0b` = 16:1 contrast, WCAG AAA); Lucide icons + no emoji per CLAUDE.md; `ErrorBoundary` with Copy Error button; Toast auto-dismiss
- Missing: loading spinners during generation, slot-type hover hints, media search/filter in Review Hub

### 5. Performance — 6/10

- **Strengths:** `perfLogger.ts` (dedup, batch-cap, 10s flush, self-exclusion), 300px JPEG thumbnail cache, lazy Review Hub SPA (`React.lazy` at `App.tsx:8`)
- **Weaknesses:** `scanner.py` polls every 5s with double `rglob` across media + assets; `useNodes()` in `AlignToolbar` violates CLAUDE.md feedback memory (should use selectors); `Viewport.tsx` RAF always-on with no `needsRender` gate
- **Fix:** complete fingerprint memoization in scanner; ESLint rule blocking raw `useNodes()`

### 6. Security — 7.5/10 (but 2 criticals)

**Criticals:**

- **ADMIN_PIN = "1312"** hardcoded in 2 sites, 4 digits, brute-forceable in 10k tries, no rate limiting on delete endpoints (`media.py:135-177`)
- **CORS `allow_origins=["*"]`** (`api.py:71`) exposes all endpoints cross-origin
- **Path traversal:** `routes/upload.py:22-26` uses `settings.media_dir / file.filename` without `_sanitize_filename()`

**Strengths:** Pydantic validation everywhere, parameterized `aiosqlite` queries (no SQL injection), `dangerouslySetInnerHTML` uses are preceded by `escapeHtml()` (`jsonColorize.ts:8`)

**Fix:** hash PIN + env-based + rate limit (30 min); restrict CORS to `http://localhost:5100`; sanitize upload filenames (2-line fix)

### 7. Testing — 8/10

- **Evidence:** 219 backend tests pass (14.4s), 294 frontend tests pass (8.3s), 41 vitest files, 26 pytest files
- **Gap:** `frontend/src/review/` has **zero test files** across 33 source files (Gallery, Lightbox, Drawing, Comments all untested)
- **Quality:** happy-path heavy, limited failure-path coverage (contradicts feedback memory `feedback_test_failure_paths.md`)
- **Fix:** ~8 spec files for Review Hub core components (4h)

### 8. Maintainability — 5/10

- Corrupt data handling exemplary (`prompt.py:23-31` backs up to `.corrupt`, resets, logs — matches CLAUDE.md rule 12)
- Recent refactor velocity good (0b73e45 extracted keyboard helpers; 132226e extracted `canvasExport` service)
- Blocked by god components + 13 registry sites + undocumented provider constraints (`vertex_video_gen.py` snaps duration silently to (4,6,8))

### 9. Developer Experience — 7/10

- Hot reload out of box (uvicorn `--reload` + Vite); `AYCB Studio.bat` single-command launch; unified `api.ts` request layer; TypeScript strict
- Missing: `.vscode/` configs, launch profiles, vite proxy undocumented, silent `/* silent */` catches in `api.ts` lack pattern docs

### 10. Accessibility — 4/10

- Keyboard shortcuts comprehensive (24 bindings across 9 files — ADHD-friendly)
- ARIA coverage <10% of components; Review Hub Gallery and Drawing have zero ARIA; `ReviewTab` uses color-only latency feedback
- Design tokens give AAA contrast on body text, but interactive UI lacks labels

### 11. CI/CD — 2/10 (Critical)

- **No `.github/workflows/`, no pre-commit, no versioning** (both `pyproject.toml` and `package.json` show `0.0.0`/`1.0.0` hardcoded)
- Review Hub duplicates router list manually while parent auto-discovers — inconsistency
- **This is the single largest gap blocking production/team readiness**

### 12. Innovation — 8/10

| Feature | AYCB | ComfyUI | Auto1111 | Unity |
|---|---|---|---|---|
| Auto-discovery nodes | **Yes** | No | No | No |
| Cascade execution | **Yes** | No | No | No |
| Perf telemetry + self-review loop | **Yes** | No | No | No |
| Unified backend + UI + review | **Yes** | No | No | N/A |

Limitations: no plugin marketplace, LAN-only collab, no cloud multi-user.

---

## Prioritized Recommendations

### Immediate (this week, ~3h total)

1. **Sanitize upload filenames** — add `_sanitize_filename()` calls at `upload.py:24`, `:58` (2 lines)
2. **Restrict CORS** — change `api.py:71` `allow_origins` to `["http://localhost:5100"]` (1 line)
3. **Harden ADMIN_PIN** — move to env var, hash with bcrypt, add in-memory rate-limit counter (30 min)

### Short-term (next 2 weeks)

4. **Centralize model registry** — `src/models_registry.py`, migrate 13 sites (~4h; eliminates whole class of drift bugs)
5. **Add GitHub Actions** — pytest + vitest + tsc + eslint on push (~3h; unblocks team use)
6. **Review Hub test suite** — Gallery/Lightbox/Drawing/Comments specs (~6h; closes frontend testing gap)

### Medium-term (next month)

7. **Fix `src/review_hub/db.py` hardcoded `_DB_PATH`** — migrate to `settings.db_path` (documented exception in CLAUDE.md:249)
8. **Auto-discover Review Hub routers** — remove duplicate router list in `app.py` (10 lines)
9. **Wrap filesystem+DB ops in transactional boundary** — `@contextmanager atomic_file_db()` for 5 flagged endpoints
10. **Break up god components** — `FlowCanvas`, `ConsolePanel`, `useGenerateImage` per CLAUDE.md rule 1

### Long-term

11. OpenAPI auto-docs at `/api/docs` + `.env.example` + node README template
12. ARIA sweep across Review Hub; `@testing-library/jest-dom` a11y assertions
13. Scanner fingerprint memoization (80% idle CPU reduction per m7 finding)

---

## Comparative Benchmarks

| Metric | AYCB v2 | Industry Target | Status |
|---|---|---|---|
| Max file size | 700 LOC | <300 (CLAUDE.md rule) | Fail (31 violations) |
| Test count | 513 | — | Pass |
| Test coverage ratio (frontend) | 94% files | 80%+ | Pass |
| Test coverage (Review Hub FE) | 0% | 60%+ | Fail |
| Bare `except:` blocks | 0 | 0 | Pass |
| CI/CD pipelines | 0 | 1+ | Fail |
| Hardcoded secrets | 1 (ADMIN_PIN) | 0 | Fail |
| CORS restriction | `*` | specific origin | Fail |
| SQL injection risk | None | None | Pass |
| XSS mitigation | `escapeHtml` present | required | Pass |

---

## Conclusion

**Verdict: Good foundation with clear path to Excellent.**

AYCB Studio v2 shows unusual architectural maturity for a 6-week-old single-author project — the auto-discovery patterns, Review Hub subsystem separation, and performance self-review loop are genuinely innovative. The 6.0/10 overall reflects **two categories pulling the score down sharply**: CI/CD (2/10) and the 2 security criticals.

**~6 hours of focused work** (auth hardening + CORS + upload sanitization + GitHub Actions) would lift the overall score to ~7.0. **A further sprint** on model registry consolidation + Review Hub tests + god-component splits would push it to **7.5-8.0 range — production-ready for small-team deployment.**

The single biggest risk right now is not code quality but **lack of automated safety net**: 144 commits with zero CI means one regression from making it to `main` unnoticed.
