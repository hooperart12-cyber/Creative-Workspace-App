/** Note commands for the canvas (create, whole-note look, sizing). All undoable (§20). */
import {
  DEFAULT_APPEARANCE,
  NEW_NOTE_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  readNote,
  type NoteAppearance,
  type NoteSizing
} from '@shared/notes'
import type { CanvasObject, NoteStylePatch, Point } from '@shared/types'
import { applyPatches, currentObjects, record, run, viewCenter } from '../canvas/actions'
import { useCanvasStore } from '../store/canvasStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import { noteContentHeight } from './measure'
import { beginEditing, endEditing } from './session'

const api = () => window.api

/** Where the text cursor sits inside a new note, from its top-left corner. */
const TEXT_INSET = { x: 17, y: 28 }

/**
 * Creates a note and starts typing in it. `point` is where the text should start (a click),
 * or the middle of the note (toolbar, shortcut) when `centered`.
 */
export async function createNote(point?: Point, centered = !point): Promise<void> {
  const board = useWorkspaceStore.getState().board
  if (!board || !(await endEditing())) return
  const p = point ?? viewCenter()
  const at = centered
    ? { x: p.x - NOTE_DEFAULT_WIDTH / 2, y: p.y - NEW_NOTE_HEIGHT / 2 }
    : { x: p.x - TEXT_INSET.x, y: p.y - TEXT_INSET.y }
  let created: CanvasObject | undefined
  await run(async () => {
    created = await api().invoke('notes:create', {
      boardId: board.id,
      at: { x: Math.round(at.x), y: Math.round(at.y) }
    })
    useWorkspaceStore.getState().addObject(created)
    useCanvasStore.getState().setSelection([created.id])
  })
  if (created) await beginEditing(created.id, { isNew: true })
}

/** Starts editing the one selected note (Enter), inline or in the expanded editor. */
export function editSelectedNote(mode: 'inline' | 'expanded' = 'inline'): boolean {
  const selection = useCanvasStore.getState().selection
  if (selection.size !== 1) return false
  const [id] = selection
  const object = currentObjects().find((o) => o.id === id)
  if (object?.type !== 'text') return false
  void beginEditing(id, { mode })
  return true
}

/**
 * Changes the whole-note look or sizing mode of notes. Auto-height notes get the height
 * their text needs with the new look (padding and border change it).
 */
export function updateNoteStyle(
  ids: string[],
  change: { appearance?: Partial<NoteAppearance>; sizing?: NoteSizing },
  label: string
): Promise<void> {
  return run(async () => {
    const forward: NoteStylePatch[] = []
    const backward: NoteStylePatch[] = []
    for (const object of currentObjects()) {
      if (!ids.includes(object.id) || object.type !== 'text') continue
      const read = readNote(object.data)
      if (!read.ok) continue
      const appearance = { ...read.note.appearance, ...change.appearance }
      const sizing = change.sizing ?? read.note.sizing
      const height = sizing === 'auto' ? noteContentHeight(object, { appearance }) : object.height
      forward.push({
        id: object.id,
        ...(change.appearance ? { appearance } : {}),
        ...(change.sizing ? { sizing } : {}),
        height
      })
      backward.push({
        id: object.id,
        ...(change.appearance ? { appearance: read.note.appearance } : {}),
        ...(change.sizing ? { sizing: read.note.sizing } : {}),
        height: object.height
      })
    }
    if (forward.length === 0) return
    applyStyleLocally(forward)
    await api().invoke('notes:updateStyle', forward)
    record({
      label,
      undo: () => api().invoke('notes:updateStyle', backward),
      redo: () => api().invoke('notes:updateStyle', forward)
    })
  })
}

/** Shows a look change straight away, before it's saved (and while a slider is dragged). */
export function applyStyleLocally(patches: NoteStylePatch[]): void {
  const workspace = useWorkspaceStore.getState()
  const objects = new Map(currentObjects().map((o) => [o.id, o]))
  workspace.patchObjectData(
    patches.map((p) => {
      const object = objects.get(p.id)
      const read = object ? readNote(object.data) : null
      const appearance = read?.ok ? { ...read.note.appearance, ...p.appearance } : p.appearance
      return {
        id: p.id,
        data: { ...(appearance ? { appearance } : {}), ...(p.sizing ? { sizing: p.sizing } : {}) }
      }
    })
  )
  workspace.patchObjects(
    patches.flatMap((p) => (p.height !== undefined ? [{ id: p.id, height: p.height }] : []))
  )
}

/** Puts the default look back. The text and its formatting stay as they are. */
export function resetNoteAppearance(ids: string[]): Promise<void> {
  return updateNoteStyle(ids, { appearance: { ...DEFAULT_APPEARANCE } }, 'Reset appearance')
}

/** Makes fixed-height notes exactly as tall as their text. */
export function fitNotesToContent(ids: string[]): Promise<void> {
  const patches = currentObjects()
    .filter((o) => ids.includes(o.id) && o.type === 'text' && !o.locked)
    .flatMap((o) => {
      const height = noteContentHeight(o)
      return Math.abs(o.height - height) > 0.5 ? [{ id: o.id, height }] : []
    })
  return applyPatches(patches, 'Fit to content')
}

export const isNote = (o: CanvasObject): boolean => o.type === 'text'
