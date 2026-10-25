import type { ReactNode } from 'react'
import type { CanvasObject, Viewport } from '@shared/types'
import { worldToScreen } from '../canvas/geometry'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { NoteFormatPanel } from './NoteFormatPanel'
import { useNoteStore } from './noteStore'
import { FormatButtons, LinkEditor, NoteNotices, SaveStatusBadge } from './NoteToolbar'
import { takeOverNote, useEditedObject, useNoteEditor } from './session'

/** Space kept between a note and the bars beside it, in screen pixels. */
const GAP = 10
/** Room the toolbar (and a notice) needs above a note before it moves below it. */
const ROOM_ABOVE = 104

/**
 * Everything shown around a note being edited on the canvas: the quick toolbar, the link
 * editor, save problems, and the advanced panel. Also the bar offered when a note is being
 * edited in another window.
 */
export function NoteChrome() {
  const editing = useNoteStore((s) => s.editing)
  const blocked = useNoteStore((s) => s.blocked)
  const panelOpen = useNoteStore((s) => s.panelOpen)
  const linkEditorOpen = useNoteStore((s) => s.linkEditorOpen)
  const editor = useNoteEditor()
  const viewport = useCanvasStore((s) => s.viewport)
  const viewSize = useCanvasStore((s) => s.viewSize)
  const edited = useEditedObject()
  const blockedObject = useWorkspaceStore((s) =>
    blocked ? s.board?.objects.find((o) => o.id === blocked) : undefined
  )
  const object = editing ? edited : blockedObject

  if (!object) return null

  if (!editing) {
    return (
      <Beside object={object} viewport={viewport} height={viewSize.height}>
        <div
          role="alert"
          data-testid="note-blocked"
          className="flex items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-sm"
        >
          <span>This note is being edited in another window.</span>
          <button
            type="button"
            onClick={() => void takeOverNote(object.id)}
            className="rounded-md bg-accent px-2.5 py-1 text-xs whitespace-nowrap text-white"
          >
            Edit here instead
          </button>
          <button
            type="button"
            onClick={() => useNoteStore.setState({ blocked: null })}
            className="rounded-md px-2 py-1 text-xs hover:bg-canvas"
          >
            Cancel
          </button>
        </div>
      </Beside>
    )
  }

  if (editing.mode !== 'inline' || !editor) return null
  return (
    <>
      <Beside object={object} viewport={viewport} height={viewSize.height}>
        <div
          role="toolbar"
          aria-label="Text formatting"
          data-testid="note-toolbar"
          className="flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm"
        >
          <FormatButtons editor={editor} />
          <SaveStatusBadge />
        </div>
        {linkEditorOpen && <LinkEditor editor={editor} />}
        <NoteNotices />
      </Beside>
      {panelOpen && (
        <div data-note-ui className="absolute top-3 right-3 bottom-16 z-20 flex">
          <NoteFormatPanel editor={editor} object={object} />
        </div>
      )}
    </>
  )
}

/**
 * Keeps bars next to a note on screen: above it if there's room, otherwise below it,
 * otherwise along the top of the canvas.
 */
function Beside({
  object,
  viewport,
  height,
  children
}: {
  object: CanvasObject
  viewport: Viewport
  height: number
  children: ReactNode
}) {
  const box = screenBounds(object, viewport)
  const centre = (box.left + box.right) / 2
  const above = box.top - GAP >= ROOM_ABOVE
  const below = !above && box.bottom + GAP + ROOM_ABOVE <= height
  const style: React.CSSProperties = above
    ? { bottom: height - box.top + GAP }
    : below
      ? { top: box.bottom + GAP }
      : { top: 12 }
  return (
    <div
      data-note-ui
      className="pointer-events-none absolute right-3 left-3 z-20 flex flex-col items-center"
      style={style}
    >
      <div
        className="pointer-events-auto flex flex-col items-center gap-1.5"
        style={{ transform: `translateX(${offsetTowards(centre)}px)` }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * Horizontal shift from the canvas centre to the note's centre. The bars sit in a full-width
 * row (so they never run off the side); this moves them towards the note.
 */
function offsetTowards(centre: number): number {
  const width = useCanvasStore.getState().viewSize.width
  const offset = centre - width / 2
  const limit = Math.max(0, width / 2 - 260)
  return Math.max(-limit, Math.min(limit, offset))
}

/** The note's on-screen bounding box (rotated notes included). */
function screenBounds(o: CanvasObject, viewport: Viewport) {
  const r = (o.rotation * Math.PI) / 180
  const corners = [
    [0, 0],
    [o.width, 0],
    [0, o.height],
    [o.width, o.height]
  ].map(([x, y]) =>
    worldToScreen(
      { x: o.x + x * Math.cos(r) - y * Math.sin(r), y: o.y + x * Math.sin(r) + y * Math.cos(r) },
      viewport
    )
  )
  return {
    left: Math.min(...corners.map((c) => c.x)),
    right: Math.max(...corners.map((c) => c.x)),
    top: Math.min(...corners.map((c) => c.y)),
    bottom: Math.max(...corners.map((c) => c.y))
  }
}
