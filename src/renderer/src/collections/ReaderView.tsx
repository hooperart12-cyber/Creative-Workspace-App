import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { assetUrl } from '@shared/assets'
import { collectionCounts, layoutSpreads, spreadSides } from '@shared/collections'
import {
  bindingConflict,
  clickZone,
  cropInset,
  parseReaderPrefs,
  READER_PRESETS,
  readerStep,
  resumePageId,
  writesResume,
  zoomAt,
  type ReaderCommand,
  type ReaderDocument,
  type ReaderLayout,
  type ReaderPageView,
  type ReaderPrefs
} from '@shared/reader'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { ContentsList } from './ContentsList'

const PREFS_KEY = 'cw.readerPrefs'

function readPrefs(): ReaderPrefs {
  try {
    return parseReaderPrefs(localStorage.getItem(PREFS_KEY))
  } catch {
    return parseReaderPrefs(null)
  }
}

function savePrefs(prefs: ReaderPrefs): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify(prefs))
}

export function ReaderView() {
  const collectionId = useWorkspaceStore((s) => s.readerCollectionId)
  const requestedId = useWorkspaceStore((s) => s.readerFocusId)
  const projectId = useProjectStore((s) => s.project?.id)
  const openPlanner = useWorkspaceStore((s) => s.openPlanner)
  const openReview = useWorkspaceStore((s) => s.openReview)
  const openReader = useWorkspaceStore((s) => s.openReader)
  const [doc, setDoc] = useState<ReaderDocument | null>(null)
  const [pageId, setPageId] = useState<string | null>(null)
  const [layout, setLayout] = useState<ReaderLayout>('single')
  const [camera, setCamera] = useState({ zoom: 1, x: 0, y: 0 })
  const cameraRef = useRef(camera)
  const [keyNote, setKeyNote] = useState<string | null>(null)
  const [ended, setEnded] = useState(false)
  const [overview, setOverview] = useState(false)
  const [contents, setContents] = useState(false)
  const [comments, setComments] = useState<{ id: string; body: string }[] | null>(null)
  const [prefs, setPrefs] = useState(readPrefs)
  const [error, setError] = useState<string | null>(null)
  const stage = useRef<HTMLDivElement>(null)
  const dragging = useRef<{ x: number; y: number; originX: number; originY: number } | null>(null)

  useEffect(() => {
    if (!collectionId) return
    let cancel = false
    void window.api
      .invoke('collections:reader', collectionId)
      .then((next) => {
        if (cancel) return
        setDoc(next)
        setError(null)
        const explicit = requestedId && next.pages.some((page) => page.id === requestedId)
        const id = explicit ? requestedId : resumePageId(next.resume.pageId, next.pages)
        setPageId(id)
        setLayout(next.resume.layout)
        const savedCamera = { zoom: next.resume.zoom, x: next.resume.x, y: next.resume.y }
        cameraRef.current = savedCamera
        setCamera(savedCamera)
        setEnded(false)
        if (explicit && id && writesResume('interact')) {
          void window.api.invoke('collections:touchReader', next.id, {
            pageId: id,
            layout: next.resume.layout,
            zoom: next.resume.zoom,
            x: next.resume.x,
            y: next.resume.y
          })
        }
      })
      .catch((caught) => {
        if (!cancel) setError(caught instanceof Error ? caught.message : String(caught))
      })
    return () => {
      cancel = true
    }
  }, [collectionId, requestedId])

  const remember = (next: {
    pageId: string
    layout: ReaderLayout
    zoom: number
    x: number
    y: number
  }) => {
    if (!collectionId || !writesResume('interact')) return
    void window.api.invoke('collections:touchReader', collectionId, next).catch(() => {})
  }

  const go = (way: 'next' | 'previous') => {
    if (!doc || !pageId) return
    const step = readerStep(doc.pages, pageId, layout, way)
    if (step.ended) {
      setEnded(true)
      return
    }
    setEnded(false)
    setPageId(step.pageId)
    remember({ pageId: step.pageId, layout, zoom: camera.zoom, x: camera.x, y: camera.y })
  }

  const setView = (nextLayout: ReaderLayout, nextCamera = camera, nextPage = pageId) => {
    setLayout(nextLayout)
    setCamera(nextCamera)
    cameraRef.current = nextCamera
    if (nextPage) {
      setPageId(nextPage)
      remember({ pageId: nextPage, layout: nextLayout, ...nextCamera })
    }
  }

  const changeLook = (patch: Partial<ReaderPrefs['appearance']>) => {
    const appearance = { ...prefs.appearance, ...patch }
    const margin = Number.isFinite(appearance.margin) ? appearance.margin : prefs.appearance.margin
    const gutter = Number.isFinite(appearance.gutter) ? appearance.gutter : prefs.appearance.gutter
    appearance.margin = Math.min(80, Math.max(0, margin))
    appearance.gutter = Math.min(80, Math.max(0, gutter))
    const next = { ...prefs, appearance }
    setPrefs(next)
    savePrefs(next)
  }

  const assignKey = (command: ReaderCommand, key: string) => {
    if (key === 'Escape' || key === 'Tab') return
    const bindings = { ...prefs.bindings, [command]: key }
    const conflict = bindingConflict(bindings)
    if (conflict) {
      setKeyNote(conflict)
      return
    }
    setKeyNote(null)
    const next = { ...prefs, bindings }
    setPrefs(next)
    savePrefs(next)
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.dataset.readerKey)
      ) {
        return
      }
      const root = document.getElementById('page-reader')
      if (!root) return
      const key = event.key
      const command = (Object.keys(prefs.bindings) as (keyof typeof prefs.bindings)[]).find(
        (name) => prefs.bindings[name] === key
      )
      if (!command) return
      event.preventDefault()
      if (command === 'next') go('next')
      if (command === 'previous') go('previous')
      if (command === 'zoomIn') {
        const next = zoomAt(camera, 1.1, 0, 0, 0, 0)
        setView(layout, next)
      }
      if (command === 'zoomOut') setView(layout, zoomAt(camera, 0.9, 0, 0, 0, 0))
      if (command === 'fit') setView(layout, { zoom: 1, x: 0, y: 0 })
      if (command === 'planner' && collectionId && pageId) openPlanner(collectionId, pageId)
      if (command === 'review' && collectionId && pageId) openReview(collectionId, pageId)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!collectionId) return null
  if (error) return <p className="p-6 text-sm">{error}</p>
  if (!doc || !pageId) return <p className="p-6 text-sm text-muted">Opening reader…</p>
  const page = doc.pages.find((item) => item.id === pageId) ?? doc.pages[0]
  if (!page) return <p className="p-6 text-sm text-muted">This collection has no pages.</p>
  const spread = layoutSpreads(doc.pages).find((item) => item.pageIds.includes(page.id))
  const slots = spread ? spreadSides(spread, doc.direction, doc.firstPageSide) : []
  const counts = collectionCounts(
    doc.pages.map((item) => ({ span: item.span, hasArtwork: item.artwork === 'ready' }))
  )
  const look = prefs.appearance

  return (
    <div
      id="page-reader"
      className="flex min-h-0 flex-1 flex-col"
      style={{ background: look.background }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2 text-xs text-white">
        <button type="button" className={chip} onClick={() => openPlanner(doc.id, page.id)}>
          Planner
        </button>
        <button type="button" className={chip} onClick={() => openReview(doc.id, page.id)}>
          Review
        </button>
        <span className="min-w-0 flex-1 truncate">{doc.title}</span>
        {(['single', 'spread', 'continuous'] as const).map((item) => (
          <button
            key={item}
            type="button"
            className={chip}
            aria-pressed={layout === item}
            onClick={() => setView(item)}
          >
            {item === 'single' ? 'Single' : item === 'spread' ? 'Spread' : 'Continuous'}
          </button>
        ))}
        <button type="button" className={chip} onClick={() => setContents((open) => !open)}>
          Contents
        </button>
        <button type="button" className={chip} onClick={() => stage.current?.requestFullscreen?.()}>
          Full screen
        </button>
        <select
          aria-label="Reader keys"
          className="rounded bg-white/10 px-1 py-1"
          defaultValue=""
          onChange={(event) => {
            const preset = READER_PRESETS[event.target.value as keyof typeof READER_PRESETS]
            if (!preset) return
            const next = { ...prefs, bindings: preset.bindings }
            setPrefs(next)
            savePrefs(next)
            setView(preset.layout)
          }}
        >
          <option value="" disabled>
            Keys
          </option>
          <option value="western">Western</option>
          <option value="manga">Manga</option>
          <option value="keyboard">Keyboard</option>
          <option value="continuous">Continuous</option>
        </select>
        <details>
          <summary className="cursor-pointer">Appearance</summary>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <label>
              Background
              <input
                aria-label="Reader background"
                type="color"
                value={look.background}
                onChange={(event) => changeLook({ background: event.target.value })}
              />
            </label>
            <label>
              Margin
              <input
                aria-label="Reader margin"
                type="number"
                min={0}
                max={80}
                value={look.margin}
                className="w-14 bg-transparent"
                onChange={(event) => changeLook({ margin: Number(event.target.value) })}
              />
            </label>
            <label>
              Gutter
              <input
                aria-label="Reader gutter"
                type="number"
                min={0}
                max={80}
                value={look.gutter}
                className="w-14 bg-transparent"
                onChange={(event) => changeLook({ gutter: Number(event.target.value) })}
              />
            </label>
            <label>
              Fit
              <select
                aria-label="Reader fit"
                value={look.fit}
                className="bg-transparent"
                onChange={(event) =>
                  changeLook({ fit: event.target.value as ReaderPrefs['appearance']['fit'] })
                }
              >
                <option value="contain">Contain</option>
                <option value="width">Width</option>
                <option value="height">Height</option>
              </select>
            </label>
            <label>
              <input
                type="checkbox"
                checked={look.border}
                onChange={(event) => changeLook({ border: event.target.checked })}
              />{' '}
              Border
            </label>
            <label>
              <input
                type="checkbox"
                checked={look.allowEnlarge}
                onChange={(event) => changeLook({ allowEnlarge: event.target.checked })}
              />{' '}
              Enlarge
            </label>
            <label>
              <input
                type="checkbox"
                checked={look.smooth}
                onChange={(event) => changeLook({ smooth: event.target.checked })}
              />{' '}
              Smooth
            </label>
          </div>
        </details>
        <details>
          <summary className="cursor-pointer">Remap</summary>
          <div className="mt-1 flex flex-wrap gap-1">
            {(Object.keys(prefs.bindings) as ReaderCommand[]).map((command) => (
              <button
                key={command}
                type="button"
                data-reader-key={command}
                className={chip}
                onKeyDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  assignKey(command, event.key)
                }}
              >
                {command} {prefs.bindings[command]}
              </button>
            ))}
            {keyNote && <span>{keyNote}</span>}
          </div>
        </details>
      </header>
      <div className="flex min-h-0 flex-1">
        {contents && (
          <ContentsList
            collectionId={doc.id}
            pageId={page.id}
            onOpen={(id) => {
              setEnded(false)
              setPageId(id)
              remember({ pageId: id, layout, zoom: camera.zoom, x: camera.x, y: camera.y })
            }}
          />
        )}
        <div
          ref={stage}
          className="relative min-w-0 flex-1 overflow-hidden"
          style={{ padding: look.margin, color: '#f5f5f5' }}
          onMouseDown={(event) => {
            if (camera.zoom <= 1.01) return
            dragging.current = {
              x: event.clientX,
              y: event.clientY,
              originX: camera.x,
              originY: camera.y
            }
          }}
          onMouseMove={(event) => {
            const drag = dragging.current
            if (!drag) return
            const next = {
              zoom: cameraRef.current.zoom,
              x: drag.originX + event.clientX - drag.x,
              y: drag.originY + event.clientY - drag.y
            }
            cameraRef.current = next
            setCamera(next)
          }}
          onMouseUp={() => {
            if (!dragging.current) return
            dragging.current = null
            const current = cameraRef.current
            remember({ pageId: page.id, layout, zoom: current.zoom, x: current.x, y: current.y })
          }}
          onClick={(event) => {
            if (camera.zoom > 1.01) return
            const rect = event.currentTarget.getBoundingClientRect()
            const zone = clickZone(event.clientX - rect.left, rect.width, camera.zoom)
            if (zone) go(zone === 'next' ? 'next' : 'previous')
          }}
          onWheel={(event) => {
            if (!(event.ctrlKey || event.metaKey)) return
            event.preventDefault()
            const rect = event.currentTarget.getBoundingClientRect()
            const next = zoomAt(
              camera,
              event.deltaY < 0 ? 1.1 : 0.9,
              event.clientX - rect.left,
              event.clientY - rect.top,
              rect.width / 2,
              rect.height / 2
            )
            setView(layout, next)
          }}
        >
          {ended ? (
            <EndCard
              nextTitle={doc.nextTitle}
              onRestart={() => {
                const first = doc.pages[0]
                if (!first) return
                setEnded(false)
                setOverview(false)
                setPageId(first.id)
                remember({ pageId: first.id, layout, zoom: 1, x: 0, y: 0 })
                setCamera({ zoom: 1, x: 0, y: 0 })
              }}
              onOverview={() => setOverview((open) => !open)}
              onPlanner={() => openPlanner(doc.id, page.id)}
              onNext={
                doc.nextCollectionId ? () => openReader(doc.nextCollectionId as string, null) : null
              }
            />
          ) : layout === 'continuous' ? (
            <div className="mx-auto flex max-w-3xl flex-col" style={{ gap: look.gutter }}>
              {doc.pages.map((item) => (
                <PageFrame
                  key={item.id}
                  page={item}
                  projectId={projectId}
                  look={look}
                  camera={item.id === page.id ? camera : { zoom: 1, x: 0, y: 0 }}
                />
              ))}
            </div>
          ) : (
            <div
              className="flex h-full items-center justify-center"
              style={{
                gap: look.gutter,
                transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`
              }}
            >
              {(layout === 'spread' ? slots : [{ id: page.id, side: 'left' as const }]).map(
                (slot) => {
                  const shown = doc.pages.find((item) => item.id === slot.id)
                  if (!shown) return <div key={slot.side} className="h-[70vh] w-[40%]" />
                  return (
                    <PageFrame
                      key={shown.id}
                      page={shown}
                      projectId={projectId}
                      look={look}
                      camera={{ zoom: 1, x: 0, y: 0 }}
                    />
                  )
                }
              )}
            </div>
          )}
          {overview && (
            <p className="absolute bottom-4 left-4 rounded bg-black/60 px-3 py-2 text-xs">
              {counts.entries} entries · {counts.withArtwork} with artwork · {counts.placeholders}{' '}
              blank · {counts.readingPositions} reading positions
            </p>
          )}
        </div>
      </div>
      <footer className="flex items-center gap-2 border-t border-white/10 px-3 py-2 text-xs text-white">
        <button type="button" className={chip} onClick={() => go('previous')}>
          Previous
        </button>
        <span className="flex-1 truncate text-center">{caption(page)}</span>
        <button
          type="button"
          className={chip}
          onClick={() => {
            if (comments) {
              setComments(null)
              return
            }
            void window.api.invoke('collections:comments', page.id).then(setComments)
          }}
        >
          Comments
        </button>
        <button type="button" className={chip} onClick={() => go('next')}>
          Next
        </button>
      </footer>
      {comments && (
        <ul className="max-h-24 overflow-auto px-3 py-2 text-xs text-white">
          {comments.length === 0 && <li>No comments</li>}
          {comments.map((comment) => (
            <li key={comment.id}>{comment.body}</li>
          ))}
        </ul>
      )}
      <div className="flex gap-1 overflow-auto px-3 py-2">
        {doc.pages.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`shrink-0 rounded px-2 py-1 text-xs ${item.id === page.id ? 'bg-white text-black' : 'text-white'}`}
            onClick={() => {
              setEnded(false)
              setPageId(item.id)
              remember({ pageId: item.id, layout, zoom: camera.zoom, x: camera.x, y: camera.y })
            }}
          >
            {caption(item)}
          </button>
        ))}
      </div>
    </div>
  )
}

function caption(page: ReaderPageView): string {
  if (page.label) return page.label
  if (page.number != null) return String(page.number)
  return page.role ?? 'Page'
}

function PageFrame({
  page,
  projectId,
  look,
  camera
}: {
  page: ReaderPageView
  projectId: string | undefined
  look: ReaderPrefs['appearance']
  camera: { zoom: number; x: number; y: number }
}) {
  const clip = cropInset(page.crop, page.width, page.height)
  const fitStyle: CSSProperties =
    look.fit === 'width'
      ? { width: '100%', height: 'auto' }
      : look.fit === 'height'
        ? { width: 'auto', height: '100%' }
        : {
            maxWidth: look.allowEnlarge ? 'none' : '100%',
            maxHeight: '100%',
            width: 'auto',
            height: 'auto'
          }
  if (!projectId || !page.sha256 || page.artwork !== 'ready') {
    return (
      <div className="flex h-[70vh] w-[40%] items-center justify-center rounded border border-white/20 text-sm">
        {page.artwork === 'blank'
          ? 'Blank page'
          : page.artwork === 'missing'
            ? 'Missing artwork'
            : 'Unsupported artwork'}
      </div>
    )
  }
  return (
    <img
      alt={caption(page)}
      src={assetUrl(projectId, page.sha256, 'original')}
      draggable={false}
      style={{
        ...fitStyle,
        objectFit: 'contain',
        transform:
          camera.zoom === 1
            ? undefined
            : `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
        clipPath: clip ?? undefined,
        border: look.border ? '1px solid rgba(255,255,255,0.4)' : undefined,
        imageRendering: look.smooth ? 'auto' : 'pixelated'
      }}
    />
  )
}

function EndCard({
  nextTitle,
  onRestart,
  onOverview,
  onPlanner,
  onNext
}: {
  nextTitle: string | null
  onRestart: () => void
  onOverview: () => void
  onPlanner: () => void
  onNext: (() => void) | null
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm">
      <p>End of this collection</p>
      <button type="button" className={chip} onClick={onRestart}>
        Restart
      </button>
      <button type="button" className={chip} onClick={onOverview}>
        Overview
      </button>
      <button type="button" className={chip} onClick={onPlanner}>
        Planner
      </button>
      {onNext && (
        <button type="button" className={chip} onClick={onNext}>
          Next chapter{nextTitle ? `: ${nextTitle}` : ''}
        </button>
      )}
    </div>
  )
}

const chip = 'rounded border border-white/30 px-2 py-1 hover:bg-white/10'
