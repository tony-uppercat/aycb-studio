import { useState, useEffect, useCallback, useRef } from 'react';
import styles from './ReviewTab.module.css';

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface ReviewItem {
  id: string;
  text: string;
  category: string;   // frontend, backend, ci, cloud
  priority: string;    // P0, P1, P2
  status: string;      // pending, pass, fail
  note: string;
  session: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  frontend: 'FE',
  backend: 'BE',
  ci: 'CI',
  cloud: 'CLD',
};

const CATEGORY_TOOLTIPS: Record<string, string> = {
  frontend: 'Frontend — test in browser',
  backend: 'Backend — API endpoint test',
  ci: 'CI — GitHub Actions (lint, tsc, tests)',
  cloud: 'Cloud — Vercel deployment (no backend)',
};

const CATEGORY_STYLES: Record<string, string> = {
  frontend: styles.catFrontend,
  backend: styles.catBackend,
  ci: styles.catCi,
  cloud: styles.catCloud,
};

const BORDER_STYLES: Record<string, string> = {
  P0: styles.borderP0,
  P1: styles.borderP1,
  P2: styles.borderP2,
};

const LS_KEY = 'aycb_review_items';

/* ── localStorage fallback ─────────────────────────────────────────────────── */

function loadLocal(): ReviewItem[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

function saveLocal(items: ReviewItem[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(items));
  } catch { /* quota */ }
}

/* ── API helpers ───────────────────────────────────────────────────────────── */

