import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Dialog } from 'radix-ui'
import { assetUrl } from '@shared/assets'
import { cropPixels, type ImageCrop } from '@shared/crop'
import { stackSettings } from '@shared/stacks'
import type { CanvasObject, StackSlide } from '@shared/types'
import { useCanvasStore } from '../store/canvasStore'
import { useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { TagEditor } from '../tags/TagEditor'
import { applyPatches } from '../canvas/actions'
import { reorderSlideIds } from './reorder'
import * as stacks from './stackActions'

export function StackDialogs() {
  return (
    <>
      <StackEditor />
      <StackViewer />
      <CropEditor />
      <StackDropDialog />
      <StackPreviewBar />
    </>
  )
}

function useStack(id: string | null): CanvasObject | null {
  const objects = useWorkspaceStore((s) => s.board?.objects)
  return objects?.find((object) => object.id === id) ?? null
}

function StackEditor() {
  const id = useCanvasStore((s) => s.stackEditorId)
  const setId = useCanvasStore((s) => s.setStackEditorId)
  const object = useStack(id)
  const [slideId, setSlideId] = useState<string | null>(null)
  const slide = object?.slides?.find((item) => item.id === slideId) ?? object?.slides?.[0]
  if (!object) return null
  const settings = stackSettings(object.data)
  return (
    <Dialog.Root open onOpenChange={(open) => !open && setId(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 max-h-[85vh] w-[720px] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl bg-surface p-4 shadow-xl">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-lg">Stack editor</Dialog.Title>
            <button className="text-sm text-muted" onClick={() => setId(null)}>
              Close
            </button>
          </div>
          <label className="mt-3 block text-sm">
            Name
            <input
              className="mt-1 w-full rounded-lg border border-line px-2 py-1"
              defaultValue={settings.name ?? ''}
              key={object.revision}
              onBlur={(event) =>
                void stacks.updateStack(object.id, { name: event.target.value }, object.revision)
              }
            />
          </label>
          <div className="mt-3 flex gap-3 text-sm">
            <label>
              Size
              <select
                className="ml-2 rounded border border-line px-2 py-1"
                value={settings.sizing}
                onChange={(event) =>
                  void stacks.updateStack(
                    object.id,
                    { sizing: event.target.value as 'fixed' | 'adaptive' },
                    object.revision
                  )
                }
              >
                <option value="fixed">Fixed</option>
                <option value="adaptive">Adaptive</option>
              </select>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={settings.rememberLast}
                onChange={(event) =>
                  void stacks.updateStack(
                    object.id,
                    { rememberLast: event.target.checked },
                    object.revision
                  )
                }
              />
              Remember last viewed image
            </label>
          </div>
          <ul className="mt-4 space-y-2">
            {(object.slides ?? []).map((item, index) => {
              const name = item.asset?.originalName ?? 'Image'
              return (
                <li
                  key={item.id}
                  className="flex items-center gap-2 text-sm"
                  onDragOver={(event) => {
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                  }}
                  onDrop={(event) => {
                    event.preventDefault()
                    const fromId = event.dataTransfer.getData('text/plain')
                    const next = reorderSlideIds(
                      (object.slides ?? []).map((slide) => slide.id),
                      fromId,
                      item.id
                    )
                    if (next) void stacks.reorderSlides(object.id, next, object.revision)
                  }}
                >
                  <div
                    draggable
                    aria-label={`Drag to reorder ${name}`}
                    className="cursor-grab"
                    onDragStart={(event) => {
                      event.dataTransfer.setData('text/plain', item.id)
                      event.dataTransfer.effectAllowed = 'move'
                    }}
                  >
                    <SlideImage slide={item} thumb />
                  </div>
                  <button className="flex-1 text-left" onClick={() => setSlideId(item.id)}>
                    {name}
                    {item.id === settings.coverSlideId ? ' · Cover' : ''}
                    {item.id === settings.displayedSlideId ? ' · Showing' : ''}
                  </button>
                  <button
                    aria-label={`Move ${name} up`}
                    onClick={() =>
                      void stacks.reorderSlides(
                        object.id,
                        move(object.slides ?? [], index, -1),
                        object.revision
                      )
                    }
                  >
                    Up
                  </button>
                  <button
                    aria-label={`Move ${name} down`}
                    onClick={() =>
                      void stacks.reorderSlides(
                        object.id,
                        move(object.slides ?? [], index, 1),
                        object.revision
                      )
                    }
                  >
                    Down
                  </button>
                  <button onClick={() => void stacks.setCover(object.id, item.id, object.revision)}>
                    Cover
                  </button>
                  <button
                    onClick={() =>
                      useCanvasStore
                        .getState()
                        .setCropTarget({ objectId: object.id, slideId: item.id })
                    }
                  >
                    Crop
                  </button>
                  <button
                    onClick={() => void stacks.extractSlide(object.id, item.id, object.revision)}
                  >
                    Extract
                  </button>
                  <button
                    onClick={() => void stacks.removeSlide(object.id, item.id, object.revision)}
                  >
                    Remove
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="mt-3 flex gap-2">
            <button
              className="rounded-lg border border-line px-3 py-1 text-sm"
              onClick={() => void addImages(object)}
            >
              Add images
            </button>
            <button
              className="rounded-lg border border-line px-3 py-1 text-sm"
              onClick={() => void stacks.unstack(object.id, 'separate', object.revision)}
            >
              Separate here
            </button>
            {settings.layoutCaptured && (
              <button
                className="rounded-lg border border-line px-3 py-1 text-sm"
                onClick={() => void stacks.unstack(object.id, 'restore', object.revision)}
              >
                Restore original layout
              </button>
            )}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4">
            <TagEditor title="Stack tags" targets={[{ type: 'object', id: object.id }]} />
            {slide && (
              <TagEditor
                title="This image’s tags"
                targets={[{ type: 'slide', id: slide.id }]}
                inherited={slide.tags
                  ?.filter((tag) => tag.source === 'asset')
                  .map((tag) => ({ id: tag.id, name: tag.name }))}
              />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function StackViewer() {
  const viewer = useCanvasStore((s) => s.stackViewer)
  const setViewer = useCanvasStore((s) => s.setStackViewer)
  const object = useStack(viewer?.objectId ?? null)
  if (!viewer || !object) return null
  return <StackViewerBody object={object} viewer={viewer} setViewer={setViewer} />
}

const MIN_SCALE = 0.02
const MAX_SCALE = 32
const FIT_PADDING = 48

interface View {
  x: number
  y: number
  scale: number
}

function StackViewerBody({
  object,
  viewer,
  setViewer
}: {
  object: CanvasObject
  viewer: { objectId: string; mode: 'gallery' | 'focus'; slideId: string }
  setViewer: (
    viewer: { objectId: string; mode: 'gallery' | 'focus'; slideId: string } | null
  ) => void
}) {
  const slides = object.slides ?? []
  const slide = slides.find((item) => item.id === viewer.slideId) ?? slides[0]
  const projectId = useProjectStore((s) => s.project?.id)
  const [area, setArea] = useState<HTMLDivElement | null>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [manuals, setManuals] = useState<Record<string, View | null>>({})
  const pan = useRef<{ pointerId: number; startX: number; startY: number; view: View } | null>(null)
  const pixels =
    slide?.asset?.width && slide.asset.height
      ? cropPixels(slide.crop, slide.asset.width, slide.asset.height)
      : null
  const naturalW = pixels?.width ?? 1
  const naturalH = pixels?.height ?? 1
  const manual = slide ? (manuals[slide.id] ?? null) : null
  const setManual = (view: View | null) => {
    if (!slide) return
    setManuals((current) => ({ ...current, [slide.id]: view }))
  }
  const fitted = manual === null
  const view = useMemo((): View => {
    if (manual) return manual
    const scale = Math.min(
      MAX_SCALE,
      Math.max(
        MIN_SCALE,
        Math.min(
          1,
          (size.width - FIT_PADDING * 2) / naturalW,
          (size.height - FIT_PADDING * 2) / naturalH
        )
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
  const slideId = slide?.id
  const zoomAt = (scale: number, at?: { x: number; y: number }) => {
    if (!slideId) return
    const current = viewRef.current
    const anchor = at ?? { x: (area?.clientWidth ?? 0) / 2, y: (area?.clientHeight ?? 0) / 2 }
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))
    const k = next / (current.scale || 1)
    setManuals((currentViews) => ({
      ...currentViews,
      [slideId]: {
        scale: next,
        x: anchor.x - (anchor.x - current.x) * k,
        y: anchor.y - (anchor.y - current.y) * k
      }
    }))
  }
  const zoomAtRef = useRef(zoomAt)
  useEffect(() => {
    zoomAtRef.current = zoomAt
  })
  useEffect(() => {
    const el = area
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      const at = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      zoomAtRef.current(viewRef.current.scale * Math.exp(-event.deltaY * 0.0015), at)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [area])
  const index = slide ? slides.findIndex((item) => item.id === slide.id) : 0
  const show = (delta: number) => {
    if (slides.length < 2) return
    const next = slides[(index + delta + slides.length) % slides.length]
    setViewer({ ...viewer, slideId: next.id })
  }
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
      return
    const keys: Record<string, () => void> = {
      ArrowLeft: () => show(-1),
      ArrowRight: () => show(1),
      f: () => setManual(null),
      '0': () => setManual(null),
      '1': () => zoomAt(1),
      '+': () => zoomAt(view.scale * 1.25),
      '=': () => zoomAt(view.scale * 1.25),
      '-': () => zoomAt(view.scale / 1.25)
    }
    const action = keys[event.key]
    if (!action || event.ctrlKey || event.metaKey || event.altKey) return
    event.preventDefault()
    action()
  }
  const local = (event: { clientX: number; clientY: number }) => {
    const rect = area!.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  const button = 'rounded border border-line px-2 py-1 text-sm'
  return (
    <Dialog.Root open onOpenChange={(open) => !open && setViewer(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70" />
        <Dialog.Content
          className="fixed inset-6 flex flex-col rounded-xl bg-surface p-3 outline-none"
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            ;(event.target as HTMLElement | null)?.focus()
          }}
          onKeyDown={onKeyDown}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Dialog.Title className="text-sm">
              {stackSettings(object.data).name ?? 'Stack'}
            </Dialog.Title>
            {slide?.asset && (
              <p className="text-xs text-muted">
                {slide.asset.originalName} · {index + 1} of {slides.length}
              </p>
            )}
            <button
              className={button}
              aria-label="Previous image"
              disabled={slides.length < 2}
              onClick={() => show(-1)}
            >
              ←
            </button>
            <button
              className={button}
              aria-label="Next image"
              disabled={slides.length < 2}
              onClick={() => show(1)}
            >
              →
            </button>
            <button
              className={button}
              aria-label="Zoom out"
              onClick={() => zoomAt(view.scale / 1.25)}
            >
              −
            </button>
            <span className="w-12 text-center text-sm tabular-nums" aria-label="Zoom level">
              {Math.round(view.scale * 100)}%
            </span>
            <button
              className={button}
              aria-label="Zoom in"
              onClick={() => zoomAt(view.scale * 1.25)}
            >
              +
            </button>
            <button className={button} aria-pressed={fitted} onClick={() => setManual(null)}>
              Fit
            </button>
            <button className={button} onClick={() => zoomAt(1)}>
              100%
            </button>
            <button
              className={button}
              onClick={() =>
                setViewer({ ...viewer, mode: viewer.mode === 'gallery' ? 'focus' : 'gallery' })
              }
            >
              {viewer.mode === 'gallery' ? 'Focus' : 'Gallery'}
            </button>
            {slide?.asset && (
              <button
                className={button}
                onClick={() => useCanvasStore.getState().setViewerAssetId(slide.assetId)}
              >
                Open original
              </button>
            )}
            {slide && (
              <button
                className={button}
                onClick={() =>
                  useCanvasStore
                    .getState()
                    .setCropTarget({ objectId: object.id, slideId: slide.id })
                }
              >
                Crop this image
              </button>
            )}
          </div>
          <div
            ref={setArea}
            className="relative mt-3 min-h-0 flex-1 cursor-grab overflow-hidden bg-canvas active:cursor-grabbing"
            onPointerDown={(event) => {
              if (event.button !== 0 || !pixels) return
              event.currentTarget.setPointerCapture(event.pointerId)
              const point = local(event)
              pan.current = { pointerId: event.pointerId, startX: point.x, startY: point.y, view }
            }}
            onPointerMove={(event) => {
              const gesture = pan.current
              if (!gesture || gesture.pointerId !== event.pointerId) return
              const point = local(event)
              setManual({
                ...gesture.view,
                x: gesture.view.x + point.x - gesture.startX,
                y: gesture.view.y + point.y - gesture.startY
              })
            }}
            onPointerUp={() => {
              pan.current = null
            }}
            onPointerCancel={() => {
              pan.current = null
            }}
          >
            {slide && projectId && pixels && (
              <div
                className="absolute top-0 left-0 origin-top-left overflow-hidden"
                style={{
                  width: pixels.width,
                  height: pixels.height,
                  visibility: size.width > 0 ? 'visible' : 'hidden',
                  transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`
                }}
              >
                <CroppedOriginal projectId={projectId} slide={slide} />
              </div>
            )}
            {slides.length === 0 && (
              <p className="p-6 text-sm text-muted">This stack has no images yet.</p>
            )}
          </div>
          {viewer.mode === 'gallery' && slides.length > 0 && (
            <div className="mt-3 flex gap-2 overflow-auto">
              {slides.map((item) => (
                <button
                  key={item.id}
                  className={`rounded border p-1 ${item.id === slide?.id ? 'border-ink' : 'border-line'}`}
                  onClick={() => setViewer({ ...viewer, slideId: item.id })}
                >
                  <SlideImage slide={item} thumb />
                  <span className="block max-w-24 truncate text-xs">
                    {item.asset?.originalName ?? 'Image'}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function CroppedOriginal({ projectId, slide }: { projectId: string; slide: StackSlide }) {
  const asset = slide.asset!
  const pixels = cropPixels(slide.crop, asset.width ?? 1, asset.height ?? 1)
  const [ready, setReady] = useState(false)
  const original = assetUrl(projectId, asset.sha256, 'original')
  const preview =
    Math.max(asset.width ?? 0, asset.height ?? 0) > 1024
      ? assetUrl(projectId, asset.sha256, 1024)
      : undefined
  const placed = {
    position: 'absolute' as const,
    width: asset.width ?? pixels.width,
    height: asset.height ?? pixels.height,
    left: -pixels.x,
    top: -pixels.y,
    maxWidth: 'none' as const
  }
  return (
    <>
      {preview && !ready && <img alt="" src={preview} draggable={false} style={placed} />}
      <img
        data-testid="stack-viewer-image"
        alt={asset.originalName}
        src={original}
        draggable={false}
        decoding="async"
        style={placed}
        onLoad={() => setReady(true)}
      />
    </>
  )
}

function CropEditor() {
  const target = useCanvasStore((s) => s.cropTarget)
  if (!target) return null
  return <CropForm key={`${target.objectId}:${target.slideId ?? ''}`} target={target} />
}

function CropForm({ target }: { target: { objectId: string; slideId?: string } }) {
  const setTarget = useCanvasStore((s) => s.setCropTarget)
  const object = useStack(target.objectId)
  const projectId = useProjectStore((s) => s.project?.id)
  const slide = target?.slideId ? object?.slides?.find((item) => item.id === target.slideId) : null
  const asset = slide?.asset ?? object?.asset
  const initial = slide?.crop ?? (object && !target?.slideId ? cropOfData(object) : null)
  const [crop, setCrop] = useState<ImageCrop | null>(initial)
  if (!target || !object || !asset?.width || !asset.height || !projectId) return null
  const pixels = cropPixels(crop, asset.width, asset.height)
  const confirm = () => {
    if (target.slideId) void stacks.cropSlide(object.id, target.slideId, crop, object.revision)
    else void stacks.cropImage(object.id, crop, object.revision)
    setTarget(null)
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && setTarget(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[640px] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-4">
          <Dialog.Title>Crop this appearance</Dialog.Title>
          <p className="mt-1 text-sm text-muted">The original file stays unchanged.</p>
          <CropStage
            projectId={projectId}
            sha256={asset.sha256}
            assetWidth={asset.width}
            assetHeight={asset.height}
            pixels={pixels}
            onChange={setCrop}
          />
          <div className="mt-3 grid grid-cols-4 gap-2 text-sm">
            {(['x', 'y', 'width', 'height'] as const).map((key) => (
              <label key={key}>
                {key}
                <input
                  type="number"
                  className="mt-1 w-full rounded border border-line px-2 py-1"
                  value={pixels[key]}
                  onChange={(event) => setCrop({ ...pixels, [key]: Number(event.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="rounded-lg bg-ink px-3 py-1 text-sm text-white" onClick={confirm}>
              Apply crop
            </button>
            <button
              className="rounded-lg border border-line px-3 py-1 text-sm"
              onClick={() => setCrop(null)}
            >
              Reset
            </button>
            <button
              className="rounded-lg border border-line px-3 py-1 text-sm"
              onClick={() => setTarget(null)}
            >
              Cancel
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function StackDropDialog() {
  const drop = useCanvasStore((s) => s.stackDrop)
  const setDrop = useCanvasStore((s) => s.setStackDrop)
  const stack = useStack(drop?.stackId ?? null)
  if (!drop || !stack) return null
  const choose = (mode: 'move' | 'copy') => {
    if (mode === 'copy' && drop.dx) {
      void applyPatches(
        drop.objectIds.map((id) => {
          const origin = drop.origins.find((item) => item.id === id)
          return origin ? { id, x: origin.x + drop.dx, y: origin.y + drop.dy } : { id }
        }),
        'Move'
      )
    }
    void stacks.addToStack({
      stackId: stack.id,
      expectedRevision: stack.revision,
      objectIds: drop.objectIds,
      mode
    })
    setDrop(null)
  }
  return (
    <Dialog.Root open onOpenChange={(open) => !open && setDrop(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/30" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-80 -translate-x-1/2 -translate-y-1/2 rounded-xl bg-surface p-4">
          <Dialog.Title>Add to stack</Dialog.Title>
          <p className="mt-2 text-sm text-muted">The original file stays in the library.</p>
          <div className="mt-4 flex gap-2">
            <button
              className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white"
              onClick={() => choose('move')}
            >
              Move into stack
            </button>
            <button
              className="rounded-lg border border-line px-3 py-1.5 text-sm"
              onClick={() => choose('copy')}
            >
              Copy into stack
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function StackPreviewBar() {
  const preview = useCanvasStore((s) => s.stackPreview)
  const object = useStack(preview?.objectId ?? null)
  if (!preview || !object) return null
  const settings = stackSettings(object.data)
  return (
    <div className="pointer-events-auto absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-line bg-surface px-3 py-1 text-sm shadow">
      Previewing a search result
      <button
        onClick={() =>
          void stacks
            .showSlide(object.id, preview.slideId, settings.displayedSlideId)
            .then(() => useCanvasStore.getState().setStackPreview(null))
        }
      >
        Keep displayed
      </button>
      <button onClick={() => useCanvasStore.getState().setStackPreview(null)}>Close</button>
    </div>
  )
}

function SlideImage({ slide, thumb = false }: { slide: StackSlide; thumb?: boolean }) {
  const projectId = useProjectStore((s) => s.project?.id)
  const ref = useRef<HTMLCanvasElement>(null)
  const asset = slide.asset
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !projectId || !asset?.width || !asset.height) return
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const pixels = cropPixels(slide.crop, asset.width!, asset.height!)
      const max = thumb ? 72 : 900
      const scale = Math.min(1, max / Math.max(pixels.width, pixels.height))
      canvas.width = Math.max(1, Math.round(pixels.width * scale))
      canvas.height = Math.max(1, Math.round(pixels.height * scale))
      const ctx = canvas.getContext('2d')
      const sourceScale = img.naturalWidth / asset.width!
      ctx?.drawImage(
        img,
        pixels.x * sourceScale,
        pixels.y * sourceScale,
        pixels.width * sourceScale,
        pixels.height * sourceScale,
        0,
        0,
        canvas.width,
        canvas.height
      )
    }
    img.src = assetUrl(projectId, asset.sha256, thumb ? 256 : 1024)
    return () => {
      cancelled = true
    }
  }, [projectId, asset, slide.crop, thumb])
  if (!projectId || !asset) return null
  return (
    <canvas ref={ref} className={thumb ? 'h-16 w-16 object-contain' : 'max-h-full max-w-full'} />
  )
}

function CropStage({
  projectId,
  sha256,
  assetWidth,
  assetHeight,
  pixels,
  onChange
}: {
  projectId: string
  sha256: string
  assetWidth: number
  assetHeight: number
  pixels: ImageCrop
  onChange: (crop: ImageCrop) => void
}) {
  const box = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    mode: string
    start: ImageCrop
    originX: number
    originY: number
  } | null>(null)
  const point = (event: React.PointerEvent) => {
    const rect = box.current!.getBoundingClientRect()
    return {
      x: ((event.clientX - rect.left) / rect.width) * assetWidth,
      y: ((event.clientY - rect.top) / rect.height) * assetHeight
    }
  }
  const move = (event: React.PointerEvent) => {
    const current = drag.current
    if (!current) return
    const here = point(event)
    const dx = here.x - current.originX
    const dy = here.y - current.originY
    let next = { ...current.start }
    if (current.mode === 'move') {
      next.x += dx
      next.y += dy
    } else {
      if (current.mode.includes('w')) {
        next.x += dx
        next.width -= dx
      }
      if (current.mode.includes('e')) next.width += dx
      if (current.mode.includes('n')) {
        next.y += dy
        next.height -= dy
      }
      if (current.mode.includes('s')) next.height += dy
    }
    next = clampCrop(next, assetWidth, assetHeight)
    onChange(next)
  }
  const left = (pixels.x / assetWidth) * 100
  const top = (pixels.y / assetHeight) * 100
  const width = (pixels.width / assetWidth) * 100
  const height = (pixels.height / assetHeight) * 100
  return (
    <div className="relative mt-3 inline-block max-w-full">
      <img alt="" src={assetUrl(projectId, sha256, 1024)} className="max-h-[50vh] max-w-full" />
      <div
        ref={box}
        className="absolute inset-0"
        onPointerMove={move}
        onPointerUp={() => {
          drag.current = null
        }}
      >
        <div
          className="absolute border-2 border-white"
          style={{ left: `${left}%`, top: `${top}%`, width: `${width}%`, height: `${height}%` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const here = point(event)
            drag.current = { mode: 'move', start: pixels, originX: here.x, originY: here.y }
          }}
        />
        {(['nw', 'ne', 'sw', 'se', 'n', 's', 'w', 'e'] as const).map((mode) => (
          <button
            key={mode}
            aria-label={`Crop ${mode}`}
            className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
            style={handleStyle(mode, left, top, width, height)}
            onPointerDown={(event) => {
              event.stopPropagation()
              event.currentTarget.setPointerCapture(event.pointerId)
              const here = point(event)
              drag.current = { mode, start: pixels, originX: here.x, originY: here.y }
            }}
          />
        ))}
      </div>
    </div>
  )
}

function handleStyle(mode: string, left: number, top: number, width: number, height: number) {
  const x = mode.includes('w') ? left : mode.includes('e') ? left + width : left + width / 2
  const y = mode.includes('n') ? top : mode.includes('s') ? top + height : top + height / 2
  return { left: `${x}%`, top: `${y}%` }
}

function clampCrop(crop: ImageCrop, assetWidth: number, assetHeight: number): ImageCrop {
  const width = Math.max(1, Math.min(crop.width, assetWidth))
  const height = Math.max(1, Math.min(crop.height, assetHeight))
  const x = Math.max(0, Math.min(crop.x, assetWidth - width))
  const y = Math.max(0, Math.min(crop.y, assetHeight - height))
  return { x, y, width, height }
}

function cropOfData(object: CanvasObject): ImageCrop | null {
  const value = object.data.crop
  if (!value || typeof value !== 'object') return null
  const crop = value as ImageCrop
  return typeof crop.width === 'number' ? crop : null
}

function move(slides: StackSlide[], index: number, delta: number): string[] {
  const ids = slides.map((slide) => slide.id)
  const next = index + delta
  if (next < 0 || next >= ids.length) return ids
  const [id] = ids.splice(index, 1)
  ids.splice(next, 0, id)
  return ids
}

async function addImages(object: CanvasObject): Promise<void> {
  const paths = await window.api.invoke('dialog:pickImages')
  if (paths.length === 0) return
  const imported = await window.api.invoke('assets:importFiles', paths, { imagesOnly: true })
  await stacks.addToStack({
    stackId: object.id,
    expectedRevision: object.revision,
    assetIds: imported.imported.map((asset) => asset.id),
    mode: 'copy'
  })
}
