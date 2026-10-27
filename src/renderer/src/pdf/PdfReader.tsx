import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react'
import {
  AnnotationMode,
  TextLayer,
  type PDFDocumentProxy,
  type PageViewport,
  type RenderTask
} from 'pdfjs-dist'
import { isSafeLink } from '@shared/notes'
import type { CanvasObject } from '@shared/types'
import { saveOriginal } from '../canvas/actions'
import { reportError } from '../store/projectStore'
import { saveCoverFromDocument } from './pdfCover'
import { openPdf } from './pdfjs'

type Mode = 'continuous' | 'single' | 'spread'
type Direction = 'ltr' | 'rtl'
type ZoomMode = 'fit-page' | 'fit-width' | 'custom'

interface Hit {
  page: number
}
interface OutlineNode {
  title: string
  dest: string | unknown[] | null
  items: OutlineNode[]
}
interface PageBox {
  width: number
  height: number
}

const GAP = 16

/**
 * Read-only PDF reader. Page, zoom and scroll belong to this window only.
 * A password stays in memory for this window and is never written down.
 */
export function PdfReader({ objectId, onClose }: { objectId: string; onClose: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [object, setObject] = useState<CanvasObject | null>(null)
  const [missing, setMissing] = useState(false)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [needsPassword, setNeedsPassword] = useState(false)
  const [passwordError, setPasswordError] = useState(false)
  const [password, setPassword] = useState('')
  const [attempt, setAttempt] = useState<{ password?: string; n: number }>({ n: 0 })
  const [pages, setPages] = useState<PageBox[]>([])
  const [outline, setOutline] = useState<OutlineNode[]>([])
  const [page, setPage] = useState(1)
  const [pageDraft, setPageDraft] = useState('1')
  const [mode, setMode] = useState<Mode>('continuous')
  const [direction, setDirection] = useState<Direction>('ltr')
  const [zoomMode, setZoomMode] = useState<ZoomMode>('fit-width')
  const [customScale, setCustomScale] = useState(1)
  const [sidebar, setSidebar] = useState<'pages' | 'outline' | null>('pages')
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [hitIndex, setHitIndex] = useState(0)
  const [searchNote, setSearchNote] = useState('')
  const coveredId = useRef<string | null>(null)

  useEffect(() => {
    rootRef.current?.focus()
  }, [])

  useEffect(() => {
    let dead = false
    const load = () =>
      window.api
        .invoke('objects:read', objectId)
        .then((fresh) => {
          if (dead) return
          setObject(fresh)
          setMissing(!fresh?.asset)
        })
        .catch(() => {
          if (!dead) setMissing(true)
        })
    void load()
    const stop = window.api.on('project:contentChanged', () => void load())
    return () => {
      dead = true
      stop()
    }
  }, [objectId])

  const assetId = object?.asset?.id
  const bytes = object?.asset?.bytes ?? 0
  useEffect(() => {
    if (!assetId || bytes <= 0) return
    let dead = false
    const task = openPdf(assetId, bytes, attempt.password)
    const fail = (error: unknown) => {
      if (dead) return
      if (isPassword(error)) {
        setNeedsPassword(true)
        setPasswordError(attempt.n > 0)
        return
      }
      setLoadError(
        error instanceof Error
          ? `This PDF couldn’t be opened. ${error.message}`
          : 'This PDF couldn’t be opened. The file may be damaged.'
      )
    }
    void task.promise.then(async (pdf) => {
      try {
        if (dead) return
        const boxes: PageBox[] = []
        for (let n = 1; n <= pdf.numPages; n++) {
          const view = (await pdf.getPage(n)).getViewport({ scale: 1 })
          boxes.push({ width: view.width, height: view.height })
        }
        const tree = ((await pdf.getOutline()) ?? []) as OutlineNode[]
        if (dead) return
        setPages(boxes)
        setOutline(tree)
        setDoc(pdf)
        setNeedsPassword(false)
        setPasswordError(false)
      } catch (error) {
        fail(error)
      }
    }, fail)
    return () => {
      dead = true
      void task.destroy()
    }
  }, [assetId, bytes, attempt])

  useEffect(() => {
    const asset = object?.asset
    if (!doc || !asset || coveredId.current === asset.id) return
    let dead = false
    void (async () => {
      try {
        if (!asset.width) {
          const view = (await doc.getPage(1)).getViewport({ scale: 1 })
          if (dead) return
          await window.api.invoke('assets:recordPdfInfo', asset.id, {
            pageCount: doc.numPages,
            width: view.width,
            height: view.height
          })
        }
        if (dead) return
        await saveCoverFromDocument(doc, asset.id)
        coveredId.current = asset.id
      } catch {
        // The card keeps its placeholder.
      }
    })()
    return () => {
      dead = true
    }
  }, [doc, object?.asset])

  const frameRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [frame, setFrame] = useState({ width: 800, height: 600 })
  const [scrollTop, setScrollTop] = useState(0)
  const ignoreScroll = useRef(false)

  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const measure = () => setFrame({ width: el.clientWidth, height: el.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [doc, needsPassword])

  const spreadPages = mode === 'spread' ? spreadOf(page, pages.length) : [page]
  const shown = mode === 'single' ? [page] : spreadPages
  const basis = shown.map((n) => pages[n - 1]).filter((box): box is PageBox => !!box)
  const basisWidth =
    mode === 'spread'
      ? basis.reduce((sum, box) => sum + box.width, 0) + GAP * Math.max(0, basis.length - 1)
      : (basis[0]?.width ?? 1)
  const basisHeight = Math.max(1, ...basis.map((box) => box.height))
  const scale = computeScale(zoomMode, customScale, frame, basisWidth, basisHeight)
  const layouts = pages.map((box) => ({ width: box.width * scale, height: box.height * scale }))
  const offsets = layouts.map(
    (_, index) => GAP + layouts.slice(0, index).reduce((sum, box) => sum + box.height + GAP, 0)
  )
  const contentHeight = layouts.reduce((sum, box) => sum + box.height + GAP, GAP)

  const reveal = (next: number) => {
    const target = Math.min(pages.length || 1, Math.max(1, next))
    setPage(target)
    setPageDraft(String(target))
    if (mode !== 'continuous') return
    const el = scrollerRef.current
    if (!el) return
    ignoreScroll.current = true
    el.scrollTop = offsets[target - 1] ?? 0
    setScrollTop(el.scrollTop)
    requestAnimationFrame(() => {
      ignoreScroll.current = false
    })
  }

  const step = (delta: number) => {
    if (mode === 'spread') reveal(delta < 0 ? prevSpread(page) : nextSpread(page, pages.length))
    else reveal(page + delta)
  }

  const jumpToDest = async (dest: unknown) => {
    if (!doc) return
    const found = await pageOfDest(doc, dest)
    if (found) reveal(found)
  }

  const runSearch = async () => {
    if (!doc) return
    const needle = query.trim()
    if (!needle) {
      setHits(null)
      setSearchNote('')
      return
    }
    setSearchNote('Searching…')
    const found: Hit[] = []
    let anyText = false
    const lower = needle.toLowerCase()
    for (let n = 1; n <= doc.numPages; n++) {
      const text = await doc.getPage(n).then((p) => p.getTextContent())
      for (const item of text.items) {
        if (!('str' in item) || !item.str) continue
        if (item.str.trim()) anyText = true
        const hay = item.str.toLowerCase()
        let from = 0
        while (from <= hay.length) {
          const at = hay.indexOf(lower, from)
          if (at < 0) break
          found.push({ page: n })
          from = at + lower.length
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    setHits(found)
    setHitIndex(0)
    if (!anyText) setSearchNote('No searchable text')
    else if (found.length === 0) setSearchNote('No matches')
    else {
      setSearchNote('')
      reveal(found[0].page)
    }
  }

  const goToHit = (index: number) => {
    if (!hits?.length) return
    const next = (index + hits.length) % hits.length
    setHitIndex(next)
    reveal(hits[next].page)
  }

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const typing = (e.target as HTMLElement).closest('input, select, textarea')
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (typing) {
        ;(e.target as HTMLElement).blur()
        return
      }
      onClose()
      return
    }
    if (typing) return
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault()
      step(-1)
    } else if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault()
      step(1)
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setZoomMode('custom')
      setCustomScale((s) => clamp(zoomMode === 'custom' ? s * 1.1 : scale * 1.1, 0.25, 6))
    } else if (e.key === '-') {
      e.preventDefault()
      setZoomMode('custom')
      setCustomScale((s) => clamp(zoomMode === 'custom' ? s / 1.1 : scale / 1.1, 0.25, 6))
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      rootRef.current?.querySelector<HTMLInputElement>('input[type="search"]')?.focus()
    }
  }

  const currentHit = hits?.[hitIndex]
  const percent = `${Math.round(scale * 100)}%`

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="PDF reader"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="absolute inset-0 z-30 flex flex-col bg-canvas outline-none"
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-line bg-surface px-3 py-2">
        <button type="button" className={toolClass} onClick={onClose}>
          Close
        </button>
        <span className="max-w-48 truncate text-sm font-medium">
          {object?.asset?.originalName ?? 'PDF'}
        </span>
        <span className="mx-1 h-5 w-px bg-line" />
        <button
          type="button"
          className={toolClass}
          aria-label="Previous page"
          onClick={() => step(-1)}
        >
          Prev
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(pageDraft)
            if (Number.isFinite(n)) reveal(n)
          }}
        >
          <input
            aria-label="Page"
            value={pageDraft}
            onChange={(e) => setPageDraft(e.target.value)}
            className="w-14 rounded border border-line px-2 py-1 text-center text-sm"
          />
        </form>
        <span className="text-sm text-muted">of {pages.length || '…'}</span>
        <button type="button" className={toolClass} aria-label="Next page" onClick={() => step(1)}>
          Next
        </button>
        <span className="mx-1 h-5 w-px bg-line" />
        <button
          type="button"
          className={toolClass}
          aria-label="Zoom out"
          onClick={() => {
            setZoomMode('custom')
            setCustomScale(clamp((zoomMode === 'custom' ? customScale : scale) / 1.1, 0.25, 6))
          }}
        >
          −
        </button>
        <span aria-label="Zoom level" className="w-12 text-center text-sm">
          {percent}
        </span>
        <button
          type="button"
          className={toolClass}
          aria-label="Zoom in"
          onClick={() => {
            setZoomMode('custom')
            setCustomScale(clamp((zoomMode === 'custom' ? customScale : scale) * 1.1, 0.25, 6))
          }}
        >
          +
        </button>
        <button
          type="button"
          className={toolClass}
          aria-pressed={zoomMode === 'fit-page'}
          onClick={() => setZoomMode('fit-page')}
        >
          Fit page
        </button>
        <button
          type="button"
          className={toolClass}
          aria-pressed={zoomMode === 'fit-width'}
          onClick={() => setZoomMode('fit-width')}
        >
          Fit width
        </button>
        <button
          type="button"
          className={toolClass}
          aria-pressed={zoomMode === 'custom' && Math.abs(customScale - 1) < 0.02}
          onClick={() => {
            setZoomMode('custom')
            setCustomScale(1)
          }}
        >
          100%
        </button>
        <select
          aria-label="View mode"
          value={mode}
          onChange={(e) => setMode(e.target.value as Mode)}
          className="rounded border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="continuous">Continuous</option>
          <option value="single">Single page</option>
          <option value="spread">Two-page</option>
        </select>
        {mode === 'spread' && (
          <select
            aria-label="Reading direction"
            value={direction}
            onChange={(e) => setDirection(e.target.value as Direction)}
            className="rounded border border-line bg-surface px-2 py-1 text-sm"
          >
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left</option>
          </select>
        )}
        <button
          type="button"
          className={toolClass}
          aria-pressed={sidebar !== null}
          onClick={() => setSidebar((s) => (s ? null : 'pages'))}
        >
          Sidebar
        </button>
        <span className="flex-1" />
        {object && (
          <button type="button" className={toolClass} onClick={() => void saveOriginal(object)}>
            Save original as
          </button>
        )}
        <button
          type="button"
          className={toolClass}
          onClick={() => void window.api.invoke('window:openReader', { objectId })}
        >
          Open in new window
        </button>
      </header>

      <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-1.5">
        <input
          type="search"
          aria-label="Search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void runSearch()
            }
          }}
          placeholder="Search this PDF"
          className="w-56 rounded border border-line px-2 py-1 text-sm"
        />
        <button type="button" className={toolClass} onClick={() => void runSearch()}>
          Search
        </button>
        <button
          type="button"
          className={toolClass}
          aria-label="Previous match"
          onClick={() => goToHit(hitIndex - 1)}
        >
          Prev match
        </button>
        <button
          type="button"
          className={toolClass}
          aria-label="Next match"
          onClick={() => goToHit(hitIndex + 1)}
        >
          Next match
        </button>
        <span aria-live="polite" aria-label="Search results" className="text-sm text-muted">
          {searchNote || (hits && hits.length > 0 ? `${hitIndex + 1} of ${hits.length}` : '')}
        </span>
      </div>

      <div className="flex min-h-0 flex-1">
        {sidebar && doc && (
          <aside className="flex w-44 shrink-0 flex-col border-r border-line bg-surface">
            <div className="flex gap-1 p-2">
              <button
                type="button"
                className={toolClass}
                aria-pressed={sidebar === 'pages'}
                onClick={() => setSidebar('pages')}
              >
                Pages
              </button>
              <button
                type="button"
                className={toolClass}
                aria-pressed={sidebar === 'outline'}
                onClick={() => setSidebar('outline')}
              >
                Outline
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {sidebar === 'pages' ? (
                <div className="flex flex-col gap-2">
                  {pages.map((_, index) => (
                    <Thumb
                      key={index}
                      doc={doc}
                      pageNumber={index + 1}
                      active={page === index + 1}
                      onClick={() => reveal(index + 1)}
                    />
                  ))}
                </div>
              ) : outline.length === 0 ? (
                <p className="px-1 text-sm text-muted">No outline in this PDF</p>
              ) : (
                <OutlineTree items={outline} onJump={(dest) => void jumpToDest(dest)} />
              )}
            </div>
          </aside>
        )}

        <div ref={frameRef} className="relative min-w-0 flex-1">
          {needsPassword && (
            <form
              className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-canvas"
              onSubmit={(e) => {
                e.preventDefault()
                setDoc(null)
                setLoadError(null)
                setAttempt({ password, n: attempt.n + 1 })
              }}
            >
              <p className="text-sm">This PDF needs a password. It isn’t saved.</p>
              {passwordError && <p className="text-sm text-red-700">That password didn’t work.</p>}
              <input
                type="password"
                aria-label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="rounded border border-line px-3 py-1.5 text-sm"
              />
              <button type="submit" className={toolClass}>
                Unlock
              </button>
            </form>
          )}
          {loadError && (
            <p className="absolute inset-0 flex items-center justify-center text-sm">{loadError}</p>
          )}
          {missing && !object && (
            <p className="absolute inset-0 flex items-center justify-center text-sm">
              This PDF is no longer on the board.
            </p>
          )}
          {doc && mode === 'continuous' && (
            <div
              ref={scrollerRef}
              className="absolute inset-0 overflow-auto"
              onScroll={(e) => {
                const top = e.currentTarget.scrollTop
                setScrollTop(top)
                if (ignoreScroll.current) return
                let current = 1
                offsets.forEach((y, index) => {
                  if (y <= top + 24) current = index + 1
                })
                setPage(current)
                setPageDraft(String(current))
              }}
            >
              <div className="relative mx-auto" style={{ height: contentHeight, width: '100%' }}>
                {layouts.map((box, index) => {
                  const y = offsets[index]
                  if (
                    y + box.height < scrollTop - frame.height ||
                    y > scrollTop + frame.height * 2
                  ) {
                    return null
                  }
                  return (
                    <div
                      key={index + 1}
                      className="absolute left-1/2"
                      style={{ top: y, transform: 'translateX(-50%)' }}
                    >
                      <PdfPage
                        doc={doc}
                        pageNumber={index + 1}
                        scale={scale}
                        query={hits ? query : ''}
                        current={currentHit?.page === index + 1}
                        onJump={(dest) => void jumpToDest(dest)}
                      />
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {doc && mode !== 'continuous' && (
            <div className="absolute inset-0 flex items-start justify-center overflow-auto p-4">
              <div className="flex gap-4">
                {(direction === 'rtl' ? [...shown].reverse() : shown).map((n) => (
                  <PdfPage
                    key={n}
                    doc={doc}
                    pageNumber={n}
                    scale={scale}
                    query={hits ? query : ''}
                    current={currentHit?.page === n}
                    onJump={(dest) => void jumpToDest(dest)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const toolClass = 'rounded border border-line bg-surface px-2 py-1 text-sm hover:bg-canvas'

function PdfPage({
  doc,
  pageNumber,
  scale,
  query,
  current,
  onJump
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  scale: number
  query: string
  current: boolean
  onJump: (dest: unknown) => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const [links, setLinks] = useState<
    { key: string; url?: string; dest?: unknown; style: CSSProperties }[]
  >([])
  const [size, setSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const canvas = canvasRef.current
    const textLayer = textRef.current
    if (!canvas || !textLayer) return
    let dead = false
    let task: RenderTask | null = null
    let layer: TextLayer | null = null
    void (async () => {
      try {
        const pdfPage = await doc.getPage(pageNumber)
        if (dead) return
        const viewport = pdfPage.getViewport({ scale })
        setSize({ width: viewport.width, height: viewport.height })
        const pixel = window.devicePixelRatio || 1
        canvas.width = Math.ceil(viewport.width * pixel)
        canvas.height = Math.ceil(viewport.height * pixel)
        canvas.style.width = `${viewport.width}px`
        canvas.style.height = `${viewport.height}px`
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        ctx.setTransform(1, 0, 0, 1, 0, 0)
        task = pdfPage.render({
          canvas,
          canvasContext: ctx,
          viewport: pdfPage.getViewport({ scale: scale * pixel }),
          annotationMode: AnnotationMode.DISABLE
        })
        try {
          await task.promise
        } catch {
          return
        }
        if (dead) return
        const text = await pdfPage.getTextContent()
        if (dead) return
        textLayer.replaceChildren()
        textLayer.style.setProperty('--scale-factor', String(scale))
        layer = new TextLayer({ textContentSource: text, container: textLayer, viewport })
        await layer.render()
        markHits(textLayer, query, current)
        const annots = await pdfPage.getAnnotations()
        if (dead) return
        setLinks(linkBoxes(annots, viewport))
      } catch {
        // The page was closed or replaced before this render finished.
      }
    })()
    return () => {
      dead = true
      task?.cancel()
      layer?.cancel()
    }
  }, [doc, pageNumber, scale, query, current])

  return (
    <div
      className="relative bg-white shadow-sm"
      data-testid="pdf-page"
      data-page={pageNumber}
      style={{ width: size.width || undefined, height: size.height || undefined }}
    >
      <canvas ref={canvasRef} />
      <div ref={textRef} className="textLayer" />
      {links.map((link) => (
        <button
          key={link.key}
          type="button"
          className="absolute"
          style={link.style}
          aria-label={link.url ?? 'Go to page'}
          onClick={() => {
            if (link.url) {
              void window.api
                .invoke('links:open', link.url)
                .catch((error: unknown) => reportError(error))
            } else if (link.dest) onJump(link.dest)
          }}
        />
      ))}
    </div>
  )
}

function Thumb({
  doc,
  pageNumber,
  active,
  onClick
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  active: boolean
  onClick: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      root: el.parentElement?.parentElement
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    const canvas = canvasRef.current
    if (!canvas) return
    let dead = false
    let task: RenderTask | null = null
    void (async () => {
      const pdfPage = await doc.getPage(pageNumber)
      if (dead) return
      const base = pdfPage.getViewport({ scale: 1 })
      const viewport = pdfPage.getViewport({ scale: 120 / base.width })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      task = pdfPage.render({
        canvas,
        canvasContext: ctx,
        viewport,
        annotationMode: AnnotationMode.DISABLE
      })
      await task.promise.catch(() => {})
    })()
    return () => {
      dead = true
      task?.cancel()
    }
  }, [doc, pageNumber, visible])

  return (
    <button
      ref={ref}
      type="button"
      aria-label={`Page ${pageNumber}`}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded p-1 ${active ? 'bg-accent/10' : 'hover:bg-canvas'}`}
    >
      <canvas ref={canvasRef} data-testid="pdf-thumb" className="max-w-full bg-white shadow-sm" />
      <span className="text-xs text-muted">{pageNumber}</span>
    </button>
  )
}

function OutlineTree({ items, onJump }: { items: OutlineNode[]; onJump: (dest: unknown) => void }) {
  return (
    <ul className="flex flex-col gap-1 pl-2">
      {items.map((item, index) => (
        <li key={`${item.title}-${index}`}>
          <button
            type="button"
            className="w-full truncate rounded px-1 py-0.5 text-left text-sm hover:bg-canvas"
            onClick={() => item.dest && onJump(item.dest)}
          >
            {item.title}
          </button>
          {item.items?.length > 0 && <OutlineTree items={item.items} onJump={onJump} />}
        </li>
      ))}
    </ul>
  )
}

function linkBoxes(annots: unknown[], viewport: PageViewport) {
  const links: { key: string; url?: string; dest?: unknown; style: CSSProperties }[] = []
  annots.forEach((annot, index) => {
    const item = annot as { subtype?: string; url?: string; dest?: unknown; rect?: number[] }
    if (item.subtype !== 'Link' || !item.rect) return
    if (item.url && !isSafeLink(item.url)) return
    if (!item.url && item.dest == null) return
    const rect = viewport.convertToViewportRectangle(item.rect)
    const left = Math.min(rect[0], rect[2])
    const top = Math.min(rect[1], rect[3])
    links.push({
      key: `${index}`,
      url: item.url,
      dest: item.dest,
      style: {
        left,
        top,
        width: Math.abs(rect[2] - rect[0]),
        height: Math.abs(rect[3] - rect[1])
      }
    })
  })
  return links
}

function markHits(container: HTMLElement, query: string, current: boolean): void {
  const needle = query.trim().toLowerCase()
  let marked = false
  container.querySelectorAll('span').forEach((span) => {
    const hit = !!needle && (span.textContent ?? '').toLowerCase().includes(needle)
    span.classList.toggle('pdf-hit', hit)
    const isCurrent = hit && current && !marked
    if (isCurrent) marked = true
    span.classList.toggle('pdf-hit-current', isCurrent)
  })
}

async function pageOfDest(doc: PDFDocumentProxy, dest: unknown): Promise<number | null> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit) || explicit[0] == null) return null
    return (await doc.getPageIndex(explicit[0] as never)) + 1
  } catch {
    return null
  }
}

function spreadOf(page: number, pageCount: number): number[] {
  if (pageCount <= 0) return []
  if (page <= 1) return [1]
  const start = page % 2 === 0 ? page : page - 1
  return start + 1 <= pageCount ? [start, start + 1] : [start]
}

function nextSpread(page: number, pageCount: number): number {
  if (page <= 1) return Math.min(2, pageCount)
  const start = page % 2 === 0 ? page : page - 1
  return Math.min(pageCount, start + 2)
}

function prevSpread(page: number): number {
  if (page <= 2) return 1
  const start = page % 2 === 0 ? page : page - 1
  return Math.max(1, start - 2)
}

function computeScale(
  mode: ZoomMode,
  custom: number,
  frame: { width: number; height: number },
  width: number,
  height: number
): number {
  if (mode === 'custom') return clamp(custom, 0.25, 6)
  const fitW = (Math.max(80, frame.width) - 32) / Math.max(1, width)
  const fitH = (Math.max(80, frame.height) - 32) / Math.max(1, height)
  return clamp(mode === 'fit-width' ? fitW : Math.min(fitW, fitH), 0.1, 6)
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function isPassword(error: unknown): boolean {
  return (
    !!error &&
    typeof error === 'object' &&
    (error as { name?: string }).name === 'PasswordException'
  )
}
