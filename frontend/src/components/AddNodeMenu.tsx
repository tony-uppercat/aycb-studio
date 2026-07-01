import { useEffect, useRef, useState } from 'react'
import type { Node, Edge } from '@xyflow/react'
import { NODE_CATALOG, CATEGORY_LABELS, getCompatibleNodes, type NodeManifest } from '../nodes/index'
import { matchAliases, applyAlias, type QuickAlias } from '../nodes/quickAliases'
import { PRESETS } from './project/ProjectGallery'
import { getUserTemplates, deleteUserTemplate, updateUserTemplate, type UserTemplate } from '../presets'
import styles from './AddNodeMenu.module.css'

interface Props {
  open: boolean
  onClose: () => void
  onAdd: (entry: NodeManifest) => void
  onAddTemplate?: (nodes: Node[], edges: Edge[]) => void
  filter?: { slotType: string; direction: 'input' | 'output' }
  position?: { x: number; y: number }
}

const CATEGORY_ORDER = ['input', 'media-model', 'llm', 'utility'] as const

export function AddNodeMenu({ open, onClose, onAdd, onAddTemplate, filter, position }: Props) {
  const [query, setQuery] = useState('')
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([])
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])

  const baseCatalog = filter
    ? getCompatibleNodes(NODE_CATALOG, filter.slotType, filter.direction)
    : NODE_CATALOG

  const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '')
  const q = normalize(query)
  const filtered = q
    ? baseCatalog.filter(n => normalize(n.label).includes(q) || normalize(n.description).includes(q) || n.category.includes(q))
    : baseCatalog

  const templates = !filter && onAddTemplate
    ? (q
      ? PRESETS.filter(p => p.nodes.length > 0 && (normalize(p.name).includes(q) || normalize(p.description).includes(q)))
      : PRESETS.filter(p => p.nodes.length > 0))
    : []

  const filteredUserTemplates = !filter && onAddTemplate
    ? (q
      ? userTemplates.filter(t => normalize(t.name).includes(q) || normalize(t.description).includes(q))
      : userTemplates)
    : []

  // Quick-add aliases (e.g. "nb2" → Image with Nano Banana 2). Only when the
  // user is typing and we're not in a connection-drag filter mode (typed model
  // would clash with the slot-type constraint anyway).
  const aliases = !filter && q ? matchAliases(query) : []

  // Flat list of all selectable items for keyboard navigation. Aliases appear
  // FIRST so the most-likely match takes default Enter.
  const allItems: Array<
    | { type: 'alias'; alias: QuickAlias }
    | { type: 'node'; entry: NodeManifest }
    | { type: 'template'; preset: typeof PRESETS[0] }
    | { type: 'userTemplate'; template: UserTemplate }
  > = [
    ...aliases.map(alias => ({ type: 'alias' as const, alias })),
    ...filtered.map(entry => ({ type: 'node' as const, entry })),
    ...templates.map(preset => ({ type: 'template' as const, preset })),
    ...filteredUserTemplates.map(template => ({ type: 'userTemplate' as const, template })),
  ]

  const totalItems = allItems.length

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setQuery('')
      setFocusedIndex(0)
      setUserTemplates(getUserTemplates())
      setTimeout(() => inputRef.current?.focus(), 50)
    }
  }, [open])

  // Rebuild itemRefs array length without mutating during render
  useEffect(() => {
    itemRefs.current = new Array(totalItems).fill(null)
  }, [totalItems])

  if (!open) return null

  const grouped = CATEGORY_ORDER.map(cat => ({
    cat,
    label: CATEGORY_LABELS[cat],
    items: filtered.filter(n => n.category === cat),
  })).filter(g => g.items.length > 0)

  const menuClass = position ? styles.menuPositioned : styles.menu
  const menuStyle = position ? {
    left: Math.min(position.x, window.innerWidth - 340),
    top: Math.min(position.y, window.innerHeight - 400),
  } : undefined

  const headerLabel = filter
    ? `Compatible with ${filter.slotType} ${filter.direction}`
    : 'Add Node'

  function select(entry: NodeManifest) {
    onAdd(entry)
    onClose()
  }

  function selectAlias(alias: QuickAlias) {
    const base = NODE_CATALOG.find(n => n.type === alias.nodeType)
    if (!base) return
    onAdd(applyAlias(base, alias))
    onClose()
  }

  function getFlatIndexForAlias(alias: QuickAlias): number {
    return allItems.findIndex(item => item.type === 'alias' && item.alias.alias === alias.alias && item.alias.nodeType === alias.nodeType)
  }

  function getFlatIndexForNode(entry: NodeManifest): number {
    return allItems.findIndex(item => item.type === 'node' && item.entry.type === entry.type)
  }

  function getFlatIndexForTemplate(presetId: string): number {
    return allItems.findIndex(item => item.type === 'template' && item.preset.id === presetId)
  }

  function getFlatIndexForUserTemplate(templateId: string): number {
    return allItems.findIndex(item => item.type === 'userTemplate' && item.template.id === templateId)
  }

  function scrollItemIntoView(index: number) {
    const el = itemRefs.current[index]
    if (el) {
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex(prev => {
        const next = totalItems === 0 ? 0 : (prev + 1) % totalItems
        setTimeout(() => scrollItemIntoView(next), 0)
        return next
      })
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex(prev => {
        const next = totalItems === 0 ? 0 : (prev - 1 + totalItems) % totalItems
        setTimeout(() => scrollItemIntoView(next), 0)
        return next
      })
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      if (totalItems === 0) return
      const item = allItems[focusedIndex]
      if (!item) return
      if (item.type === 'alias') {
        selectAlias(item.alias)
      } else if (item.type === 'node') {
        select(item.entry)
      } else if (item.type === 'template' && onAddTemplate) {
        onAddTemplate(item.preset.nodes, item.preset.edges)
        onClose()
      } else if (item.type === 'userTemplate' && onAddTemplate) {
        onAddTemplate(item.template.nodes, item.template.edges)
        onClose()
      }
    }
  }

  // Reset focused index when query changes
  function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value)
    setFocusedIndex(0)
  }

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={menuClass} style={menuStyle}>
        <div className={styles.searchWrap}>
          <div className={styles.menuHeader}>{headerLabel}</div>
          <input
            ref={inputRef}
            className={styles.searchInput}
            placeholder="Search nodes..."
            value={query}
            onChange={handleQueryChange}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className={styles.list} ref={listRef}>
          {aliases.length > 0 && (
            <div>
              <div className={styles.categoryLabel}>Quick</div>
              {aliases.map(a => {
                const flatIndex = getFlatIndexForAlias(a)
                const isFocused = flatIndex === focusedIndex
                return (
                  <div
                    key={`${a.nodeType}:${a.alias}`}
                    ref={el => { itemRefs.current[flatIndex] = el }}
                    className={`${styles.item}${isFocused ? ' ' + styles.itemFocused : ''}`}
                    onClick={() => selectAlias(a)}
                    onMouseEnter={() => setFocusedIndex(flatIndex)}
                  >
                    <span className={styles.itemIcon}>{NODE_CATALOG.find(n => n.type === a.nodeType)?.icon ?? '+'}</span>
                    <div className={styles.itemInfo}>
                      <div className={styles.itemName}>{a.label} <span style={{ opacity: 0.55, fontSize: 11 }}>· {a.alias}</span></div>
                      <div className={styles.itemDesc}>{a.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {grouped.map(g => (
            <div key={g.cat}>
              <div className={styles.categoryLabel}>{g.label}</div>
              {g.items.map(entry => {
                const flatIndex = getFlatIndexForNode(entry)
                const isFocused = flatIndex === focusedIndex
                return (
                  <div
                    key={entry.type}
                    ref={el => { itemRefs.current[flatIndex] = el }}
                    className={`${styles.item}${isFocused ? ' ' + styles.itemFocused : ''}`}
                    onClick={() => select(entry)}
                    onMouseEnter={() => setFocusedIndex(flatIndex)}
                  >
                    <span className={styles.itemIcon}>{entry.icon}</span>
                    <div className={styles.itemInfo}>
                      <div className={styles.itemName}>{entry.label}</div>
                      <div className={styles.itemDesc}>{entry.description}</div>
                    </div>
                  </div>
                )
              })}
            </div>
          ))}
          {templates.length > 0 && (
            <div>
              <div className={styles.categoryLabel}>Templates</div>
              {templates.map(p => {
                const flatIndex = getFlatIndexForTemplate(p.id)
                const isFocused = flatIndex === focusedIndex
                return (
                  <div
                    key={p.id}
                    ref={el => { itemRefs.current[flatIndex] = el }}
                    className={`${styles.item}${isFocused ? ' ' + styles.itemFocused : ''}`}
                    onClick={() => { onAddTemplate!(p.nodes, p.edges); onClose() }}
                    onMouseEnter={() => setFocusedIndex(flatIndex)}
                  >
                    <span className={styles.itemIcon}>{p.icon}</span>
                    <div className={styles.itemInfo}>
                      <div className={styles.itemName}>{p.name}</div>
                      <div className={styles.itemDesc}>{p.description} · {p.nodes.length} nodes</div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          {filteredUserTemplates.length > 0 && (
            <div>
              <div className={`${styles.categoryLabel} ${styles.categoryLabelAmber}`}>My Templates</div>
              {filteredUserTemplates.map(t => {
                const flatIndex = getFlatIndexForUserTemplate(t.id)
                const isFocused = flatIndex === focusedIndex
                return (
                  <div
                    key={t.id}
                    ref={el => { itemRefs.current[flatIndex] = el }}
                    className={`${styles.item}${isFocused ? ' ' + styles.itemFocused : ''}`}
                    onClick={() => { onAddTemplate!(t.nodes, t.edges); onClose() }}
                    onMouseEnter={() => setFocusedIndex(flatIndex)}
                  >
                    <span className={styles.itemIcon}>
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="#f59e0b" aria-hidden="true">
                        <path d="M8 1L9.8 6h5.2l-4.2 3.1L12.3 14 8 11.1 3.7 14l1.5-4.9L1 6h5.2z"/>
                      </svg>
                    </span>
                    <div className={styles.itemInfo}>
                      <div className={styles.itemName}>{t.name}</div>
                      <div className={styles.itemDesc}>{t.description}</div>
                    </div>
                    <button
                      className={styles.deleteBtn}
                      title="Rename template"
                      onClick={e => {
                        e.stopPropagation()
                        const newName = window.prompt('Rename template:', t.name)
                        if (newName && newName.trim()) {
                          updateUserTemplate(t.id, { name: newName.trim() })
                          setUserTemplates(getUserTemplates())
                        }
                      }}
                    >R</button>
                    <button
                      className={styles.deleteBtn}
                      title="Delete template"
                      onClick={e => {
                        e.stopPropagation()
                        deleteUserTemplate(t.id)
                        setUserTemplates(getUserTemplates())
                      }}
                    >×</button>
                  </div>
                )
              })}
            </div>
          )}
          {filtered.length === 0 && templates.length === 0 && filteredUserTemplates.length === 0 && aliases.length === 0 && (
            <div className={styles.hint}>No nodes match "{query}"</div>
          )}
        </div>
        <div className={styles.hint}>↑↓ to navigate · Enter to add · Esc to close</div>
      </div>
    </>
  )
}
