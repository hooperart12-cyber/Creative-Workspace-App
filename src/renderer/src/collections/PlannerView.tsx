import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { assetUrl } from '@shared/assets'
import {
  inspectorLayout,
  layoutSpreads,
  spreadSides,
  type CollectionDetail,
  type CollectionPageView,
  type PagePatch
} from '@shared/collections'
import { dragGhost, dropPlan } from '@shared/collectionDrag'
import { selectPageIds, stepPages } from '@shared/collectionOrder'
import {
  collectionQueryActive,
  hiddenSelectionCount,
  visiblePageRange
} from '@shared/collectionSearch'
import { reportError, showNotice, useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { BulkEditDialog } from './BulkEditDialog'
import { ExportDialog } from './ExportDialog'
import { ImportPagesDialog } from './ImportPagesDialog'
import { PageInspector } from './PageInspector'

type ImportRecord = {
  created: string[]
  filled: {
    pageId: string
    versionIds: string[]
    previousDisplayed: string | null
    revision: number
  }[]
}

type Undo =
  | { kind: 'insert' | 'trash'; pageIds: string[] }
  | { kind: 'bulk'; entries: { id: string; revision: number; previous: PagePatch }[] }
  | { kind: 'import'; record: ImportRecord }
  | { kind: 'order'; pageIds: string[] }
  | null

const button = 'rounded border border-line px-2 py-1 text-xs hover:bg-canvas disabled:opacity-40'

function caption(page: CollectionPageView): string {
  if (page.label) return page.label
  if (page.number != null) return String(page.number)
  return page.role ?? 'Page'
}

export function PlannerView() {
  const collectionId = useWorkspaceStore((s) => s.plannerCollectionId)
  const epoch = useWorkspaceStore((s) => s.sidebarEpoch)
  const showCanvas = useWorkspaceStore((s) => s.showCanvas)
  const [detail, setDetail] = useState<CollectionDetail | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [focusId, setFocusId] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const initialized = useRef<string | null>(null)
  const [addCount, setAddCount] = useState(1)
  const [addTitle, setAddTitle] = useState('')
  const [addNotes, setAddNotes] = useState('')
  const [undo, setUndo] = useState<Undo>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [matchIds, setMatchIds] = useState<string[] | null>(null)
  const [dragIds, setDragIds] = useState<string[] | null>(null)
  const [hover, setHover] = useState<{ overId: string; place: 'before' | 'after' } | null>(null)
  const [showBulk, setShowBulk] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [scrollTop, setScrollTop] = useState(0)
  const [frame, setFrame] = useState({ width: 800, height: 640 })

  useEffect(() => {
    if (!collectionId) return
    let cancel = false
    void window.api
      .invoke('collections:detail', collectionId)
      .then((next) => {
        if (cancel) return
        setDetail(next)
        setError(null)
        if (initialized.current !== collectionId) {
          initialized.current = collectionId
          const hint = useWorkspaceStore.getState().plannerFocusId
          const preferred = [hint, next.plannerPageId].find(
            (id) => id && next.pages.some((page) => page.id === id)
          )
          const focus = preferred ?? next.pages[0]?.id ?? null
          setSelected(focus ? [focus] : [])
          setFocusId(focus)
          setUndo(null)
          setQuery('')
          setMatchIds(null)
        } else {
          setSelected((current) =>
            current.filter((id) => next.pages.some((page) => page.id === id))
          )
          setFocusId((current) =>
            current && next.pages.some((page) => page.id === current)
              ? current
              : (next.pages[0]?.id ?? null)
          )
        }
      })
      .catch((caught) => {
        if (!cancel) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancel = true
    }
  }, [collectionId, epoch, reloadToken])

  useEffect(() => {
    if (!collectionId || !focusId) return
    void window.api
      .invoke('collections:rememberPlanner', collectionId, { pageId: focusId })
      .catch(() => {})
  }, [collectionId, focusId])

  useEffect(() => {
    if (!collectionId || !collectionQueryActive(query)) return
    let cancel = false
    void window.api.invoke('collections:search', collectionId, query).then((result) => {
      if (!cancel) setMatchIds(result.ids)
    })
    return () => {
      cancel = true
    }
  }, [collectionId, query, detail])

  const reload = () => setReloadToken((token) => token + 1)

  const moveFocus = (delta: number) => {
    if (!detail || !focusId) return
    const index = detail.pages.findIndex((page) => page.id === focusId)
    const next = detail.pages[index + delta]
    if (!next) return
    setSelected([next.id])
    setFocusId(next.id)
  }

  const trashFocused = async () => {
    if (!focusId) return
    try {
      const trashed = await window.api.invoke('collections:trashPages', [focusId])
      setUndo({ kind: 'trash', pageIds: trashed.pageIds })
      setReloadToken((token) => token + 1)
    } catch (caught) {
      reportError(caught)
    }
  }

  const runUndo = async () => {
    if (!undo) return
    try {
      if (undo.kind === 'insert') await window.api.invoke('collections:undoPages', undo.pageIds)
      else if (undo.kind === 'trash')
        await window.api.invoke('collections:restorePages', undo.pageIds)
      else if (undo.kind === 'bulk') await window.api.invoke('collections:undoBulk', undo.entries)
      else if (undo.kind === 'import')
        await window.api.invoke('collections:undoImport', undo.record)
      else if (detail) await window.api.invoke('collections:orderPages', detail.id, undo.pageIds)
      setUndo(null)
      setReloadToken((token) => token + 1)
    } catch (caught) {
      reportError(caught)
    }
  }

  const step = async (direction: 'earlier' | 'later') => {
    if (!detail || selected.length === 0 || collectionQueryActive(query)) return
    const move = stepPages(detail.pages, selected, direction)
    if (!move) return
    try {
      const previous = detail.pages.map((page) => page.id)
      await window.api.invoke('collections:reorderPages', detail.id, move.pageIds, move.beforeId)
      setUndo({ kind: 'order', pageIds: previous })
      setReloadToken((token) => token + 1)
    } catch (caught) {
      reportError(caught)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      const root = document.getElementById('page-planner')
      if (!root?.contains(target)) return
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return
      }
      if (!detail) return
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault()
        void runUndo()
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault()
        setSelected(shownIds(detail, query, matchIds))
        return
      }
      if (event.key === 'Escape') {
        setDragIds(null)
        setHover(null)
        return
      }
      if ((event.key === 'Delete' || event.key === 'Backspace') && focusId) {
        event.preventDefault()
        void trashFocused()
        return
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        moveFocus(-1)
      }
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        moveFocus(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!collectionId) return null
  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm">
        <p>{error}</p>
      </div>
    )
  }
  if (!detail) {
    return <div className="flex-1 p-6 text-sm text-muted">Opening planner…</div>
  }

  const focus = detail.pages.find((page) => page.id === focusId) ?? null
  const filtering = collectionQueryActive(query)
  const visible = filtering
    ? (matchIds ?? [])
        .map((id) => detail.pages.find((page) => page.id === id))
        .filter((page): page is CollectionPageView => page != null)
    : detail.pages
  const ids = visible.map((page) => page.id)
  const hidden = hiddenSelectionCount(selected, ids)
  const ghost = dragIds ? dragGhost(detail.pages, dragIds) : null
  const spreads = layoutSpreads(
    visible.map((page) => ({ id: page.id, span: page.span, spreadId: page.spreadId }))
  )
  const columns = Math.max(1, Math.floor(frame.width / (detail.gridSize + 12)))
  const range =
    visible.length > 40
      ? visiblePageRange({
          count: visible.length,
          scrollTop,
          viewport: frame.height,
          rowHeight: detail.gridSize + 28,
          columns
        })
      : { start: 0, end: visible.length }
  const windowed = visible.slice(range.start, range.end)
  const choose = (
    pageId: string,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean }
  ) => {
    const mode = event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'toggle' : 'replace'
    const next = selectPageIds(ids, selected, focusId, pageId, mode)
    setSelected(next.selected)
    setFocusId(next.focusId)
  }
  const dropOn = (overId: string, place: 'before' | 'after') => {
    if (!dragIds || filtering) return
    const previous = detail.pages.map((page) => page.id)
    const plan = dropPlan(detail.pages, dragIds, overId, place)
    setDragIds(null)
    setHover(null)
    if (!plan.ok) {
      showNotice(plan.error)
      return
    }
    void window.api
      .invoke('collections:reorderPages', detail.id, plan.pageIds, plan.beforeId)
      .then(() => {
        setUndo({ kind: 'order', pageIds: previous })
        reload()
      })
      .catch((caught) => reportError(caught))
  }

  return (
    <div id="page-planner" className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button type="button" className={button} onClick={showCanvas}>
            Back to canvas
          </button>
          <button
            type="button"
            className={button}
            onClick={() => useWorkspaceStore.getState().openOverview(detail.id)}
          >
            Overview
          </button>
          <button
            type="button"
            className={button}
            onClick={() => useWorkspaceStore.getState().openReader(detail.id, focusId)}
          >
            Read
          </button>
          <button
            type="button"
            className={button}
            disabled={!focusId}
            onClick={() => focusId && useWorkspaceStore.getState().openReview(detail.id, focusId)}
          >
            Review
          </button>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{detail.title}</h1>
          <div
            className="flex rounded-lg border border-line p-0.5"
            role="group"
            aria-label="Planner view"
          >
            {(['grid', 'spread'] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={detail.plannerView === view}
                className={`rounded px-2 py-1 text-xs ${detail.plannerView === view ? 'bg-accent text-white' : ''}`}
                onClick={() => {
                  void window.api
                    .invoke('collections:rememberPlanner', detail.id, { view })
                    .then(() => setDetail({ ...detail, plannerView: view }))
                    .catch((caught) => reportError(caught))
                }}
              >
                {view === 'grid' ? 'Thumbnail grid' : 'Spread layout'}
              </button>
            ))}
          </div>
          <label className="text-xs text-muted">
            Direction
            <select
              value={detail.direction}
              aria-label="Reading direction"
              className="ml-1 rounded border border-line bg-canvas px-1 py-1"
              onChange={(event) => {
                const direction = event.target.value === 'rtl' ? 'rtl' : 'ltr'
                void window.api
                  .invoke('collections:updateSettings', detail.id, { direction })
                  .then(reload)
                  .catch((caught) => reportError(caught))
              }}
            >
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            First page
            <select
              value={detail.firstPageSide}
              aria-label="Opening side"
              className="ml-1 rounded border border-line bg-canvas px-1 py-1"
              onChange={(event) => {
                const firstPageSide = event.target.value === 'left' ? 'left' : 'right'
                void window.api
                  .invoke('collections:updateSettings', detail.id, { firstPageSide })
                  .then(reload)
                  .catch((caught) => reportError(caught))
              }}
            >
              <option value="right">Right</option>
              <option value="left">Left</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            Starts at
            <input
              type="number"
              min={0}
              defaultValue={detail.numberStart}
              key={`${detail.id}-${detail.numberStart}`}
              aria-label="First story number"
              className="ml-1 w-16 rounded border border-line bg-canvas px-1 py-1"
              onBlur={(event) => {
                const numberStart = Math.max(0, Number(event.target.value) || 0)
                if (numberStart === detail.numberStart) return
                void window.api
                  .invoke('collections:updateSettings', detail.id, { numberStart })
                  .then(reload)
                  .catch((caught) => reportError(caught))
              }}
            />
          </label>
        </header>
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <button
            type="button"
            className={button}
            disabled={filtering}
            title={filtering ? 'Reorder is off while a filter is on' : undefined}
            onClick={() => void step('earlier')}
          >
            Earlier
          </button>
          <button
            type="button"
            className={button}
            disabled={filtering}
            title={filtering ? 'Reorder is off while a filter is on' : undefined}
            onClick={() => void step('later')}
          >
            Later
          </button>
          <label className="text-xs text-muted">
            Add
            <input
              type="number"
              min={1}
              max={20}
              value={addCount}
              aria-label="Pages to add"
              onChange={(event) =>
                setAddCount(Math.min(20, Math.max(1, Number(event.target.value) || 1)))
              }
              className="ml-1 w-14 rounded border border-line bg-canvas px-1 py-1"
            />
          </label>
          <input
            value={addTitle}
            aria-label="Placeholder title"
            placeholder="Title"
            onChange={(event) => setAddTitle(event.target.value)}
            className="w-28 rounded border border-line bg-canvas px-1 py-1 text-xs"
          />
          <input
            value={addNotes}
            aria-label="Placeholder notes"
            placeholder="Notes"
            onChange={(event) => setAddNotes(event.target.value)}
            className="w-36 rounded border border-line bg-canvas px-1 py-1 text-xs"
          />
          <button
            type="button"
            className={button}
            onClick={() => {
              void window.api
                .invoke('collections:insertPages', {
                  collectionId: detail.id,
                  count: addCount,
                  beforeId: focusId,
                  title: addTitle,
                  notes: addNotes
                })
                .then((inserted) => {
                  setUndo({ kind: 'insert', pageIds: inserted.pageIds })
                  setReloadToken((token) => token + 1)
                })
                .catch((caught) => reportError(caught))
            }}
          >
            Insert before
          </button>
          <button
            type="button"
            className={button}
            onClick={() => {
              void window.api
                .invoke('collections:insertPages', {
                  collectionId: detail.id,
                  count: addCount,
                  title: addTitle,
                  notes: addNotes
                })
                .then((inserted) => {
                  setUndo({ kind: 'insert', pageIds: inserted.pageIds })
                  setReloadToken((token) => token + 1)
                })
                .catch((caught) => reportError(caught))
            }}
          >
            Add at end
          </button>
          <button
            type="button"
            className={button}
            disabled={!focusId}
            onClick={() => void trashFocused()}
          >
            Trash page
          </button>
          <button type="button" className={button} disabled={!undo} onClick={() => void runUndo()}>
            Undo
          </button>
          <button type="button" className={button} onClick={() => setShowImport(true)}>
            Import
          </button>
          <button type="button" className={button} onClick={() => setShowExport(true)}>
            Export
          </button>
          <button
            type="button"
            className={button}
            disabled={selected.length < 2}
            onClick={() => setShowBulk(true)}
          >
            Edit selected
          </button>
          <label className="text-xs text-muted">
            Find
            <input
              aria-label="Find in this collection"
              value={query}
              placeholder="Title, note, tag, status"
              onChange={(event) => setQuery(event.target.value)}
              className="ml-1 w-40 rounded border border-line bg-canvas px-1 py-1"
            />
          </label>
          <label className="text-xs text-muted">
            Density
            <select
              aria-label="Thumbnail density"
              value={detail.gridDensity}
              className="ml-1 rounded border border-line bg-canvas px-1 py-1"
              onChange={(event) => {
                const density = event.target.value as 'compact' | 'balanced' | 'detailed'
                const gridSize = density === 'compact' ? 112 : density === 'detailed' ? 220 : 160
                setDetail({ ...detail, gridDensity: density, gridSize })
                void window.api
                  .invoke('collections:rememberPlanner', detail.id, { density, gridSize })
                  .catch((caught) => reportError(caught))
              }}
            >
              <option value="compact">Compact</option>
              <option value="balanced">Balanced</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>
          <PageTransfer
            disabled={filtering || selected.length === 0}
            collectionId={detail.id}
            pageIds={selected}
            onMoved={(message) => {
              if (message) showNotice(message)
              setUndo(null)
              reload()
            }}
          />
          {detail.plannerView === 'grid' ? (
            <label className="text-xs text-muted">
              Size
              <input
                type="range"
                min={96}
                max={240}
                value={detail.gridSize}
                aria-label="Thumbnail size"
                onChange={(event) => setDetail({ ...detail, gridSize: Number(event.target.value) })}
                onMouseUp={(event) => {
                  void window.api.invoke('collections:rememberPlanner', detail.id, {
                    gridSize: Number(event.currentTarget.value)
                  })
                }}
              />
            </label>
          ) : (
            <label className="text-xs text-muted">
              Zoom
              <input
                type="range"
                min={50}
                max={200}
                value={Math.round(detail.spreadZoom * 100)}
                aria-label="Spread zoom"
                onChange={(event) =>
                  setDetail({ ...detail, spreadZoom: Number(event.target.value) / 100 })
                }
                onMouseUp={(event) => {
                  void window.api.invoke('collections:rememberPlanner', detail.id, {
                    spreadZoom: Number(event.currentTarget.value) / 100
                  })
                }}
              />
            </label>
          )}
        </div>
        <div
          ref={(node) => {
            if (!node) return
            const width = node.clientWidth || 800
            const height = node.clientHeight || 640
            setFrame((current) =>
              current.width === width && current.height === height ? current : { width, height }
            )
          }}
          className="min-h-0 flex-1 overflow-auto p-4"
          onScroll={(event) => {
            setScrollTop(event.currentTarget.scrollTop)
            setFrame({
              width: event.currentTarget.clientWidth,
              height: event.currentTarget.clientHeight
            })
          }}
          onDragOver={(event) => {
            if (!dragIds) return
            const rect = event.currentTarget.getBoundingClientRect()
            if (event.clientY < rect.top + 48) event.currentTarget.scrollTop -= 16
            if (event.clientY > rect.bottom - 48) event.currentTarget.scrollTop += 16
          }}
        >
          {filtering && (
            <p className="mb-3 text-xs text-muted">
              {visible.length} match. Reorder is off while a filter is on.
              {hidden > 0 ? ` ${hidden} selected pages are hidden.` : ''}
            </p>
          )}
          {ghost && (
            <p className="mb-3 text-xs">
              Moving {ghost.count} {ghost.count === 1 ? 'page' : 'pages'}
              {ghost.locked ? ' · Locked pair' : ''}
              {ghost.wide ? ' · Wide' : ''}
            </p>
          )}
          {detail.pages.length === 0 && (
            <p className="text-sm text-muted">This collection has no pages yet.</p>
          )}
          {detail.plannerView === 'grid' ? (
            <div
              className="grid gap-3"
              style={{
                gridTemplateColumns: `repeat(auto-fill, minmax(${detail.gridSize}px, 1fr))`,
                paddingTop: Math.floor(range.start / columns) * (detail.gridSize + 28),
                paddingBottom:
                  Math.ceil((visible.length - range.end) / columns) * (detail.gridSize + 28)
              }}
            >
              {windowed.map((page) => (
                <PageCard
                  key={page.id}
                  page={page}
                  density={detail.gridDensity}
                  selected={selected.includes(page.id)}
                  draggable={!filtering}
                  marked={hover?.overId === page.id ? hover.place : null}
                  onClick={(event) => choose(page.id, event)}
                  onDragStart={() => {
                    const moving = selected.includes(page.id) ? selected : [page.id]
                    setDragIds(moving)
                  }}
                  onDragOver={(event) => {
                    event.preventDefault()
                    const rect = event.currentTarget.getBoundingClientRect()
                    setHover({
                      overId: page.id,
                      place: event.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
                    })
                  }}
                  onDrop={() => dropOn(page.id, hover?.overId === page.id ? hover.place : 'before')}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4" style={{ zoom: detail.spreadZoom }}>
              {spreads.map((spread) => {
                const slots = spreadSides(spread, detail.direction, detail.firstPageSide)
                const left = slots.find((slot) => slot.side === 'left')
                const right = slots.find((slot) => slot.side === 'right')
                return (
                  <div key={spread.pageIds.join('-')} className="flex justify-center gap-2">
                    <SpreadSlot
                      page={left ? detail.pages.find((page) => page.id === left.id) : undefined}
                      wide={spread.wide}
                      locked={spread.locked}
                      selected={left ? selected.includes(left.id) : false}
                      onClick={
                        left
                          ? (event) => {
                              const mode = event.shiftKey
                                ? 'range'
                                : event.metaKey || event.ctrlKey
                                  ? 'toggle'
                                  : 'replace'
                              const next = selectPageIds(ids, selected, focusId, left.id, mode)
                              setSelected(next.selected)
                              setFocusId(next.focusId)
                            }
                          : undefined
                      }
                    />
                    {!spread.wide && (
                      <SpreadSlot
                        page={right ? detail.pages.find((page) => page.id === right.id) : undefined}
                        wide={false}
                        locked={spread.locked}
                        selected={right ? selected.includes(right.id) : false}
                        onClick={
                          right
                            ? (event) => {
                                const mode = event.shiftKey
                                  ? 'range'
                                  : event.metaKey || event.ctrlKey
                                    ? 'toggle'
                                    : 'replace'
                                const next = selectPageIds(ids, selected, focusId, right.id, mode)
                                setSelected(next.selected)
                                setFocusId(next.focusId)
                              }
                            : undefined
                        }
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {focus && (
        <InspectorPane key={detail.id} collectionId={detail.id}>
          <PageInspector
            key={`${focus.id}:${focus.revision}`}
            detail={detail}
            page={focus}
            selectedCount={selected.length}
            onChanged={() => setReloadToken((token) => token + 1)}
          />
        </InspectorPane>
      )}
      {showBulk && (
        <BulkEditDialog
          pages={detail.pages}
          selected={selected}
          hidden={hidden}
          onClose={() => setShowBulk(false)}
          onApplied={(entries) => {
            setUndo({ kind: 'bulk', entries })
            setShowBulk(false)
            reload()
          }}
        />
      )}
      {showExport && (
        <ExportDialog
          collectionId={detail.id}
          pages={detail.pages}
          onClose={() => setShowExport(false)}
        />
      )}
      {showImport && (
        <ImportPagesDialog
          collectionId={detail.id}
          beforeId={focusId}
          pages={detail.pages}
          onClose={() => setShowImport(false)}
          onImported={(record) => {
            setUndo({ kind: 'import', record })
            setShowImport(false)
            reload()
          }}
        />
      )}
    </div>
  )
}

function shownIds(detail: CollectionDetail, query: string, matchIds: string[] | null): string[] {
  if (!collectionQueryActive(query)) return detail.pages.map((page) => page.id)
  const allowed = new Set(matchIds ?? [])
  return detail.pages.filter((page) => allowed.has(page.id)).map((page) => page.id)
}

const INSPECTOR_KEY = 'cw.plannerInspector'

function storedInspector(collectionId: string): unknown {
  try {
    const raw = localStorage.getItem(INSPECTOR_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : null
    if (!parsed || typeof parsed !== 'object') return null
    return (parsed as Record<string, unknown>)[collectionId] ?? null
  } catch {
    return null
  }
}

function InspectorPane({ collectionId, children }: { collectionId: string; children: ReactNode }) {
  const [layout, setLayout] = useState(() => inspectorLayout(storedInspector(collectionId)))
  const save = (next: { collapsed: boolean; width: number }) => {
    const clamped = inspectorLayout(next)
    setLayout(clamped)
    try {
      const raw = localStorage.getItem(INSPECTOR_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : {}
      const all = parsed && typeof parsed === 'object' ? { ...(parsed as object) } : {}
      localStorage.setItem(INSPECTOR_KEY, JSON.stringify({ ...all, [collectionId]: clamped }))
    } catch {
      // The inspector still works for this visit if storage is unavailable.
    }
  }
  if (layout.collapsed) {
    return (
      <button
        type="button"
        className="w-8 shrink-0 border-l border-line text-xs"
        onClick={() => save({ ...layout, collapsed: false })}
      >
        Properties
      </button>
    )
  }
  return (
    <div className="flex shrink-0 flex-col" style={{ width: layout.width }}>
      <div className="flex items-center gap-2 border-b border-l border-line px-2 py-1">
        <button
          type="button"
          className="text-xs text-muted"
          onClick={() => save({ ...layout, collapsed: true })}
        >
          Hide
        </button>
        <input
          type="range"
          min={220}
          max={480}
          value={layout.width}
          aria-label="Inspector width"
          onChange={(event) => save({ ...layout, width: Number(event.target.value) })}
        />
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}

function PageCard({
  page,
  density,
  selected,
  draggable,
  marked,
  onClick,
  onDragStart,
  onDragOver,
  onDrop
}: {
  page: CollectionPageView
  density: 'compact' | 'balanced' | 'detailed'
  selected: boolean
  draggable: boolean
  marked: 'before' | 'after' | null
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  onDragStart: () => void
  onDragOver: (event: DragEvent<HTMLButtonElement>) => void
  onDrop: () => void
}) {
  const projectId = useProjectStore((s) => s.project?.id ?? null)
  const marker =
    page.artwork === 'missing'
      ? 'Missing'
      : page.artwork === 'unsupported'
        ? 'Unsupported'
        : page.span === 2
          ? 'Wide'
          : page.spreadId
            ? 'Locked'
            : page.artwork === 'blank'
              ? 'Blank'
              : 'Artwork'
  return (
    <button
      type="button"
      draggable={draggable}
      aria-pressed={selected}
      onClick={onClick}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', page.id)
        onDragStart()
      }}
      onDragOver={onDragOver}
      onDrop={(event) => {
        event.preventDefault()
        onDrop()
      }}
      className={`flex aspect-[3/4] flex-col rounded-lg border p-2 text-left ${
        selected ? 'border-accent bg-accent/10' : 'border-line bg-surface'
      } ${marked === 'before' ? 'border-t-4 border-t-accent' : ''} ${
        marked === 'after' ? 'border-b-4 border-b-accent' : ''
      }`}
    >
      {projectId && page.sha256 && (
        <img
          src={assetUrl(projectId, page.sha256, 256)}
          alt=""
          loading="lazy"
          className="mb-1 max-h-24 w-full object-contain"
        />
      )}
      <span className="text-xs text-muted">{caption(page)}</span>
      {density !== 'compact' && (
        <span className="mt-1 line-clamp-3 text-sm">{page.title || 'Untitled'}</span>
      )}
      {density === 'detailed' && (
        <span className="text-xs text-muted">
          {page.overallStatus.replaceAll('_', ' ')}
          {page.displayedName ? ` · ${page.displayedName}` : ''}
        </span>
      )}
      <span className="mt-auto text-xs text-muted">{marker}</span>
    </button>
  )
}

function PageTransfer({
  disabled,
  collectionId,
  pageIds,
  onMoved
}: {
  disabled: boolean
  collectionId: string
  pageIds: string[]
  onMoved: (message: string | null) => void
}) {
  const [targets, setTargets] = useState<{ id: string; title: string }[]>([])
  const [target, setTarget] = useState('')
  useEffect(() => {
    let cancel = false
    void window.api.invoke('collections:outline').then((outline) => {
      if (cancel) return
      const next = outline.collections
        .filter((item) => item.id !== collectionId)
        .map((item) => ({ id: item.id, title: item.title }))
      setTargets(next)
      setTarget((current) => current || next[0]?.id || '')
    })
    return () => {
      cancel = true
    }
  }, [collectionId])
  const move = async (copy: boolean) => {
    if (!target) return
    try {
      if (copy) {
        await window.api.invoke('collections:copyPages', pageIds, target, null)
        onMoved('Copied the pages. The originals stayed here.')
      } else {
        const moved = await window.api.invoke('collections:movePages', pageIds, target, null)
        const names = moved.unmapped.map((stage) => stage.stageName).filter(Boolean)
        onMoved(names.length > 0 ? `Moved. Unmatched stages: ${names.join(', ')}` : null)
      }
    } catch (caught) {
      reportError(caught)
    }
  }
  return (
    <>
      <select
        aria-label="Other collection"
        disabled={disabled || targets.length === 0}
        value={target}
        onChange={(event) => setTarget(event.target.value)}
        className="rounded border border-line bg-canvas px-1 py-1 text-xs"
      >
        {targets.length === 0 && <option value="">No other collection</option>}
        {targets.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <button
        type="button"
        className={button}
        disabled={disabled || !target}
        onClick={() => void move(false)}
      >
        Move
      </button>
      <button
        type="button"
        className={button}
        disabled={disabled || !target}
        onClick={() => void move(true)}
      >
        Copy
      </button>
      <button
        type="button"
        className={button}
        disabled={pageIds.length === 0}
        onClick={() => {
          const boardId = useWorkspaceStore.getState().board?.id
          const pageId = pageIds[0]
          if (!boardId || !pageId) return
          void window.api
            .invoke('collections:placePageLink', boardId, collectionId, pageId)
            .then(() =>
              showNotice('Added a page link on this board. The page stayed in the collection.')
            )
            .catch((caught) => reportError(caught))
        }}
      >
        Link on canvas
      </button>
    </>
  )
}

function SpreadSlot({
  page,
  wide,
  locked,
  selected,
  onClick
}: {
  page?: CollectionPageView
  wide: boolean
  locked: boolean
  selected: boolean
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  if (!page) return <div className="h-52 w-40" />
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`flex h-52 flex-col rounded-lg border p-3 text-left ${wide ? 'w-80' : 'w-40'} ${
        selected ? 'border-accent bg-accent/10' : 'border-line bg-surface'
      }`}
    >
      <span className="text-xs text-muted">{caption(page)}</span>
      <span className="mt-2 text-sm">{page.title || 'Untitled'}</span>
      <span className="mt-auto text-xs text-muted">
        {wide ? 'Wide' : locked ? 'Locked spread' : 'Page'}
      </span>
    </button>
  )
}
