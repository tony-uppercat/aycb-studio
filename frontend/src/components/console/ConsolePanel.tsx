import { useState, useEffect, useRef, useCallback } from 'react';
import { useReactFlow, useStore } from '@xyflow/react';
import { api } from '../../api';
import { listMedia } from '../../mediaStore';
import type { MediaEntry } from '../../mediaStore';
import { useCanvasStore } from '../../stores/canvasStore';
import { useAsyncJobStore } from '../../stores/asyncJobStore';
import { flushAll } from '../../services/asyncBundler';
import { sendSessionReport } from '../../hooks/useAutosave';
import { downloadJSON } from '../../utils/downloadManager';
import { STORAGE_KEYS } from '../../storage/keys';
import { useProjectCosts } from '../../hooks/useProjectCosts';
import { ReviewTab } from './ReviewTab';
import { CostsTab } from './CostsTab';
import styles from './ConsolePanel.module.css';

type Tab = 'server' | 'network' | 'media' | 'errors' | 'costs';
type FbTab = 'feedback' | 'review';

const FEEDBACK_KEY = STORAGE_KEYS.FEEDBACK;
type FeedbackCategory = 'bug' | 'ux' | 'idea' | 'prompt';

interface FeedbackEntry {
  id: string;
  text: string;
  category: FeedbackCategory;
  timestamp: string;
  nodeId?: string;
  nodeType?: string;
  nodeLabel?: string;
  nodeData?: Record<string, unknown>;
  urgent?: boolean;
  resolved?: boolean;
}

function loadFeedback(): FeedbackEntry[] {
  try { return JSON.parse(localStorage.getItem(FEEDBACK_KEY) || '[]') }
  catch { return [] }
}
function saveFeedback(entries: FeedbackEntry[]) {
  localStorage.setItem(FEEDBACK_KEY, JSON.stringify(entries));
}

interface Props {
  open: boolean;
  onToggle: () => void;
}

const DEFAULT_HEIGHT = 200
const MIN_HEIGHT = 80
const MAX_HEIGHT = 600

function loadConsoleHeight(): number {
  try { const v = localStorage.getItem(STORAGE_KEYS.CONSOLE_HEIGHT); return v ? Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Number(v))) : DEFAULT_HEIGHT }
  catch { return DEFAULT_HEIGHT }
}

