import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { assetUrl, THUMBNAIL_SIZES } from '@shared/assets'
import type { AssetInfo, CanvasObject } from '@shared/types'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from './actions'
import { isViewable } from './objectTypes'

const MIN_SCALE = 0.02
const MAX_SCALE = 32
const FIT_PADDING = 48

interface View {
  x: number
  y: number
  scale: number
}

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/** Full-size image viewer (§7): the original file at any zoom, with pan, fit and download. */
export function ImageViewer() {
  const viewerObjectId = useCanvasStore((s) => s.viewerObjectId)
  const viewerAssetId = useCanvasStore((s) => s.viewerAssetId)
  const setViewerObjectId = useCanvasStore((s) => s.setViewerObjectId)
  const setViewerAssetId = useCanvasStore((s) => s.setViewerAssetId)
  const objects = useWorkspaceStore((s) => s.board?.objects)
  const [assetObject, setAssetObject] = useState<CanvasObject | null>(null)
  useEffect(() => {
    if (!viewerAssetId) return
    let dead = false
    void window.api.invoke('assets:get', viewerAssetId).then((asset) => {
      if (!dead) setAssetObject(objectForAsset(asset))
    })
    return () => {
      dead = true
    }
  }, [viewerAssetId])

  // Images on the board in reading order, for ← / →.
  const images = useMemo(
    () =>
      (objects ?? [])
        .filter(isViewable)
        .sort((a, b) => (Math.abs(a.y - b.y) > 1 ? a.y - b.y : a.x - b.x)),
    [objects]
  )
  const object = images.find((o) => o.id === viewerObjectId)

  // The image went away (deleted, other board opened): close rather than block the canvas.
  useEffect(() => {
    if (viewerObjectId && objects && !object) setViewerObjectId(null)
  }, [viewerObjectId, objects, object, setViewerObjectId])

  const direct = viewerAssetId && assetObject?.asset?.id === viewerAssetId ? assetObject : null
  const shown = object ?? direct
  return (
    <Dialog.Root
      open={!!shown}
      onOpenChange={(open) => {
        if (open) return
        setViewerObjectId(null)
        setViewerAssetId(null)
      }}
    >
      {shown && (
        <ViewerContent
          key={shown.id}
          object={shown}
          images={object ? images : [shown]}
          onNavigate={(id) => setViewerObjectId(id)}
        />
      )}
    </Dialog.Root>
  )
}

function objectForAsset(asset: AssetInfo): CanvasObject {
  return {
    id: asset.id,
    boardId: '',
    type: 'image',
    x: 0,
    y: 0,
    width: asset.width ?? 100,
    height: asset.height ?? 100,
    rotation: 0,
    zIndex: 0,
    locked: false,
    groupId: null,
    linkedBoardId: null,
    assetId: asset.id,
    data: {},
    revision: 0,
    asset
  }
}

