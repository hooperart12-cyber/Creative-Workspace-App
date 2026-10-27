import type { ReactNode } from 'react'
import { useCanvasStore, history } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import * as actions from './actions'
import { NEW_OBJECT_MIME } from './CanvasView'
import { BoardIcon } from '../components/icons'
import { createNote } from '../notes/noteActions'
import { useNoteStore } from '../notes/noteStore'
import type { TagVisibility } from '@shared/types'
import { reportError } from '../store/projectStore'

const toolButton =
  'flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-canvas hover:text-ink disabled:opacity-30 aria-pressed:bg-accent/10 aria-pressed:text-accent'

/** Left toolbar: drag (or click) to add objects; grid and snap toggles; undo/redo. */
export function CanvasToolbar() {
  const showGrid = useCanvasStore((s) => s.showGrid)
  const snapToGrid = useCanvasStore((s) => s.snapToGrid)
  const toggleGrid = useCanvasStore((s) => s.toggleGrid)
  const toggleSnap = useCanvasStore((s) => s.toggleSnap)
  useCanvasStore((s) => s.historyVersion) // re-render when undo/redo availability changes
  const editingText = useNoteStore((s) => s.editing !== null)
  const board = useWorkspaceStore((s) => s.board)

  return (
    <div
      role="toolbar"
      aria-label="Canvas tools"
      aria-orientation="vertical"
      className="absolute top-3 left-3 z-10 flex flex-col items-center gap-1 rounded-xl border border-line bg-surface p-1.5 shadow-sm"
    >
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(NEW_OBJECT_MIME, 'board')
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => void actions.createBoardOnCanvas()}
        title="Board: drag onto the canvas, or click to add in the middle"
        aria-label="Add board"
        className="flex w-14 cursor-grab flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] text-ink hover:bg-canvas active:cursor-grabbing"
      >
        <BoardIcon width={20} height={20} className="text-accent" />
        Board
      </button>
      <button
        onClick={(e) => {
          // Let canvas shortcuts (Delete, Shift+1…) act on the new images straight away.
          e.currentTarget.blur()
          void actions.addImagesFromPicker()
        }}
        title="Image: choose JPG, PNG or WebP files (you can also drop or paste images)"
        aria-label="Add images"
        className="flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] text-ink hover:bg-canvas"
      >
        <ImageIcon />
        Image
      </button>
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(NEW_OBJECT_MIME, 'text')
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => void createNote()}
        title="Text (T): drag onto the canvas, or click to add in the middle. Double-click the canvas to type anywhere."
        aria-label="Add text"
        className="flex w-14 cursor-grab flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] text-ink hover:bg-canvas active:cursor-grabbing"
      >
        <TextIcon />
        Text
      </button>
      <button
        onClick={(e) => {
          e.currentTarget.blur()
          void actions.addFilesFromPicker()
        }}
        title="File: store a PDF or any other file. Drop files on the canvas too."
        aria-label="Add files"
        className="flex w-14 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 text-[11px] text-ink hover:bg-canvas"
      >
        <FileIcon />
        File
      </button>
      <Divider />
      <button
        className={toolButton}
        aria-pressed={showGrid}
        onClick={toggleGrid}
        title="Show grid (Ctrl+')"
        aria-label="Show grid"
      >
        <GridIcon />
      </button>
      <button
        className={toolButton}
        aria-pressed={snapToGrid}
        onClick={toggleSnap}
        title="Snap to grid (otherwise objects snap to each other). Hold Alt while dragging to turn snapping off."
        aria-label="Snap to grid"
      >
        <MagnetIcon />
      </button>
      <Divider />
      <button
        className={toolButton}
        disabled={!history.canUndo || editingText}
        onClick={() => void actions.undo()}
        title={editingText ? 'While typing, Ctrl+Z undoes typing' : 'Undo (Ctrl+Z)'}
        aria-label="Undo"
      >
        <UndoIcon />
      </button>
      <button
        className={toolButton}
        disabled={!history.canRedo || editingText}
        onClick={() => void actions.redo()}
        title={editingText ? 'While typing, Ctrl+Shift+Z redoes typing' : 'Redo (Ctrl+Shift+Z)'}
        aria-label="Redo"
      >
        <UndoIcon style={{ transform: 'scaleX(-1)' }} />
      </button>
      <Divider />
      <select
        aria-label="Tag visibility"
        value={board?.tagVisibility ?? 'hover'}
        onChange={(event) => {
          if (!board) return
          void window.api
            .invoke('tags:visibility', board.id, event.target.value as TagVisibility)
            .catch(reportError)
        }}
        className="w-14 rounded border border-line bg-surface text-[10px]"
        title="How tag labels are shown on this board"
      >
        <option value="hidden">Hide</option>
        <option value="hover">Hover</option>
        <option value="always">Always</option>
      </select>
    </div>
  )
}

