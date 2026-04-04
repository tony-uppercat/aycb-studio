/**
 * FullscreenMediaBrowser v4 — virtual scroll.
 *
 * Only renders ~100 visible cells at a time (not all 580+).
 * Uses background-image divs + aspect-ratio: 1 for square cells.
 * Ctrl+M to open/close.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMediaSelection } from '../../hooks/useMediaSelection'
import { useMediaFiltering, type SortOption, type FilterOption } from '../../hooks/useMediaFiltering'
import { useFavoriteToggle } from '../../hooks/useFavoriteToggle'
import { formatSize } from '../../utils/mediaFormatting'
import { fetchReviewStatus, type ReviewStatus } from '../../utils/reviewStatus'
import { downloadFromUrl } from '../../utils/downloadManager'
import { FullscreenViewer } from './FullscreenViewer'
import { MediaBrowserContextMenu } from './MediaBrowserContextMenu'
import { CANVAS_EVENTS } from '../../events/canvasEvents'
import { STORAGE_KEYS } from '../../storage/keys'
import s from './FullscreenMediaBrowser.module.css'

/* ── Types ── */

export interface DiskMediaEntry {
  id: string; filename: string; project: string; path: string
  size: number; type: string; modified: string; thumb: string | null; meta: string
}
export interface Props { open: boolean; onClose: () => void }
type TypeF = 'all' | 'images' | 'videos'
type RevF = 'all' | 'favorites' | 'approved' | 'rejected'

/* ── Helpers ── */
const fileUrl = (e: DiskMediaEntry) => {
  const d = e.path || e.project
  return `/api/bridge/media/file/${d.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(e.filename)}`
}

/* ── Virtual scroll hook ── */
function useVirtualGrid(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  itemCount: number,
  colSize: number,
  gap: number,
  padding: number,
) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewH, setViewH] = useState(800)
  const [containerW, setContainerW] = useState(1200)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onScroll = () => setScrollTop(el.scrollTop)
    const onResize = () => {
      setViewH(el.clientHeight)
      setContainerW(el.clientWidth - padding * 2)
    }
    onResize()
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(() => onResize())
    ro.observe(el)
    return () => { el.removeEventListener('scroll', onScroll); ro.disconnect() }
  }, [scrollRef, padding])

  return useMemo(() => {
    const cols = Math.max(1, Math.floor((containerW + gap) / (colSize + gap)))
    const cellSize = (containerW - (cols - 1) * gap) / cols
    const rowH = cellSize + gap
    const totalRows = Math.ceil(itemCount / cols)
    const totalH = totalRows * rowH - gap + padding * 2

    const startRow = Math.max(0, Math.floor((scrollTop - padding) / rowH) - 2)
    const endRow = Math.min(totalRows, Math.ceil((scrollTop + viewH - padding) / rowH) + 2)
    const startIdx = startRow * cols
    const endIdx = Math.min(itemCount, endRow * cols)
    const offsetY = padding + startRow * rowH

    return { cols, cellSize, rowH, totalH, startIdx, endIdx, offsetY }
  }, [containerW, itemCount, colSize, gap, padding, scrollTop, viewH])
}

