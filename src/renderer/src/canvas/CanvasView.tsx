import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Layer, Line, Rect, Shape, Stage, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { CanvasObject, Point } from '@shared/types'
import { EditableTitle } from '../components/EditableTitle'
import { GRID_SIZE, useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from './actions'
import { expandToGroups, findDropTarget, smartSnap, snapToGrid } from './arrange'
import { BoardCardNode, COLORS, TITLE_FONT_SIZE, TITLE_GAP } from './BoardCardNode'
import {
  boundsOf,
  intersects,
  objectBounds,
  rectFromPoints,
  screenToWorld,
  visibleWorld,
  worldToScreen,
  zoomAt
} from './geometry'
import { ImageNode } from './ImageNode'
import { canRotate, isViewable, lockedAspectRatio } from './objectTypes'
import { useCanvasShortcuts, isSpaceHeld } from './useCanvasShortcuts'

/** Pixels the pointer must move before a press becomes a drag. */
const DRAG_THRESHOLD = 3
/** Screen distance at which smart guides snap. */
const SNAP_DISTANCE = 6
/** Minimum on-screen size while resizing. */
const MIN_RESIZE = 40

type Gesture =
  | { kind: 'pan'; start: Point; origin: { x: number; y: number } }
  | {
      kind: 'drag'
      ids: string[]
      start: Point
      startScreen: Point
      origins: Map<
        string,
        { x: number; y: number; width: number; height: number; rotation: number }
      >
      moved: boolean
      clickedId: string
      additive: boolean
    }
  | { kind: 'marquee'; start: Point; base: Set<string> }

/** The infinite canvas for the open board (§4). */
export function CanvasView() {
  const board = useWorkspaceStore((s) => s.board)
  const renaming = useWorkspaceStore((s) => s.renaming)
  const openBoard = useWorkspaceStore((s) => s.openBoard)
  const setRenaming = useWorkspaceStore((s) => s.setRenaming)
  const viewport = useCanvasStore((s) => s.viewport)
  const viewSize = useCanvasStore((s) => s.viewSize)
  const selection = useCanvasStore((s) => s.selection)
  const cut = useCanvasStore((s) => s.cut)
  const drag = useCanvasStore((s) => s.drag)
  const marquee = useCanvasStore((s) => s.marquee)
  const showGrid = useCanvasStore((s) => s.showGrid)

  const container = useRef<HTMLDivElement | null>(null)
  // The container appears once a board is loaded; effects that attach to it re-run then.
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null)
  const stage = useRef<Konva.Stage>(null)
  const objectLayer = useRef<Konva.Layer>(null)
  const transformer = useRef<Konva.Transformer>(null)
  const gesture = useRef<Gesture | null>(null)
  /** True when the last press became a drag; Konva would otherwise report click-then-drag as a double-click. */
  const lastPressDragged = useRef(false)

  useCanvasShortcuts()

  // Track the canvas size. It's measured before the first paint too: ResizeObserver reports
  // later (much later in a throttled window), and until then the camera isn't set up, so a
  // drop or paste would land in the wrong place and then the first-open "fit" would move it.
  useLayoutEffect(() => {
    const el = containerEl
    if (!el) return
    const { setViewSize } = useCanvasStore.getState()
    const rect = el.getBoundingClientRect()
    setViewSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    const observer = new ResizeObserver(([entry]) => {
      setViewSize({
        width: Math.round(entry.contentRect.width),
        height: Math.round(entry.contentRect.height)
      })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [containerEl])

  // Opening a board: restore its saved camera, or fit its content the first time.
  const boardId = board?.id
  const hasSize = viewSize.width > 0
  useLayoutEffect(() => {
    if (!boardId || !hasSize) return
    const { board: current } = useWorkspaceStore.getState()
    const { setViewport, setSelection, viewSize: size } = useCanvasStore.getState()
    setSelection([])
    const saved = current?.viewport
    const neverViewed = !saved || (saved.x === 0 && saved.y === 0 && saved.zoom === 1)
    if (!neverViewed) setViewport(saved)
    else if (current?.objects.length) actions.fitAll()
    else setViewport({ x: size.width / 2 - 100, y: size.height / 2 - 80, zoom: 1 })
  }, [boardId, hasSize])

  // Save this board's camera shortly after it stops moving (not broadcast to other windows).
  useEffect(() => {
    if (!boardId) return
    const timer = setTimeout(() => {
      void window.api.invoke('board:setViewport', boardId, viewport).catch(() => {})
    }, 400)
    return () => clearTimeout(timer)
  }, [boardId, viewport])

  // Drop selection entries for objects that no longer exist (deleted here or elsewhere).
  const objects = board?.objects
  useEffect(() => {
    if (!objects) return
    const { selection: current, setSelection } = useCanvasStore.getState()
    const ids = new Set(objects.map((o) => o.id))
    if ([...current].some((id) => !ids.has(id)))
      setSelection([...current].filter((id) => ids.has(id)))
  }, [objects])

  // Konva finds what's under the pointer in a hit map that it redraws on the next animation
  // frame. Bring it up to date before each press, so a click always hits what's on the board,
  // even if the window hasn't repainted since the last change (slow or throttled window).
  useEffect(() => {
    const el = containerEl
    if (!el) return
    const refreshHitMap = () => void objectLayer.current?.drawHit()
    el.addEventListener('pointerdown', refreshHitMap, true)
    el.addEventListener('contextmenu', refreshHitMap, true)
    return () => {
      el.removeEventListener('pointerdown', refreshHitMap, true)
      el.removeEventListener('contextmenu', refreshHitMap, true)
    }
  }, [containerEl])

  // Zoom/pan with the wheel or trackpad (needs a non-passive listener to stop page scrolling).
  useEffect(() => {
    const el = containerEl
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const { viewport: vp, setViewport } = useCanvasStore.getState()
      const rect = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        // Ctrl/Cmd + wheel, or trackpad pinch: zoom toward the cursor.
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025))
        setViewport(
          zoomAt(vp, { x: e.clientX - rect.left, y: e.clientY - rect.top }, vp.zoom * factor)
        )
      } else {
        // Wheel / two-finger scroll pans (Shift turns vertical wheel into horizontal).
        const scale = e.deltaMode === 1 ? 20 : 1
        const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * scale
        const dy = (e.shiftKey && !e.deltaX ? 0 : e.deltaY) * scale
        setViewport({ ...vp, x: vp.x - dx, y: vp.y - dy })
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [containerEl])

  const sorted = useMemo(
    () => [...(board?.objects ?? [])].sort((a, b) => a.zIndex - b.zIndex),
    [board?.objects]
  )

  // Only draw what's on screen (plus a margin), but always draw what's selected or dragged.
  const visible = useMemo(() => {
    const area = visibleWorld(viewport, viewSize)
    const margin = 200 / viewport.zoom
    const padded = {
      x: area.x - margin,
      y: area.y - margin,
      width: area.width + margin * 2,
      height: area.height + margin * 2
    }
    return sorted.filter((o) => selection.has(o.id) || intersects(objectBounds(o), padded))
  }, [sorted, viewport, viewSize, selection])

  // Handles depend on what's selected: images resize only proportionally (corner handles)
  // and rotate; board cards resize freely and don't rotate.
  const transformable = useMemo(
    () => (board?.objects ?? []).filter((o) => selection.has(o.id) && !o.locked),
    [board?.objects, selection]
  )
  const keepRatio = transformable.some((o) => lockedAspectRatio(o) !== null)
  const rotateEnabled = transformable.length > 0 && transformable.every(canRotate)

  // Attach resize handles to the selected, unlocked objects (hidden while dragging).
  useEffect(() => {
    const tr = transformer.current
    const layer = objectLayer.current
    if (!tr || !layer) return
    const targets = drag
      ? []
      : layer.find((node: Konva.Node) => {
          if (!node.hasName('object')) return false
          const o = board?.objects.find((x) => x.id === node.id())
          return !!o && selection.has(o.id) && !o.locked
        })
    tr.nodes(targets)
    tr.getLayer()?.batchDraw()
  }, [selection, board?.objects, drag, visible])

  if (!board) return null

  // ── Pointer handling ───────────────────────────────────────────────────────

  const pointer = (e: { clientX: number; clientY: number }): Point => {
    const rect = container.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const objectIdOf = (target: Konva.Node): string | undefined => {
    if (target.hasName('object-title')) return target.getAttr('objectId')
    const node = target.hasName('object') ? target : target.findAncestor('.object')
    return node?.id()
  }

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const evt = e.evt
    // Let the resize handles do their own thing.
    if (e.target.findAncestor('Transformer')) return
    container.current?.focus()
    const screen = pointer(evt)
    const { viewport: vp, selection: current, setSelection, setMarquee } = useCanvasStore.getState()

    if (evt.button === 1 || (evt.button === 0 && isSpaceHeld())) {
      evt.preventDefault()
      gesture.current = { kind: 'pan', start: screen, origin: { x: vp.x, y: vp.y } }
      return listen()
    }
    if (evt.button !== 0) return

    const world = screenToWorld(screen, vp)
    const id = objectIdOf(e.target)
    const objectsNow = useWorkspaceStore.getState().board?.objects ?? []

    if (id) {
      const group = expandToGroups([id], objectsNow)
      let next = new Set(current)
      if (evt.shiftKey) {
        const remove = current.has(id)
        for (const g of group) {
          if (remove) next.delete(g)
          else next.add(g)
        }
      } else if (!current.has(id)) {
        next = group
      }
      setSelection(next)
      const draggable = objectsNow.filter((o) => next.has(o.id) && !o.locked)
      if (!next.has(id) || draggable.length === 0) return
      gesture.current = {
        kind: 'drag',
        ids: draggable.map((o) => o.id),
        start: world,
        startScreen: screen,
        origins: new Map(
          draggable.map((o) => [
            o.id,
            { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation }
          ])
        ),
        moved: false,
        clickedId: id,
        additive: evt.shiftKey
      }
      return listen()
    }

    // Empty canvas: marquee selection.
    const base = evt.shiftKey ? new Set(current) : new Set<string>()
    if (!evt.shiftKey) setSelection([])
    setMarquee(rectFromPoints(world, world))
    gesture.current = { kind: 'marquee', start: world, base }
    listen()
  }

  const listen = () => {
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const onMove = (evt: MouseEvent) => {
    const g = gesture.current
    if (!g) return
    const screen = pointer(evt)
    const state = useCanvasStore.getState()
    const vp = state.viewport

    if (g.kind === 'pan') {
      state.setViewport({
        ...vp,
        x: g.origin.x + screen.x - g.start.x,
        y: g.origin.y + screen.y - g.start.y
      })
      return
    }

    const world = screenToWorld(screen, vp)

    if (g.kind === 'marquee') {
      const rect = rectFromPoints(g.start, world)
      state.setMarquee(rect)
      const objectsNow = useWorkspaceStore.getState().board?.objects ?? []
      const hit = objectsNow
        .filter((o) => !o.locked && intersects(objectBounds(o), rect))
        .map((o) => o.id)
      state.setSelection(new Set([...g.base, ...expandToGroups(hit, objectsNow)]))
      return
    }

    // Dragging objects.
    if (!g.moved) {
      const distance = Math.hypot(screen.x - g.startScreen.x, screen.y - g.startScreen.y)
      if (distance < DRAG_THRESHOLD) return
      g.moved = true
    }
    let dx = world.x - g.start.x
    let dy = world.y - g.start.y
    let guides: ReturnType<typeof smartSnap>['guides'] = []
    const moving = boundsOf([...g.origins.values()].map(objectBounds))!
    const objectsNow = useWorkspaceStore.getState().board?.objects ?? []
    const dragged = new Set(g.ids)

    if (!evt.altKey) {
      if (state.snapToGrid) {
        dx = snapToGrid(moving.x + dx, GRID_SIZE) - moving.x
        dy = snapToGrid(moving.y + dy, GRID_SIZE) - moving.y
      } else {
        const area = visibleWorld(vp, state.viewSize)
        const others = objectsNow
          .filter((o) => !dragged.has(o.id))
          .map(objectBounds)
          .filter((b) => intersects(b, area))
        const snap = smartSnap(
          { ...moving, x: moving.x + dx, y: moving.y + dy },
          others,
          SNAP_DISTANCE / vp.zoom
        )
        dx += snap.dx
        dy += snap.dy
        guides = snap.guides
      }
    }

    // Where would a drop nest the cards? A board card on the canvas, or a board in the
    // sidebar/breadcrumb (marked with data-drop-board-id).
    const draggedBoards = new Set(
      objectsNow.filter((o) => dragged.has(o.id)).map((o) => o.linkedBoardId)
    )
    const domTarget = (
      document.elementFromPoint(evt.clientX, evt.clientY) as HTMLElement | null
    )?.closest<HTMLElement>('[data-drop-board-id]')?.dataset.dropBoardId
    const dropBoardId =
      domTarget && domTarget !== board.id && !draggedBoards.has(domTarget) ? domTarget : undefined
    const dropCard = dropBoardId ? undefined : findDropTarget(objectsNow, dragged, world)

    state.setDrag({
      ids: g.ids,
      dx,
      dy,
      guides: dropCard || dropBoardId ? [] : guides,
      dropCardId: dropCard?.id,
      dropBoardId
    })
  }

  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    const g = gesture.current
    gesture.current = null
    const state = useCanvasStore.getState()

    if (g?.kind === 'marquee') {
      state.setMarquee(null)
      return
    }
    lastPressDragged.current = g?.kind === 'drag' && g.moved
    if (g?.kind !== 'drag') return

    if (!g.moved) {
      // A plain click inside a multi-selection selects just that item (and its group).
      if (!g.additive) actions.selectWithGroups([g.clickedId])
      return
    }
    const finished = state.drag
    if (finished?.dropBoardId) {
      void actions.nestObjects(g.ids, finished.dropBoardId)
    } else if (finished?.dropCardId) {
      const target = board.objects.find((o) => o.id === finished.dropCardId)?.linkedBoardId
      if (target) void actions.nestObjects(g.ids, target)
    } else if (finished && (finished.dx || finished.dy)) {
      void actions.applyPatches(
        g.ids.map((id) => {
          const o = g.origins.get(id)!
          return { id, x: o.x + finished.dx, y: o.y + finished.dy }
        }),
        'Move'
      )
    }
    state.setDrag(null)
  }

  const onDoubleClick = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (lastPressDragged.current) return
    const id = objectIdOf(e.target)
    const object = board.objects.find((o) => o.id === id)
    if (object?.type === 'board' && object.linkedBoardId) void openBoard(object.linkedBoardId)
    else if (object && isViewable(object)) useCanvasStore.getState().setViewerObjectId(object.id)
  }

  const onContextMenu = (e: Konva.KonvaEventObject<PointerEvent>) => {
    // Pick what the menu applies to; the Radix menu around the canvas then opens.
    const id = objectIdOf(e.target)
    const state = useCanvasStore.getState()
    contextPoint.current = screenToWorld(pointer(e.evt), state.viewport)
    if (!id) state.setSelection([])
    else if (!state.selection.has(id)) actions.selectWithGroups([id])
  }

  const onTransformEnd = () => {
    const nodes = transformer.current?.nodes() ?? []
    let rotated = false
    const patches = nodes.map((node) => {
      const object = board.objects.find((o) => o.id === node.id())
      const width = Math.max(1, node.width() * node.scaleX())
      const ratio = object ? lockedAspectRatio(object) : null
      const patch = {
        id: node.id(),
        x: node.x(),
        y: node.y(),
        width,
        height: ratio ? width / ratio : Math.max(1, node.height() * node.scaleY()),
        rotation: normalizeRotation(node.rotation())
      }
      if (object && patch.rotation !== object.rotation) rotated = true
      node.scale({ x: 1, y: 1 })
      return patch
    })
    void actions.applyPatches(patches, rotated ? 'Rotate' : 'Resize')
  }

  // ── HTML5 drops: the toolbar's "Board" tile, and files from File Explorer / Finder ──

  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types
    if (types.includes(NEW_OBJECT_MIME) || types.includes('Files')) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    }
  }

  const onDrop = (e: React.DragEvent) => {
    const world = screenToWorld(pointer(e), useCanvasStore.getState().viewport)
    if (e.dataTransfer.files.length > 0) {
      e.preventDefault()
      void actions.importDroppedFiles([...e.dataTransfer.files], world)
      return
    }
    if (e.dataTransfer.getData(NEW_OBJECT_MIME) !== 'board') return
    e.preventDefault()
    void actions.createBoardOnCanvas(world)
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const renamingCard =
    renaming?.type === 'board' && renaming.source === 'board'
      ? board.objects.find((o) => o.linkedBoardId === renaming.id)
      : undefined

  const positionOf = (o: CanvasObject) =>
    drag?.ids.includes(o.id) ? { x: o.x + drag.dx, y: o.y + drag.dy } : { x: o.x, y: o.y }

  return (
    <div
      ref={(el) => {
        container.current = el
        setContainerEl(el)
      }}
      tabIndex={0}
      aria-label={`Canvas for ${board.title}`}
      data-testid="canvas"
      className="relative h-full w-full overflow-hidden bg-canvas outline-none"
      style={{ cursor: drag ? 'grabbing' : undefined }}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      {viewSize.width > 0 && (
        <Stage
          ref={stage}
          width={viewSize.width}
          height={viewSize.height}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.zoom}
          scaleY={viewport.zoom}
          onMouseDown={onMouseDown}
          onDblClick={onDoubleClick}
          onContextMenu={onContextMenu}
        >
          {showGrid && (
            <Layer listening={false}>
              <GridDots />
            </Layer>
          )}
          <Layer ref={objectLayer}>
            {visible.map((o) =>
              o.type === 'image' ? (
                <ImageNode
                  key={o.id}
                  object={o}
                  {...positionOf(o)}
                  faded={cut.has(o.id)}
                  zoom={viewport.zoom}
                />
              ) : (
                <BoardCardNode
                  key={o.id}
                  object={o}
                  {...positionOf(o)}
                  dropTarget={drag?.dropCardId === o.id}
                  faded={cut.has(o.id)}
                  hideTitle={renamingCard?.id === o.id}
                  zoom={viewport.zoom}
                />
              )
            )}
            <Transformer
              ref={transformer}
              rotateEnabled={rotateEnabled}
              // Shift while rotating snaps to 15° steps (built into Konva). With keepRatio on,
              // Shift can't unlock the proportions.
              keepRatio={keepRatio}
              enabledAnchors={keepRatio ? CORNER_ANCHORS : ALL_ANCHORS}
              flipEnabled={false}
              ignoreStroke
              borderStroke={COLORS.accent}
              anchorStroke={COLORS.accent}
              anchorSize={9}
              anchorCornerRadius={2}
              rotateAnchorOffset={24}
              boundBoxFunc={(oldBox, newBox) =>
                // Proportional boxes only need their longest side to stay usable, so thin
                // images (banners, strips) can still be resized.
                (
                  keepRatio
                    ? Math.max(newBox.width, newBox.height) < MIN_RESIZE
                    : newBox.width < MIN_RESIZE || newBox.height < MIN_RESIZE
                )
                  ? oldBox
                  : newBox
              }
              onTransformEnd={onTransformEnd}
            />
          </Layer>
          <Layer listening={false}>
            {/* Selection outlines for locked items (they get no resize handles). */}
            {board.objects
              .filter((o) => o.locked && selection.has(o.id))
              .map((o) => (
                <Rect
                  key={`sel-${o.id}`}
                  {...positionOf(o)}
                  width={o.width}
                  height={o.height}
                  rotation={o.rotation}
                  stroke={COLORS.accent}
                  dash={[4 / viewport.zoom, 4 / viewport.zoom]}
                  strokeWidth={1.5 / viewport.zoom}
                  cornerRadius={o.type === 'board' ? 12 : 0}
                />
              ))}
            {drag?.guides.map((g, i) =>
              g.orientation === 'vertical' ? (
                <Line
                  key={i}
                  points={[g.position, g.from, g.position, g.to]}
                  stroke="#e5484d"
                  strokeWidth={1 / viewport.zoom}
                />
              ) : (
                <Line
                  key={i}
                  points={[g.from, g.position, g.to, g.position]}
                  stroke="#e5484d"
                  strokeWidth={1 / viewport.zoom}
                />
              )
            )}
            {marquee && (
              <Rect
                {...marquee}
                fill={COLORS.accentSoft}
                stroke={COLORS.accent}
                strokeWidth={1 / viewport.zoom}
              />
            )}
          </Layer>
        </Stage>
      )}

      {renamingCard && (
        <div
          className="absolute"
          style={{
            left: worldToScreen(renamingCard, viewport).x,
            top:
              worldToScreen({ x: 0, y: renamingCard.y + renamingCard.height + TITLE_GAP }, viewport)
                .y - 2,
            width: Math.max(120, renamingCard.width * viewport.zoom),
            fontSize: Math.max(12, TITLE_FONT_SIZE * viewport.zoom)
          }}
        >
          <EditableTitle
            value={renamingCard.board?.title ?? ''}
            ariaLabel="Board name"
            onCommit={(v) => void actions.renameBoard(renaming!.id, v)}
            onCancel={() => setRenaming(null)}
            className="font-medium"
          />
        </div>
      )}
    </div>
  )
}