/** Bottom-right zoom controls. */
export function ZoomControl() {
  const zoom = useCanvasStore((s) => s.viewport.zoom)
  return (
    <div className="absolute right-3 bottom-3 z-10 flex items-center gap-0.5 rounded-xl border border-line bg-surface p-1 text-sm shadow-sm">
      <button
        className={toolButton}
        onClick={() => actions.zoomStepAtCenter(-1)}
        title="Zoom out (−)"
        aria-label="Zoom out"
      >
        −
      </button>
      <button
        className="min-w-14 rounded-lg px-2 py-1.5 tabular-nums hover:bg-canvas"
        onClick={actions.zoomToActualSize}
        title="Zoom to 100% (Ctrl+0)"
        aria-label={`Zoom ${Math.round(zoom * 100)}%, reset to 100%`}
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        className={toolButton}
        onClick={() => actions.zoomStepAtCenter(1)}
        title="Zoom in (+)"
        aria-label="Zoom in"
      >
        +
      </button>
      <button
        className="rounded-lg px-2 py-1.5 hover:bg-canvas"
        onClick={actions.fitAll}
        title="Fit everything (Shift+1)"
      >
        Fit
      </button>
    </div>
  )
}

/** Floating bar shown when two or more objects are selected: align, distribute, match size. */
export function ArrangeBar() {
  const count = useCanvasStore((s) => s.selection.size)
  const dragging = useCanvasStore((s) => s.drag !== null)
  const board = useWorkspaceStore((s) => s.board)
  if (count < 2 || dragging || !board) return null

  const button = (
    label: string,
    title: string,
    onClick: () => void,
    disabled = false
  ): ReactNode => (
    <button
      key={label}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      className="rounded-md px-2 py-1 text-xs whitespace-nowrap hover:bg-canvas disabled:opacity-30"
    >
      {label}
    </button>
  )

  return (
    <div
      role="toolbar"
      aria-label="Arrange selection"
      className="absolute top-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-0.5 rounded-xl border border-line bg-surface p-1 shadow-sm"
    >
      <span className="px-2 text-xs text-muted">{count} selected</span>
      <Divider vertical />
      {button('⇤', 'Align left', () => void actions.alignSelection('left'))}
      {button('↔', 'Align horizontal centres', () => void actions.alignSelection('hcenter'))}
      {button('⇥', 'Align right', () => void actions.alignSelection('right'))}
      {button('⤒', 'Align top', () => void actions.alignSelection('top'))}
      {button('↕', 'Align vertical centres', () => void actions.alignSelection('vcenter'))}
      {button('⤓', 'Align bottom', () => void actions.alignSelection('bottom'))}
      <Divider vertical />
      {button(
        'Distribute ↔',
        'Distribute horizontally (equal gaps)',
        () => void actions.distributeSelection('horizontal'),
        count < 3
      )}
      {button(
        'Distribute ↕',
        'Distribute vertically (equal gaps)',
        () => void actions.distributeSelection('vertical'),
        count < 3
      )}
      <Divider vertical />
      {button(
        'Same width',
        'Match widths (to the widest)',
        () => void actions.matchSizeSelection('width')
      )}
      {button(
        'Same height',
        'Match heights (to the tallest)',
        () => void actions.matchSizeSelection('height')
      )}
      <Divider vertical />
      {button('Group', 'Group (Ctrl+G)', () => void actions.groupSelection())}
    </div>
  )
}

function Divider({ vertical }: { vertical?: boolean }) {
  return vertical ? (
    <span className="mx-0.5 h-5 w-px bg-line" />
  ) : (
    <span className="my-0.5 h-px w-7 bg-line" />
  )
}

const svg = {
  width: 18,
  height: 18,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
}

function GridIcon() {
  return (
    <svg {...svg}>
      <circle cx="6" cy="6" r="1" />
      <circle cx="12" cy="6" r="1" />
      <circle cx="18" cy="6" r="1" />
      <circle cx="6" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="18" cy="12" r="1" />
      <circle cx="6" cy="18" r="1" />
      <circle cx="12" cy="18" r="1" />
      <circle cx="18" cy="18" r="1" />
    </svg>
  )
}

function MagnetIcon() {
  return (
    <svg {...svg}>
      <path d="m6 15-4-4 6.75-6.77a7.79 7.79 0 0 1 11 11L13 22l-4-4 6.39-6.36a2.14 2.14 0 0 0-3-3L6 15" />
      <path d="m5 8 4 4M12 15l4 4" />
    </svg>
  )
}

function ImageIcon() {
  return (
    <svg {...svg} width={20} height={20} className="text-accent">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.09-3.09a2 2 0 0 0-2.82 0L6 21" />
    </svg>
  )
}

function FileIcon() {
  return (
    <svg {...svg} width={20} height={20} className="text-accent">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

function TextIcon() {
  return (
    <svg {...svg} width={20} height={20} className="text-accent">
      <path d="M5 6V4h14v2M12 4v16M9 20h6" />
    </svg>
  )
}

function UndoIcon(props: { style?: React.CSSProperties }) {
  return (
    <svg {...svg} style={props.style}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </svg>
  )
}