export function ConsolePanel({ open, onToggle }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('server');
  const [consoleHeight, setConsoleHeight] = useState(loadConsoleHeight);
  const consoleHeightRef = useRef(consoleHeight);
  // Direct container refs — scrolling these avoids scrollIntoView propagating up to overflow:hidden ancestors
  const consoleBodyRef = useRef<HTMLDivElement>(null)
  const fbListRef = useRef<HTMLDivElement>(null)

  // ── Server tab ──────────────────────────────────────────────────────────────
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    const id = setInterval(async () => {
      try {
        const r = await api.getLogs();
        setLogs(r.logs);
      } catch { /* server may be down */ }
    }, 2000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (activeTab !== 'server') return
    const el = consoleBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Network tab ──────────────────────────────────────────────────────────────
  const networkLog = useCanvasStore((s) => s.networkLog);
  const clearNetworkLog = useCanvasStore((s) => s.clearNetworkLog);

  useEffect(() => {
    if (activeTab !== 'network') return
    const el = consoleBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [networkLog]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Media tab ──────────────────────────────────────────────────────────────
  const [mediaEntries, setMediaEntries] = useState<MediaEntry[]>([]);
  const [mediaLoading, setMediaLoading] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [copiedLine, setCopiedLine] = useState<string | null>(null);

  const copyText = useCallback((text: string, key?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedLine(key ?? text);
      setTimeout(() => setCopiedLine(null), 1200);
    }).catch(e => console.warn('[clipboard] copyText failed:', e.message ?? e));
  }, []);

  const refreshMedia = useCallback(async () => {
    setMediaLoading(true);
    try {
      const entries = await listMedia();
      setMediaEntries(entries);
    } catch { /* idb unavailable */ }
    finally { setMediaLoading(false); }
  }, []);

  useEffect(() => {
    if (open && activeTab === 'media') refreshMedia();
  }, [open, activeTab, refreshMedia]);

  const handleCopyId = useCallback((id: string) => {
    navigator.clipboard.writeText(id).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    }).catch(e => console.warn('[clipboard] handleCopyId failed:', e.message ?? e));
  }, []);

  // ── Errors tab ──────────────────────────────────────────────────────────────
  const storeErrors = useCanvasStore((s) => s.errors);
  const clearStoreErrors = useCanvasStore((s) => s.clearErrors);

  useEffect(() => {
    if (activeTab !== 'errors') return
    const el = consoleBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [storeErrors]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Costs tab (per-project) ───────────────────────────────────────────────
  const { projectCosts, totalCost: projectTotalCost, count: costCount, activeProjectId, clearProjectCosts } = useProjectCosts();

  useEffect(() => {
    if (activeTab !== 'costs') return
    const el = consoleBodyRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [projectCosts]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Feedback tab ──────────────────────────────────────────────────────────────
  // Subscribe to just the selected node's id (primitive) so ConsolePanel doesn't
  // re-render on every drag frame when the selected node object ref changes.
  // The full node is fetched imperatively at submit time.
  const selectedNodeId = useStore(s => s.nodes.find(n => n.selected)?.id ?? null)
  const { getNodes } = useReactFlow()
  const defaultFbWidth = () => { try { return Number(localStorage.getItem(STORAGE_KEYS.FEEDBACK_WIDTH)) || 320 } catch { return 320 } }
  const [fbWidth, setFbWidth] = useState(defaultFbWidth)
  const fbWidthRef = useRef(fbWidth)
  const [feedbackEntries, setFeedbackEntries] = useState<FeedbackEntry[]>(loadFeedback);
  const [fbText, setFbText] = useState('');
  const [fbCategory, setFbCategory] = useState<FeedbackCategory>('bug');
  const [fixedOpen, setFixedOpen] = useState(false);
  const [fbTab, setFbTab] = useState<FbTab>('feedback');

  const resolvedEntries = feedbackEntries.filter(e => e.resolved);
  const unresolvedEntries = feedbackEntries.filter(e => !e.resolved);

  const markFixed = useCallback((id: string) => {
    const entry = feedbackEntries.find(e => e.id === id);
    const updated = feedbackEntries.map(e => e.id === id ? { ...e, resolved: true } : e);
    setFeedbackEntries(updated);
    saveFeedback(updated);
    // Log green success message to server console
    if (entry) {
      const preview = entry.text.length > 60 ? entry.text.slice(0, 60) + '...' : entry.text;
      const ts = new Date().toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      // Immediately show green message in console (no wait for 2s poll)
      setLogs(prev => [...prev, `[${ts}] [SUCCESS] \u2713 Feedback fixed: ${preview}`]);
      setActiveTab('server');
      // Also persist to backend log
      const fd = new FormData();
      fd.append('text', `\u2713 Feedback fixed: ${preview}`);
      fd.append('type', 'success');
      fetch('/api/console/notify', { method: 'POST', body: fd }).catch(e => console.warn('[bridge]', e.message ?? e));
    }
  }, [feedbackEntries]);

  useEffect(() => {
    const el = fbListRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [feedbackEntries]);

  const submitFeedback = useCallback(() => {
    if (!fbText.trim()) return;
    const isUrgent = fbText.trimStart().startsWith('!!!')
    const cleanText = isUrgent ? fbText.trimStart().slice(3).trim() : fbText.trim()
    if (!cleanText) return;
    const selected = selectedNodeId ? getNodes().find(n => n.id === selectedNodeId) ?? null : null;
    const entry: FeedbackEntry = {
      id: `fb_${Date.now()}`,
      text: cleanText,
      category: fbCategory,
      urgent: isUrgent || undefined,
      timestamp: new Date().toISOString(),
      nodeId: selected?.id ?? 'overall',
      nodeType: selected?.type ?? 'overall',
      nodeLabel: selected
        ? ((selected.data as Record<string, unknown>)?._customName as string || selected.type || '')
        : 'overall',
      ...(selected ? {
        nodeData: {
          selectedModel: (selected.data as Record<string, unknown>)?.selectedModel,
          prompt: typeof (selected.data as Record<string, unknown>)?.prompt === 'string'
            ? ((selected.data as Record<string, unknown>).prompt as string).slice(0, 200)
            : undefined,
        },
      } : {}),
    };
    const updated = [...feedbackEntries, entry];
    setFeedbackEntries(updated);
    saveFeedback(updated);
    setFbText('');
    // Save to disk via backend (all feedback, not just urgent)
    fetch('/api/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entry),
    }).catch(() => { /* backend may be down */ })
    if (isUrgent) {
      fetch('/api/feedback/urgent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      }).catch(() => { /* backend may be down */ })
    }
  }, [fbText, fbCategory, selectedNodeId, getNodes, feedbackEntries]);

  const [reportStatus, setReportStatus] = useState<string>('');

  const handleReport = useCallback(() => {
    const ok = sendSessionReport();
    setReportStatus(ok ? 'Sent!' : 'Failed');
    setTimeout(() => setReportStatus(''), 2000);
  }, []);

  const exportFeedback = useCallback(() => {
    const report = {
      date: new Date().toISOString().slice(0, 10),
      feedback: feedbackEntries,
      costs: {
        projectId: activeProjectId,
        entries: projectCosts,
        total: projectTotalCost,
        count: projectCosts.length,
      },
    };
    downloadJSON(report, `report_${report.date}.json`);
  }, [feedbackEntries, projectCosts, projectTotalCost, activeProjectId]);

  // ── Clear active tab ─────────────────────────────────────────────────────────
  const handleClear = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeTab === 'server') {
      setLogs([]);
      api.clearLogs().catch(e => console.warn('[bridge] clearLogs failed:', e.message ?? e));
    } else if (activeTab === 'network') {
      clearNetworkLog();
    } else if (activeTab === 'media') {
      setMediaEntries([]);
    } else if (activeTab === 'errors') {
      clearStoreErrors();
    } else if (activeTab === 'costs') {
      clearProjectCosts();
    }
  }, [activeTab, clearNetworkLog, clearStoreErrors, clearProjectCosts]);

  const errCount = storeErrors.length;
  const asyncCount = useAsyncJobStore(s => s.jobs.filter(j => j.status === 'submitted' || j.status === 'polling').length);
  const pendingCount = useAsyncJobStore(s => s.pendingCount);

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function statusColor(status: number): string {
    if (status >= 200 && status < 300) return styles.netGreen;
    if (status >= 400 && status < 500) return styles.netYellow;
    if (status >= 500) return styles.netRed;
    return '';
  }

  function shortTime(iso: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  return (
    <div className={styles.consoleWrap} style={{ height: open ? consoleHeight : 28 }}>
      {open && (
        <div
          className={styles.resizeHandle}
          onMouseDown={(e) => {
            e.preventDefault()
            const startY = e.clientY
            const startH = consoleHeightRef.current
            const onMove = (ev: MouseEvent) => {
              const delta = startY - ev.clientY
              const next = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, startH + delta))
              consoleHeightRef.current = next
              setConsoleHeight(next)
            }
            const onUp = () => {
              document.removeEventListener('mousemove', onMove)
              document.removeEventListener('mouseup', onUp)
              try { localStorage.setItem(STORAGE_KEYS.CONSOLE_HEIGHT, String(consoleHeightRef.current)) } catch { /* */ }
            }
            document.addEventListener('mousemove', onMove)
            document.addEventListener('mouseup', onUp)
          }}
        />
      )}
      <div className={styles.consoleHeader} onClick={onToggle}>
        <span className={styles.consoleTitle}>
          <span className={styles.consoleDot} />
        </span>
        <div className={styles.tabBar} onClick={(e) => e.stopPropagation()}>
          {(['server', 'network', 'media', 'errors', 'costs'] as Tab[]).map((tab) => (
            <button
              key={tab}
              className={`${styles.tabBtn} ${activeTab === tab ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
              {tab === 'errors' && errCount > 0 && (
                <span className={styles.badge}>{errCount}</span>
              )}
              {tab === 'costs' && costCount > 0 && (
                <span className={styles.costBadgeTab} data-s>${projectTotalCost < 0.01 ? projectTotalCost.toFixed(4) : projectTotalCost.toFixed(3)}</span>
              )}
            </button>
          ))}
        </div>
        {resolvedEntries.length > 0 && (
          <span className={styles.fbFixedBadge} onClick={(e) => { e.stopPropagation(); setFixedOpen(o => !o) }} title="Toggle fixed feedback">
            {fixedOpen ? '▼' : '▶'} {resolvedEntries.length} fixed
          </span>
        )}
        {(pendingCount > 0 || asyncCount > 0) && (
          <span className={styles.fbFixedBadge} onClick={(e) => e.stopPropagation()} title="Async batch queue">
            {pendingCount > 0 && <>{pendingCount} in coda</>}
            {pendingCount > 0 && asyncCount > 0 && ' · '}
            {asyncCount > 0 && <>{asyncCount} batch in corso</>}
            {pendingCount > 0 && (
              <button className={styles.fbExportBtn} onClick={(e) => { e.stopPropagation(); void flushAll() }} title="Lancia la coda batch ora">Lancia coda ora</button>
            )}
          </span>
        )}
        {errCount > 0 && (
          <span className={styles.errorBadgeHeader}>{errCount}</span>
        )}
        <button
          className={styles.consoleToggle}
          onClick={handleClear}
          title="Clear active tab"
        >✕</button>
        <button className={styles.consoleToggle}>{open ? '▼' : '▲'}</button>
      </div>

      {open && (
        <>

          <div className={styles.splitBody}>
          <div className={styles.consoleBody} ref={consoleBodyRef}>
            {/* Server tab */}
            {activeTab === 'server' && (
              <>
                {logs.length === 0 && <p className={styles.consoleEmpty}>No logs yet...</p>}
                {logs.map((line, i) => {
                  const isSuccess = line.includes('[SUCCESS]');
                  const lineClass = isSuccess ? styles.consoleLineSuccess : styles.consoleLine;
                  return (
                    <p key={i}
                      className={`${lineClass} ${styles.clickable} ${copiedLine === `s-${i}` ? styles.copied : ''}`}
                      onClick={() => copyText(line, `s-${i}`)}
                      title="Click to copy"
                    >{copiedLine === `s-${i}` ? '✓ copied' : line}</p>
                  );
                })}
              </>
            )}

            {/* Network tab */}
            {activeTab === 'network' && (
              <>
                {networkLog.length === 0 && <p className={styles.consoleEmpty}>No requests yet...</p>}
                {networkLog.map((entry, i) => {
                  const key = `n-${i}`;
                  const text = `${entry.method} ${entry.url} ${entry.status} ${entry.duration}ms`;
                  return (
                    <div key={i}
                      className={`${styles.netRow} ${statusColor(entry.status)} ${styles.clickable} ${copiedLine === key ? styles.copied : ''}`}
                      onClick={() => copyText(text, key)}
                      title="Click to copy"
                    >
                      {copiedLine === key
                        ? <span className={styles.copiedLabel}>✓ copied</span>
                        : <>
                            <span className={styles.netTime}>{shortTime(entry.timestamp)}</span>
                            <span className={styles.netMethod}>{entry.method}</span>
                            <span className={styles.netUrl}>{entry.url}</span>
                            <span className={styles.netStatus}>{entry.status}</span>
                            <span className={styles.netDuration}>{entry.duration}ms</span>
                          </>
                      }
                    </div>
                  );
                })}
              </>
            )}

            {/* Media tab */}
            {activeTab === 'media' && (
              <>
                <div className={styles.mediaToolbar}>
                  <button
                    className={styles.refreshBtn}
                    onClick={refreshMedia}
                    disabled={mediaLoading}
                  >
                    {mediaLoading ? 'Loading...' : 'Refresh'}
                  </button>
                  <span className={styles.mediaCount}>{mediaEntries.length} item{mediaEntries.length !== 1 ? 's' : ''}</span>
                </div>
                {mediaEntries.length === 0 && !mediaLoading && (
                  <p className={styles.consoleEmpty}>No media in IndexedDB...</p>
                )}
                {mediaEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className={styles.mediaRow}
                    onClick={() => handleCopyId(entry.id)}
                    title="Click to copy mediaId"
                  >
                    <span className={styles.mediaType}>{entry.type.split('/')[0]}</span>
                    <span className={styles.mediaName}>{entry.name}</span>
                    <span className={styles.mediaSize}>{formatSize(entry.size)}</span>
                    <span className={styles.mediaId}>
                      {copiedId === entry.id ? 'copied!' : entry.id.slice(0, 20) + '…'}
                    </span>
                  </div>
                ))}
              </>
            )}

            {/* Errors tab */}
            {activeTab === 'errors' && (
              <>
                {storeErrors.length === 0 && <p className={styles.consoleEmpty}>No errors recorded...</p>}
                {storeErrors.map((entry, i) => {
                  const key = `e-${i}`;
                  const text = `[${entry.nodeId}] ${entry.message}`;
                  return (
                    <div key={i}
                      className={`${styles.errorRow} ${styles.clickable} ${copiedLine === key ? styles.copied : ''}`}
                      onClick={() => copyText(text, key)}
                      title="Click to copy"
                    >
                      {copiedLine === key
                        ? <span className={styles.copiedLabel}>✓ copied</span>
                        : <>
                            <span className={styles.errTime}>{shortTime(entry.timestamp)}</span>
                            <span className={styles.errNode}>[{entry.nodeId}]</span>
                            <span className={styles.errMsg}>{entry.message}</span>
                          </>
                      }
                    </div>
                  );
                })}
              </>
            )}

            {/* Costs tab */}
            {activeTab === 'costs' && <CostsTab />}


          </div>

          {/* Drag divider */}
          <div
            className={styles.splitDivider}
            onMouseDown={(e) => {
              e.preventDefault()
              const startX = e.clientX
              const startW = fbWidthRef.current
              const onMove = (ev: MouseEvent) => {
                const delta = startX - ev.clientX
                const next = Math.max(180, Math.min(800, startW + delta))
                fbWidthRef.current = next
                setFbWidth(next)
              }
              const onUp = () => {
                document.removeEventListener('mousemove', onMove)
                document.removeEventListener('mouseup', onUp)
                try { localStorage.setItem(STORAGE_KEYS.FEEDBACK_WIDTH, String(fbWidthRef.current)) } catch { /* */ }
              }
              document.addEventListener('mousemove', onMove)
              document.addEventListener('mouseup', onUp)
            }}
          />

          {/* Feedback/Review side panel — always visible */}
          <div className={styles.fbPanel} style={{ width: fbWidth }}>
            <div className={styles.fbHeader}>
              <button className={`${styles.fbTabBtn} ${fbTab === 'feedback' ? styles.fbTabActive : ''}`} onClick={() => setFbTab('feedback')}>
                Feedback{unresolvedEntries.length > 0 ? ` (${unresolvedEntries.length})` : ''}
              </button>
              <button className={`${styles.fbTabBtn} ${fbTab === 'review' ? styles.fbTabActive : ''}`} onClick={() => setFbTab('review')}>
                Review
              </button>
              <div style={{ flex: 1 }} />
              {fbTab === 'feedback' && feedbackEntries.length > 0 && (
                <button className={styles.fbExportBtn} onClick={exportFeedback} title="Export JSON">Export</button>
              )}
              <button className={styles.fbExportBtn} onClick={handleReport} title="Send session report to backend">
                {reportStatus || 'Report'}
              </button>
            </div>

            {fbTab === 'feedback' && (
              <>
                <div className={styles.fbList} ref={fbListRef}>
                  {feedbackEntries.length === 0 && <p className={styles.consoleEmpty}>No feedback yet...</p>}
                  {fixedOpen && resolvedEntries.map((entry) => (
                    <div key={entry.id} className={`${styles.fbRow} ${styles.fbResolved}`}>
                      <span className={styles.fbTime}>{shortTime(entry.timestamp)}</span>
                      <span className={`${styles.fbTag} ${styles[`fbTag_${entry.category}`]}`}>{entry.category}</span>
                      <span className={`${styles.fbText} ${styles.fbResolvedText}`}>{entry.text}</span>
                      <span className={`${styles.fbNode} ${entry.nodeType === 'overall' ? styles.fbNodeOverall : ''}`}
                        title={entry.nodeType === 'overall' ? 'General feedback' : `${entry.nodeId} — ${entry.nodeLabel}`}>
                        [{entry.nodeType === 'overall' ? 'overall' : entry.nodeType}]
                      </span>
                    </div>
                  ))}
                  {unresolvedEntries.map((entry) => (
                    <div key={entry.id} className={styles.fbRow}>
                      <span className={styles.fbTime}>{shortTime(entry.timestamp)}</span>
                      <span className={`${styles.fbTag} ${styles[`fbTag_${entry.category}`]}`}>{entry.category}</span>
                      <span className={styles.fbText}>{entry.text}</span>
                      <span className={`${styles.fbNode} ${entry.nodeType === 'overall' ? styles.fbNodeOverall : ''}`}
                        title={entry.nodeType === 'overall' ? 'General feedback' : `${entry.nodeId} — ${entry.nodeLabel}`}>
                        [{entry.nodeType === 'overall' ? 'overall' : entry.nodeType}]
                      </span>
                      {entry.urgent && <span className={styles.fbUrgentBadge}>URGENT</span>}
                      <button className={styles.fbCheckBtn} onClick={() => markFixed(entry.id)} title="Mark fixed">{'\u2713'}</button>
                    </div>
                  ))}
                </div>
                <div className={styles.fbForm} onClick={e => e.stopPropagation()}>
                  <div className={styles.fbCategories}>
                    {(['bug', 'ux', 'idea', 'prompt'] as FeedbackCategory[]).map(cat => (
                      <button
                        key={cat}
                        className={`${styles.fbCatBtn} ${fbCategory === cat ? styles.fbCatActive : ''} ${styles[`fbTag_${cat}`]}`}
                        onClick={() => setFbCategory(cat)}
                      >{cat}</button>
                    ))}
                  </div>
                  <div className={styles.fbInputRow}>
                    <input
                      className={`${styles.fbInput} nokey`}
                      value={fbText}
                      onChange={e => setFbText(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submitFeedback() } }}
                      placeholder={selectedNodeId ? 'Feedback on selected node...' : 'Write feedback...'}
                    />
                    <button className={styles.fbSendBtn} onClick={submitFeedback} disabled={!fbText.trim()}>Send</button>
                  </div>
                </div>
              </>
            )}

            {fbTab === 'review' && <ReviewTab />}
          </div>
          </div>
        </>
      )}
    </div>
  );
}