const CORNER_ANCHORS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const ALL_ANCHORS = [
  ...CORNER_ANCHORS,
  'top-center',
  'middle-right',
  'bottom-center',
  'middle-left'
]

/** Rotation in degrees between -180 and 180, tidied to two decimals. */
function normalizeRotation(degrees: number): number {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180
  return Math.round(wrapped * 100) / 100
}

/** MIME type used when dragging a new object from the toolbar onto the canvas. */
export const NEW_OBJECT_MIME = 'application/x-cw-new-object'

/** Where the last right-click happened, in world coordinates ("New board here", "Paste here"). */
export const contextPoint: { current: Point | null } = { current: null }

/** Dot grid covering the visible area; spacing grows when zoomed out so it stays readable. */
function GridDots() {
  const viewport = useCanvasStore((s) => s.viewport)
  const viewSize = useCanvasStore((s) => s.viewSize)
  return (
    <Shape
      perfectDrawEnabled={false}
      sceneFunc={(ctx) => {
        let spacing = GRID_SIZE
        while (spacing * viewport.zoom < 12) spacing *= 5
        const area = visibleWorld(viewport, viewSize)
        const startX = Math.floor(area.x / spacing) * spacing
        const startY = Math.floor(area.y / spacing) * spacing
        const radius = 1.1 / viewport.zoom
        ctx.fillStyle = '#d6d3cc'
        ctx.beginPath()
        for (let x = startX; x <= area.x + area.width; x += spacing) {
          for (let y = startY; y <= area.y + area.height; y += spacing) {
            ctx.moveTo(x + radius, y)
            ctx.arc(x, y, radius, 0, Math.PI * 2)
          }
        }
        ctx.fill()
      }}
    />
  )
}