function isBackendAvailable(): boolean {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

async function fetchItems(signal?: AbortSignal): Promise<ReviewItem[]> {
  if (!isBackendAvailable()) return loadLocal();
  try {
    const r = await fetch('/api/review/items', { signal });
    if (!r.ok) return loadLocal();
    const data = await r.json();
    const items: ReviewItem[] = data.items ?? [];
    saveLocal(items);
    return items;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    return loadLocal();
  }
}

async function patchItem(id: string, patch: Record<string, string>): Promise<boolean> {
  if (!isBackendAvailable()) return false;
  try {
    const r = await fetch(`/api/review/items/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    return r.ok;
  } catch {
    return false;
  }
}

async function postClear(): Promise<boolean> {
  if (!isBackendAvailable()) return false;
  try {
    const r = await fetch('/api/review/clear', { method: 'POST' });
    return r.ok;
  } catch {
    return false;
  }
}

async function postCarryOver(): Promise<boolean> {
  if (!isBackendAvailable()) return false;
  try {
    const r = await fetch('/api/review/carry-over', { method: 'POST' });
    return r.ok;
  } catch {
    return false;
  }
}

/* ── Component ─────────────────────────────────────────────────────────────── */

export function ReviewTab() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [failNoteId, setFailNoteId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const noteInputRef = useRef<HTMLInputElement>(null);

  /* Fetch on mount + auto-refresh every 5s */
  useEffect(() => {
    const controller = new AbortController()
    const load = () => {
      fetchItems(controller.signal)
        .then(data => setItems(data))
        .catch(err => { if (err.name !== 'AbortError') console.warn('[ReviewTab] fetch failed:', err) })
    }
    load()
    const id = setInterval(load, 5000)
    return () => { controller.abort(); clearInterval(id) }
  }, []);

  /* Focus note input when fail mode opens */
  useEffect(() => {
    if (failNoteId) noteInputRef.current?.focus();
  }, [failNoteId]);

  /* ── Handlers ──────────────────────────────────────────────────────────── */

  const handlePass = useCallback(async (id: string) => {
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'pass' } : i));
    const ok = await patchItem(id, { status: 'pass' });
    if (!ok) {
      // fallback: persist to localStorage
      setItems(prev => {
        saveLocal(prev);
        return prev;
      });
    }
  }, []);

  const handleFailStart = useCallback((id: string) => {
    setFailNoteId(id);
    setNoteText('');
  }, []);

  const handleFailSubmit = useCallback(async (id: string) => {
    const note = noteText.trim();
    setItems(prev => prev.map(i => i.id === id ? { ...i, status: 'fail', note } : i));
    setFailNoteId(null);
    setNoteText('');
    const ok = await patchItem(id, { status: 'fail', note });
    if (!ok) {
      setItems(prev => {
        saveLocal(prev);
        return prev;
      });
    }
  }, [noteText]);

  const handleClearPassed = useCallback(async () => {
    const ok = await postClear();
    if (ok) {
      setItems(prev => {
        const updated = prev.filter(i => i.status !== 'pass');
        saveLocal(updated);
        return updated;
      });
    } else {
      // fallback: clear locally
      setItems(prev => {
        const updated = prev.filter(i => i.status !== 'pass');
        saveLocal(updated);
        return updated;
      });
    }
  }, []);

  const handleCarryOver = useCallback(async () => {
    const ok = await postCarryOver();
    if (ok) {
      fetchItems().then(data => setItems(data))
    } else {
      const today = new Date().toISOString().slice(0, 10);
      setItems(prev => {
        const updated = prev.map(i =>
          i.status === 'pending' || i.status === 'fail'
            ? { ...i, session: today }
            : i
        );
        saveLocal(updated);
        return updated;
      });
    }
  }, []);

  /* ── Derived ───────────────────────────────────────────────────────────── */

  const passedCount = items.filter(i => i.status === 'pass').length;
  const totalCount = items.length;
  const latestSession = items.length > 0
    ? items.reduce((latest, i) => (i.session > latest ? i.session : latest), items[0].session)
    : new Date().toISOString().slice(0, 10);

  const grouped: Record<string, ReviewItem[]> = { P0: [], P1: [], P2: [] };
  for (const item of items) {
    const key = item.priority in grouped ? item.priority : 'P1';
    grouped[key].push(item);
  }

  /* ── Render ────────────────────────────────────────────────────────────── */

  return (
    <div className={styles.reviewWrap}>
      {/* Header */}
      <div className={styles.reviewHeader}>
        <span className={styles.sessionLabel}>Session: {latestSession}</span>
        {totalCount > 0 && (
          <span className={styles.progressLabel}>
            {passedCount}/{totalCount} passed
          </span>
        )}
      </div>

      {/* Item list */}
      <div className={styles.itemList}>
        {totalCount === 0 && (
          <p className={styles.emptyState}>No review items yet...</p>
        )}

        {(['P0', 'P1', 'P2'] as const).map(priority => {
          const group = grouped[priority];
          if (group.length === 0) return null;
          return (
            <div key={priority} className={styles.priorityGroup}>
              <div className={styles.priorityLabel}>{priority}</div>
              {group.map(item => (
                <div key={item.id}>
                  <div className={`${styles.itemRow} ${BORDER_STYLES[priority] ?? styles.borderP1}`}>
                    {/* Status icon */}
                    <span className={`${styles.statusIcon} ${
                      item.status === 'pass' ? styles.statusPass
                        : item.status === 'fail' ? styles.statusFail
                        : styles.statusPending
                    }`}>
                      {item.status === 'pass' ? '\u2713' : item.status === 'fail' ? '\u2717' : '\u25CB'}
                    </span>

                    {/* Text */}
                    <span className={item.status === 'pass' ? styles.itemTextDone : styles.itemText}>
                      {item.text}
                    </span>

                    {/* Category badge */}
                    <span
                      className={`${styles.catBadge} ${CATEGORY_STYLES[item.category] ?? styles.catFrontend}`}
                      title={CATEGORY_TOOLTIPS[item.category] ?? item.category}
                    >
                      {CATEGORY_LABELS[item.category] ?? item.category.toUpperCase()}
                    </span>

                    {/* Actions */}
                    {item.status === 'pending' && (
                      <div className={styles.actions}>
                        <button className={styles.passBtn} onClick={() => handlePass(item.id)}>
                          {'\u2713'} Pass
                        </button>
                        <button className={styles.failBtn} onClick={() => handleFailStart(item.id)}>
                          {'\u2717'} Fail
                        </button>
                      </div>
                    )}

                    {item.status === 'pass' && (
                      <span className={styles.passLabel}>{'\u2713'} Passed</span>
                    )}

                    {item.status === 'fail' && failNoteId !== item.id && (
                      <span className={styles.failLabel}>{'\u2717'} Failed</span>
                    )}
                  </div>

                  {/* Note input for fail */}
                  {failNoteId === item.id && (
                    <div className={styles.noteRow}>
                      <input
                        ref={noteInputRef}
                        className={`${styles.noteInput} nokey`}
                        value={noteText}
                        onChange={e => setNoteText(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleFailSubmit(item.id);
                          }
                          if (e.key === 'Escape') {
                            setFailNoteId(null);
                          }
                        }}
                        placeholder="What failed? (Enter to submit)"
                      />
                      <button className={styles.noteSaveBtn} onClick={() => handleFailSubmit(item.id)}>
                        Save
                      </button>
                    </div>
                  )}

                  {/* Existing note display */}
                  {item.status === 'fail' && item.note && failNoteId !== item.id && (
                    <div className={styles.noteDisplay}>Note: "{item.note}"</div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {/* Footer */}
      {totalCount > 0 && (
        <div className={styles.reviewFooter}>
          <button className={styles.footerBtn} onClick={handleClearPassed}>
            Clear Passed
          </button>
          <button className={styles.footerBtn} onClick={handleCarryOver}>
            Carry Over
          </button>
        </div>
      )}
    </div>
  );
}