/* ── Main ── */
export function FullscreenMediaBrowser({ open, onClose }: Props) {
  const [entries, setEntries] = useState<DiskMediaEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  const [projects, setProjects] = useState<string[]>([])
  const [revs, setRevs] = useState<Record<string, ReviewStatus | null>>({})
  const [rawQ, setRawQ] = useState(''); const [q, setQ] = useState('')
  const [sort, setSort] = useState<SortOption>('newest')
  const [typeF, setTypeF] = useState<TypeF>('all')
  const [revF, setRevF] = useState<RevF>('all')
  const [projF, setProjF] = useState(() => localStorage.getItem(STORAGE_KEYS.ACTIVE_PROJECT_NAME) || 'all')
  const [colPx, setColPx] = useState(160)
  const [fsIdx, setFsIdx] = useState<number | null>(null)
  const sel = useMediaSelection()
  const onFav = useFavoriteToggle(setRevs)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const qRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; entry: DiskMediaEntry; idx: number } | null>(null)

  // ── Context menu handlers ──
  const handleCellContextMenu = useCallback((e: React.MouseEvent, entry: DiskMediaEntry, idx: number) => {
    e.preventDefault()
    e.stopPropagation()
    setCtxMenu({ x: e.clientX, y: e.clientY, entry, idx })
  }, [])

  const handleImportToProject = useCallback((entry: DiskMediaEntry) => {
    // Dispatch a custom event that FlowCanvas listens for to create an ImageUpload node
    const url = fileUrl(entry)
    window.dispatchEvent(new CustomEvent(CANVAS_EVENTS.MEDIA_IMPORT_TO_PROJECT, {
      detail: { filename: entry.filename, url, type: entry.type, project: entry.project },
    }))
  }, [])

  const handleCtxDownload = useCallback((entry: DiskMediaEntry) => {
    downloadFromUrl(fileUrl(entry), entry.filename)
  }, [])

  const handleCtxReviewHub = useCallback((entry: DiskMediaEntry) => {
    window.open(`/review?media=${encodeURIComponent(entry.id)}`, '_blank')
  }, [])

  // Load — loaded resets via cleanup, avoiding sync setState in the effect body
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15000)
    fetch('/api/bridge/media/list', { signal: controller.signal })
      .then(r => r.json())
      .then((items: DiskMediaEntry[]) => {
        setEntries(items); setProjects([...new Set(items.map(e => e.project))].sort())
        sel.clearSelection(); setLoaded(true)
        for (const e of items) fetchReviewStatus(e.id).then(st => { if (!controller.signal.aborted && st) setRevs(p => ({ ...p, [e.id]: st })) })
      })
      .catch(err => { if (err.name !== 'AbortError') setLoaded(true) })
      .finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort(); setLoaded(false) }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const onQ = useCallback((v: string) => {
    setRawQ(v); if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setQ(v), 300)
  }, [])

  // Map TypeF/RevF to shared FilterOption
  const filterBy: FilterOption = revF !== 'all' ? revF : typeF !== 'all' ? typeF : 'all'
  const baseSorted = useMediaFiltering(entries, sort, filterBy, revs)

  // Apply project + search filters (specific to fullscreen browser)
  const list = useMemo(() => {
    let l = baseSorted
    if (projF !== 'all') l = l.filter(e => e.project === projF)
    const sq = q.trim().toLowerCase()
    if (sq) l = l.filter(e => e.filename.toLowerCase().includes(sq))
    return l
  }, [baseSorted, projF, q])

  const totalSz = useMemo(() => list.reduce((a, e) => a + e.size, 0), [list])

  // Virtual grid
  const virt = useVirtualGrid(scrollRef, list.length, colPx, 8, 12)
  const visibleItems = list.slice(virt.startIdx, virt.endIdx)

  // Keys
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
      const inp = tag === 'input' || tag === 'textarea' || tag === 'select'
      if (e.key === 'm' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); onClose(); return }
      if (e.ctrlKey || e.metaKey) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (fsIdx !== null) { setFsIdx(null); return }
        onClose(); return
      }
      if (!inp) {
        if (e.code === 'Space') {
          e.preventDefault()
          if (sel.selected.size > 0) {
            const firstId = [...sel.selected][0]
            const idx = list.findIndex(x => x.id === firstId)
            if (idx >= 0) setFsIdx(idx)
          }
          return
        }
        if (e.key === 'a' || e.key === 'A') { e.preventDefault(); sel.selectAll(list.map(x => x.id)); return }
        if (e.key === '/') { e.preventDefault(); qRef.current?.focus(); return }
      }
    }
    document.addEventListener('keydown', h, true)
    return () => document.removeEventListener('keydown', h, true)
  }, [open, fsIdx, onClose, sel, list])

  if (!open) return null

  return (
    <div className={s.root}>
      {/* HEADER */}
      <header className={s.hdr}>
        <select className={s.hdrSelect} value={projF} onChange={e => setProjF(e.target.value)}>
          <option value="all">All Projects</option>
          {projects.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <div className={s.hdrFilters}>
          {(['all', 'images', 'videos'] as TypeF[]).map(t => (
            <button key={t} className={`${s.hdrBtn} ${typeF === t ? s.hdrBtnOn : ''}`} onClick={() => setTypeF(t)}>
              {t === 'all' ? 'All' : t === 'images' ? 'Img' : 'Vid'}
            </button>
          ))}
          <span className={s.hdrSep} />
          <button className={`${s.hdrBtn} ${revF === 'favorites' ? s.hdrBtnOn : ''}`} onClick={() => setRevF(p => p === 'favorites' ? 'all' : 'favorites')}>★</button>
          <button className={`${s.hdrBtn} ${revF === 'approved' ? s.hdrBtnGreen : ''}`} onClick={() => setRevF(p => p === 'approved' ? 'all' : 'approved')}>✓</button>
          <button className={`${s.hdrBtn} ${revF === 'rejected' ? s.hdrBtnRed : ''}`} onClick={() => setRevF(p => p === 'rejected' ? 'all' : 'rejected')}>✗</button>
        </div>
        <div className={s.hdrSearch}>
          <input ref={qRef} className={s.hdrSearchIn} placeholder="Search... (/)" value={rawQ} onChange={e => onQ(e.target.value)} />
          {rawQ && <button className={s.hdrSearchX} onClick={() => { onQ(''); qRef.current?.focus() }}>×</button>}
        </div>
        <span className={s.hdrCount}>{list.length}</span>
        <select className={s.hdrSelect} value={sort} onChange={e => setSort(e.target.value as SortOption)}>
          <option value="newest">Newest</option><option value="oldest">Oldest</option>
          <option value="largest">Largest</option><option value="name">Name</option>
        </select>
        <div className={s.hdrSlider}><span>⊞</span>
          <input type="range" min={80} max={320} step={20} value={colPx} onChange={e => setColPx(+e.target.value)} />
        </div>
        <button className={s.hdrClose} onClick={onClose}>✕</button>
      </header>

      {/* BODY */}
      <div className={s.body}>
        {/* GRID — virtual scroll */}
        <div className={s.scroll} ref={scrollRef}>
          <div className={s.scrollInner} style={{ height: virt.totalH }}>
            {!loaded && <p className={s.gridEmpty}>Loading...</p>}
            {loaded && list.length === 0 && <p className={s.gridEmpty}>No media</p>}
            {loaded && list.length > 0 && (
              <div
                className={s.visibleGrid}
                style={{
                  top: virt.offsetY,
                  '--col': `${colPx}px`,
                } as React.CSSProperties}
              >
                {visibleItems.map((e, vi) => {
                  const realIdx = virt.startIdx + vi
                  return (
                    <div
                      key={e.id}
                      className={`${s.cell} ${sel.selected.has(e.id) ? s.cellOn : ''}`}
                      onClick={ev => sel.toggleSelect(e.id, realIdx, list.map(x => x.id), ev.shiftKey, ev.ctrlKey || ev.metaKey)}
                      onDoubleClick={() => setFsIdx(realIdx)}
                      onContextMenu={ev => handleCellContextMenu(ev, e, realIdx)}
                    >
                      <div className={s.cellBg} style={e.thumb ? { backgroundImage: `url(${e.thumb})` } : undefined}>
                        <button className={`${s.cellFav} ${revs[e.id]?.favorite ? s.cellFavOn : ''}`} onClick={ev => { ev.stopPropagation(); void onFav(e.id) }}>★</button>
                        {revs[e.id]?.status === 'approved' && <span className={`${s.cellBadge} ${s.cellBadgeOk}`}>✓</span>}
                        {revs[e.id]?.status === 'rejected' && <span className={`${s.cellBadge} ${s.cellBadgeNo}`}>✗</span>}
                        <div className={s.cellOver}>
                          <span className={s.cellName}>{e.filename}</span>
                          <span className={s.cellMeta}>{formatSize(e.size)} · {e.project}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FOOTER */}
      <footer className={s.foot}>
        <div className={s.footL}>
          <span>{list.length} items</span><span className={s.footSep}>·</span><span>{formatSize(totalSz)}</span>
          {sel.selected.size > 0 && <><span className={s.footSep}>·</span><span className={s.footHi}>{sel.selected.size} selected</span></>}
        </div>
        <button className={s.footBtn} onClick={() => {
          const ids = sel.selected.size > 0 ? [...sel.selected] : list.map(e => e.id)
          for (const id of ids) { const e = entries.find(x => x.id === id); if (e) downloadFromUrl(fileUrl(e), e.filename) }
        }}>↓ {sel.selected.size > 0 ? `Download (${sel.selected.size})` : 'Download All'}</button>
      </footer>

      {fsIdx !== null && list[fsIdx] && <FullscreenViewer entries={list} initialIndex={fsIdx} onClose={() => setFsIdx(null)} reviewStatuses={revs} onFavoriteToggle={onFav} onFindInExplorer={(e) => { const dir = e.path || e.project; if (dir) fetch(`/api/bridge/explore/${encodeURIComponent(dir)}/${encodeURIComponent(e.filename)}`, { method: 'POST' }).catch(err => console.warn('[bridge] explore failed:', err.message ?? err)) }} onDownload={(src, filename) => downloadFromUrl(src, filename)} />}

      {/* Context Menu */}
      {ctxMenu && (
        <MediaBrowserContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          entry={ctxMenu.entry}
          onClose={() => setCtxMenu(null)}
          onPreview={() => setFsIdx(ctxMenu.idx)}
          onImportToProject={handleImportToProject}
          onDownload={handleCtxDownload}
          onOpenInReviewHub={handleCtxReviewHub}
        />
      )}
    </div>
  )
}