function ViewerContent({
  object,
  images,
  onNavigate
}: {
  object: CanvasObject
  images: CanvasObject[]
  onNavigate: (id: string) => void
}) {
  const projectId = useProjectStore((s) => s.project?.id)
  const asset = object.asset!
  const naturalW = asset.width ?? object.width
  const naturalH = asset.height ?? object.height

  // A state ref: the dialog's portal mounts its content after this component's first render.
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const pressesInside = useRef(0)
  // null = fit to window (and keep fitting when the window is resized).
  const [manual, setManual] = useState<View | null>(null)
  const [originalLoaded, setOriginalLoaded] = useState(false)
  const pan = useRef<{ pointerId: number; startX: number; startY: number; view: View } | null>(null)

  const fitted = manual === null
  const view = useMemo((): View => {
    if (manual) return manual
    const scale = clampScale(
      Math.min(
        1,
        (size.width - FIT_PADDING * 2) / naturalW,
        (size.height - FIT_PADDING * 2) / naturalH
      )
    )
    return {
      scale,
      x: (size.width - naturalW * scale) / 2,
      y: (size.height - naturalH * scale) / 2
    }
  }, [manual, size, naturalW, naturalH])
  const viewRef = useRef(view)
  useLayoutEffect(() => {
    viewRef.current = view
  })

  useLayoutEffect(() => {
    const el = area
    if (!el) return
    const observer = new ResizeObserver(() =>
      setSize({ width: el.clientWidth, height: el.clientHeight })
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [area])

  const zoomAt = useCallback(
    (scale: number, at?: { x: number; y: number }) => {
      const v = viewRef.current
      const anchor = at ?? { x: (area?.clientWidth ?? 0) / 2, y: (area?.clientHeight ?? 0) / 2 }
      const next = clampScale(scale)
      const k = next / v.scale
      setManual({
        scale: next,
        x: anchor.x - (anchor.x - v.x) * k,
        y: anchor.y - (anchor.y - v.y) * k
      })
    },
    [area]
  )

  const local = (e: { clientX: number; clientY: number }) => {
    const rect = area!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  // React's onWheel is passive, so preventDefault (no page zoom/scroll) needs a native listener.
  useEffect(() => {
    const el = area
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const at = { x: e.clientX - rect.left, y: e.clientY - rect.top }
      zoomAt(viewRef.current.scale * Math.exp(-e.deltaY * 0.0015), at)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [area, zoomAt])

  const index = images.findIndex((o) => o.id === object.id)
  const step = (delta: number) => {
    if (images.length < 2) return
    onNavigate(images[(index + delta + images.length) % images.length].id)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLButtonElement && (e.key === 'Enter' || e.key === ' ')) return
    const keys: Record<string, () => void> = {
      ArrowLeft: () => step(-1),
      ArrowRight: () => step(1),
      f: () => setManual(null),
      '0': () => setManual(null),
      '1': () => zoomAt(1),
      '+': () => zoomAt(view.scale * 1.25),
      '=': () => zoomAt(view.scale * 1.25),
      '-': () => zoomAt(view.scale / 1.25)
    }
    const action = keys[e.key]
    if (!action || e.ctrlKey || e.metaKey || e.altKey) return
    e.preventDefault()
    action()
  }

  const preview =
    projectId && Math.max(naturalW, naturalH) > THUMBNAIL_SIZES[1]
      ? assetUrl(projectId, asset.sha256, THUMBNAIL_SIZES[1])
      : undefined
  const original = projectId ? assetUrl(projectId, asset.sha256, 'original') : undefined
  const percent = Math.round(view.scale * 100)
  const toolbarButton =
    'rounded-md px-2.5 py-1 text-sm text-white/85 hover:bg-white/10 disabled:opacity-30'

  return (
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-40 bg-neutral-950/95" />
      <Dialog.Content
        aria-describedby={undefined}
        onOpenAutoFocus={(e) => {
          // Focus the viewer itself rather than its first button, so keys go to the image.
          e.preventDefault()
          ;(e.target as HTMLElement | null)?.focus()
        }}
        onKeyDown={onKeyDown}
        className="fixed inset-0 z-50 flex flex-col text-white outline-none"
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-2">
          <div className="min-w-0 flex-1">
            <Dialog.Title className="truncate text-sm font-medium">
              {asset.originalName}
            </Dialog.Title>
            <p className="text-xs text-white/60">
              {naturalW} × {naturalH} px · {asset.ext.toUpperCase()} · {formatBytes(asset.bytes)}
              {images.length > 1 && ` · ${index + 1} of ${images.length}`}
            </p>
          </div>
          {images.length > 1 && (
            <>
              <button className={toolbarButton} onClick={() => step(-1)} title="Previous image (←)">
                ←
              </button>
              <button className={toolbarButton} onClick={() => step(1)} title="Next image (→)">
                →
              </button>
            </>
          )}
          <button
            className={toolbarButton}
            onClick={() => zoomAt(view.scale / 1.25)}
            title="Zoom out (−)"
            aria-label="Zoom out"
          >
            −
          </button>
          <span className="w-12 text-center text-sm tabular-nums" aria-label="Zoom level">
            {percent}%
          </span>
          <button
            className={toolbarButton}
            onClick={() => zoomAt(view.scale * 1.25)}
            title="Zoom in (+)"
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            className={toolbarButton}
            aria-pressed={fitted}
            onClick={() => setManual(null)}
            title="Fit to window (F)"
          >
            Fit
          </button>
          <button className={toolbarButton} onClick={() => zoomAt(1)} title="Actual size (1)">
            100%
          </button>
          <button
            className="rounded-md border border-white/20 px-3 py-1 text-sm hover:bg-white/10"
            onClick={() => void actions.saveOriginal(object)}
            title="Save a copy of the original file, exactly as imported"
          >
            Download original
          </button>
          <Dialog.Close className={toolbarButton} aria-label="Close" title="Close (Esc)">
            ✕
          </Dialog.Close>
        </div>
        <div
          ref={setArea}
          className="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
          onPointerDown={(e) => {
            if (e.button !== 0) return
            pressesInside.current++
            e.currentTarget.setPointerCapture(e.pointerId)
            const p = local(e)
            pan.current = { pointerId: e.pointerId, startX: p.x, startY: p.y, view }
          }}
          onPointerMove={(e) => {
            const g = pan.current
            if (!g || g.pointerId !== e.pointerId) return
            const p = local(e)
            setManual({ ...g.view, x: g.view.x + p.x - g.startX, y: g.view.y + p.y - g.startY })
          }}
          onPointerUp={() => (pan.current = null)}
          onPointerCancel={() => (pan.current = null)}
          onDoubleClick={(e) => {
            // The double-click that opened the viewer on the canvas also arrives here, and
            // one of its presses may have landed in here already: only count double-clicks
            // made entirely inside the viewer.
            if (pressesInside.current < 2) return
            if (fitted) zoomAt(1, local(e))
            else setManual(null)
          }}
        >
          <div
            data-testid="image-viewer-image"
            className="absolute top-0 left-0 origin-top-left"
            style={{
              width: naturalW,
              height: naturalH,
              visibility: size.width > 0 ? 'visible' : 'hidden',
              transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
              // Show transparency as a checkerboard, and real pixels when zoomed right in.
              backgroundImage: 'repeating-conic-gradient(#3a3a3a 0% 25%, #2a2a2a 0% 50%)',
              backgroundSize: `${16 / view.scale}px ${16 / view.scale}px`,
              imageRendering: view.scale >= 2 ? 'pixelated' : 'auto'
            }}
          >
            {preview && !originalLoaded && (
              <img
                src={preview}
                alt=""
                draggable={false}
                className="absolute inset-0 h-full w-full"
              />
            )}
            {original && (
              <img
                key={original}
                src={original}
                alt={asset.originalName}
                decoding="async"
                draggable={false}
                onLoad={() => setOriginalLoaded(true)}
                className="absolute inset-0 h-full w-full"
              />
            )}
          </div>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  )
}
