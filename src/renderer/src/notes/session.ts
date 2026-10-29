/**
 * Editing a note (ADR-014). One note is edited at a time per window, by one Tiptap editor
 * that the inline overlay and the expanded editor both show, so switching between them keeps
 * the typing history.
 *
 * Saving: changes are saved shortly after typing pauses (and at least every few seconds while
 * typing continues). One save runs at a time, in the same queue as canvas edits, so saves can't
 * arrive out of order and a canvas action never overtakes a pending save. Each save names the
 * revision it was based on; if another window saved first, nothing is overwritten and the user
 * chooses what to keep.
 *
 * Undo: while editing, Ctrl+Z undoes typing. When editing ends, the whole session becomes one
 * canvas step ("Edit text", or "Add note" for a new note).
 */
import { destinationFromHref } from '@shared/destinations'
import { Extension } from '@tiptap/core'
import { Placeholder } from '@tiptap/extensions'
import { Selection } from '@tiptap/pm/state'
import { Editor } from '@tiptap/react'
import { useSyncExternalStore } from 'react'
import {
  NOTE_SCHEMA_VERSION,
  isEmptyDoc,
  plainTextOf,
  readNote,
  sameDoc,
  type NoteContent,
  type RichNode
} from '@shared/notes'
import type { CanvasObject, SaveNoteResult } from '@shared/types'
import { currentObjects, queued, record } from '../canvas/actions'
import { worldToScreen, zoomAt } from '../canvas/geometry'
import { messageOf } from '../lib/errors'
import { useCanvasStore } from '../store/canvasStore'
import { reportError, showNotice } from '../store/projectStore'
import { setLeaveGuard, useWorkspaceStore } from '../store/workspaceStore'
import { noteExtensions } from './extensions'
import { isAutoHeightNote, noteContentHeight } from './measure'
import { useNoteStore } from './noteStore'
import { cleanPastedHtml } from './paste'

/** Save this long after typing pauses… */
export const SAVE_DELAY_MS = 600
/** …and at least this often while typing continues. */
export const MAX_SAVE_WAIT_MS = 3000
const MAX_RETRY_MS = 15000

const api = () => window.api
const notes = () => useNoteStore.getState()

let editor: Editor | null = null
const editorListeners = new Set<() => void>()
const setEditor = (next: Editor | null) => {
  editor = next
  for (const listener of editorListeners) listener()
}

/** The editor of the note being edited (null when nothing is being edited). */
export function useNoteEditor(): Editor | null {
  return useSyncExternalStore(
    (listener) => {
      editorListeners.add(listener)
      return () => editorListeners.delete(listener)
    },
    () => editor
  )
}

export const currentEditor = (): Editor | null => editor

/** The note being edited: from the board, or its last copy if another window removed it. */
export function useEditedObject(): CanvasObject | undefined {
  const id = useNoteStore((s) => s.editing?.objectId)
  const live = useWorkspaceStore((s) =>
    id ? s.board?.objects.find((o) => o.id === id) : undefined
  )
  const last = useNoteStore((s) => s.lastCopy)
  return live ?? (id && last?.id === id ? last : undefined)
}

/** Text when editing started (for the undo step). */
let startDoc: RichNode | null = null
/** JSON of the last successfully saved text. */
let savedJson = ''
let baseRevision = 0
let saveTimer: ReturnType<typeof setTimeout> | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
let retryDelay = 1000
let dirtySince = 0
let ending: Promise<boolean> | null = null

const docJson = (): string => (editor ? JSON.stringify(editor.getJSON()) : savedJson)
export const hasUnsavedChanges = (): boolean => !!editor && docJson() !== savedJson

// ── Starting ─────────────────────────────────────────────────────────────────

export interface BeginOptions {
  isNew?: boolean
  mode?: 'inline' | 'expanded'
  /** Skip asking for the editing lease (already taken over). */
  leased?: boolean
  /** Put the cursor at this point on screen (where the note was double-clicked). */
  caretAt?: { x: number; y: number }
}

let beginning: { id: string; promise: Promise<boolean> } | null = null

/** Starts editing a note. Returns false if it can't be edited right now. */
export function beginEditing(id: string, options: BeginOptions = {}): Promise<boolean> {
  // A second request while the first is still starting (e.g. a fast double-click) is the same one.
  if (beginning?.id === id) return beginning.promise
  const promise = startEditing(id, options).finally(() => {
    if (beginning?.promise === promise) beginning = null
  })
  beginning = { id, promise }
  return promise
}

async function startEditing(id: string, options: BeginOptions): Promise<boolean> {
  const current = notes().editing
  if (current?.objectId === id) {
    if (options.mode && options.mode !== current.mode) setMode(options.mode)
    return true
  }
  if (current && !(await endEditing())) return false

  const object = currentObjects().find((o) => o.id === id)
  if (!object || object.type !== 'text') return false
  if (object.locked) {
    showNotice('This note is locked. Unlock it to edit its text.', 5000)
    return false
  }
  try {
    if (!options.leased) {
      const lease = await api().invoke('notes:lease', id, 'acquire')
      if (!lease.ok) {
        useNoteStore.setState({ blocked: id })
        return false
      }
    }
    // Start from the saved version (another window may have saved since this board loaded).
    const [fresh] = await api().invoke('notes:get', [id])
    if (!fresh) throw new Error('This note is no longer on the board.')
    const read = readNote(fresh.data)
    if (!read.ok) {
      void api().invoke('notes:lease', id, 'release')
      showNotice('This note can’t be edited because its text couldn’t be read.', 8000)
      return false
    }
    useWorkspaceStore.getState().replaceObjects([fresh])
    startDoc = read.note.content.doc
    savedJson = JSON.stringify(startDoc)
    baseRevision = fresh.revision
    retryDelay = 1000
    dirtySince = 0
    const created = createEditor(startDoc)
    setEditor(created)
    useNoteStore.setState({
      blocked: null,
      linkEditorOpen: false,
      lastCopy: fresh,
      editing: {
        objectId: id,
        boardId: fresh.boardId,
        mode: options.mode ?? 'inline',
        isNew: !!options.isNew,
        status: 'saved',
        error: null,
        conflict: null,
        deleted: false,
        readOnly: false
      }
    })
    useCanvasStore.getState().setSelection([id])
    if (!options.caretAt)
      zoomInToEdit(worldToScreen(noteCenter(fresh), useCanvasStore.getState().viewport))
    pendingCaret = { editor: created, at: options.caretAt ?? null }
    return true
  } catch (error) {
    void api()
      .invoke('notes:lease', id, 'release')
      .catch(() => {})
    reportError(error)
    return false
  }
}

let pendingCaret: { editor: Editor; at: { x: number; y: number } | null } | null = null

/**
 * Called by the editor as soon as it's on screen: focuses it, with the cursor at the spot that
 * was double-clicked (or at the end). Returns false if there was nothing to place.
 *
 * Done directly rather than with Tiptap's focus command, which focuses a frame later and would
 * put the cursor back where it was if a key moved it in between.
 */
export function placePendingCaret(): boolean {
  const pending = pendingCaret
  if (!pending || pending.editor !== editor || pending.editor.isDestroyed) return false
  pendingCaret = null
  const { view } = pending.editor
  const hit = pending.at && view.posAtCoords({ left: pending.at.x, top: pending.at.y })
  const $pos = view.state.doc.resolve(hit ? hit.pos : view.state.doc.content.size)
  view.dispatch(view.state.tr.setSelection(Selection.near($pos, -1)))
  view.focus()
  return true
}

/** Below this zoom, text is too small to edit: editing zooms in to 100% first. */
const MIN_EDIT_ZOOM = 0.5

/** Zooms in to 100% around a point on screen (it stays put) if the view is too far out to edit. */
export function zoomInToEdit(around: { x: number; y: number }): void {
  const { viewport, setViewport } = useCanvasStore.getState()
  if (viewport.zoom < MIN_EDIT_ZOOM) setViewport(zoomAt(viewport, around, 1))
}

const noteCenter = (o: CanvasObject) => {
  const r = (o.rotation * Math.PI) / 180
  return {
    x: o.x + (o.width / 2) * Math.cos(r) - (o.height / 2) * Math.sin(r),
    y: o.y + (o.width / 2) * Math.sin(r) + (o.height / 2) * Math.cos(r)
  }
}

/** Edits a note another window is editing: that window stops and this one takes over. */
export async function takeOverNote(id: string): Promise<void> {
  try {
    await api().invoke('notes:lease', id, 'takeOver')
    await beginEditing(id, { leased: true })
  } catch (error) {
    reportError(error)
  }
}

export function setMode(mode: 'inline' | 'expanded'): void {
  notes().updateEditing({ mode })
  // The editor moves to its new place on the next render; focus it there.
  requestAnimationFrame(() => {
    if (editor && !editor.isDestroyed) editor.view.focus()
  })
}

// ── Saving ───────────────────────────────────────────────────────────────────

let draftTimer: ReturnType<typeof setTimeout> | undefined

function queueDraft(): void {
  clearTimeout(draftTimer)
  draftTimer = setTimeout(() => {
    const editing = notes().editing
    if (!editing || !editor) return
    const doc = editor.getJSON() as RichNode
    void api().invoke('recovery:writeDraft', {
      objectId: editing.objectId,
      baseRevision,
      content: { schemaVersion: NOTE_SCHEMA_VERSION, doc },
      plainText: plainTextOf(doc),
      writtenAt: Date.now()
    })
  }, 100)
}

function onChange(): void {
  const editing = notes().editing
  if (!editing || editing.readOnly) return
  if (editing.status === 'saved') notes().updateEditing({ status: 'unsaved' })
  queueDraft()
  const now = Date.now()
  if (!dirtySince) dirtySince = now
  clearTimeout(saveTimer)
  const wait = Math.max(0, Math.min(SAVE_DELAY_MS, MAX_SAVE_WAIT_MS - (now - dirtySince)))
  saveTimer = setTimeout(() => void queued(saveNow), wait)
}

/**
 * Saves the editor's text if it changed. Must run inside the edit queue (one save at a time).
 * Leaves the status as 'error' (with retries scheduled), or reports a conflict or deletion.
 */
async function saveNow(): Promise<void> {
  clearTimeout(saveTimer)
  saveTimer = undefined
  const editing = notes().editing
  if (!editing || !editor || editing.conflict || editing.deleted || editing.readOnly) return
  const doc = editor.getJSON() as RichNode
  const json = JSON.stringify(doc)
  dirtySince = 0
  if (json === savedJson) {
    if (editing.status !== 'saved') notes().updateEditing({ status: 'saved', error: null })
    return
  }
  notes().updateEditing({ status: 'saving' })
  const object = currentObjects().find((o) => o.id === editing.objectId)
  const content: NoteContent = { schemaVersion: NOTE_SCHEMA_VERSION, doc }
  const height = object ? noteContentHeight(object, { doc }) : undefined
  let result: SaveNoteResult
  try {
    result = await api().invoke('notes:saveContent', {
      id: editing.objectId,
      baseRevision,
      content,
      height
    })
  } catch (error) {
    notes().updateEditing({ status: 'error', error: messageOf(error) })
    scheduleRetry()
    return
  }
  if (notes().editing?.objectId !== editing.objectId) return
  if (result.ok) {
    baseRevision = result.revision
    savedJson = json
    retryDelay = 1000
    clearTimeout(retryTimer)
    useWorkspaceStore.getState().patchObjectData([
      {
        id: editing.objectId,
        data: { content, plainText: plainTextOf(doc) },
        revision: result.revision
      }
    ])
    if (height !== undefined && object && isAutoHeightNote(object)) {
      useWorkspaceStore.getState().patchObjects([{ id: editing.objectId, height }])
    }
    const stillDirty = docJson() !== savedJson
    notes().updateEditing({ status: stillDirty ? 'unsaved' : 'saved', error: null })
    if (stillDirty) onChange()
    else void api().invoke('recovery:clearDraft', editing.objectId)
  } else if (result.reason === 'conflict') {
    notes().updateEditing({
      status: 'error',
      conflict: { revision: result.revision, content: result.content },
      error: null
    })
  } else {
    notes().updateEditing({ status: 'error', deleted: true, error: null })
  }
}

function scheduleRetry(): void {
  clearTimeout(retryTimer)
  retryTimer = setTimeout(() => void queued(saveNow), retryDelay)
  retryDelay = Math.min(MAX_RETRY_MS, retryDelay * 2)
}

/** Saves now (e.g. "Retry", or before the window closes). */
export function saveNoteNow(): Promise<void> {
  clearTimeout(retryTimer)
  return queued(saveNow)
}

// ── Finishing ────────────────────────────────────────────────────────────────

/**
 * Saves and stops editing. The session becomes one undo step. Returns false (and keeps the
 * editor open) if the text couldn't be saved: nothing the user wrote is ever thrown away
 * without them choosing to.
 */
export function endEditing(): Promise<boolean> {
  if (!notes().editing) return Promise.resolve(true)
  // Queued right away, so an undo pressed straight after waits for this edit to be recorded.
  ending ??= queued(finish).finally(() => {
    ending = null
  })
  return ending
}

async function finish(): Promise<boolean> {
  const editing = notes().editing
  if (!editing) return true
  await saveNow()
  const after = notes().editing
  if (!after) return true
  if (!after.readOnly && (after.conflict || after.deleted || after.status === 'error')) {
    if (after.status === 'error' && !after.conflict && !after.deleted) {
      showNotice(
        'Your latest changes haven’t been saved yet. The note stays open until they are.',
        6000
      )
    }
    return false
  }
  close(after.readOnly)
  const finalDoc = JSON.parse(savedJson) as RichNode
  const id = after.objectId
  if (after.isNew && isEmptyDoc(finalDoc)) {
    // A new note left empty disappears again (nothing to undo).
    await api()
      .invoke('objects:delete', [id])
      .catch(() => {})
    useCanvasStore.getState().setSelection([])
  } else if (after.isNew) {
    record({
      label: 'Add note',
      undo: () => api().invoke('objects:delete', [id]),
      redo: () => api().invoke('objects:restore', [id])
    })
  } else if (startDoc && !sameDoc(startDoc, finalDoc)) {
    record(textCommand(id, startDoc, finalDoc))
  }
  return true
}

/** Closes the editor without saving (after saving, or when the note can't be saved). */
function close(leaseLost: boolean): void {
  const editing = notes().editing
  clearTimeout(saveTimer)
  clearTimeout(retryTimer)
  pendingCaret = null
  if (editing && !leaseLost) {
    void api()
      .invoke('notes:lease', editing.objectId, 'release')
      .catch(() => {})
  }
  editor?.destroy()
  setEditor(null)
  useNoteStore.setState({ editing: null, lastCopy: null, linkEditorOpen: false })
}

/** An undo step that swaps a note's text, if nobody changed it in the meantime. */
function textCommand(id: string, before: RichNode, after: RichNode) {
  const apply = async (expected: RichNode, next: RichNode) => {
    if (notes().editedElsewhere.has(id)) {
      throw new Error('This note is being edited in another window, so this step was skipped.')
    }
    const [current] = await api().invoke('notes:get', [id])
    if (!current) throw new Error('This note is no longer on the board.')
    const read = readNote(current.data)
    if (!read.ok || !sameDoc(read.note.content.doc, expected)) {
      throw new Error('This note was changed in another window, so this step was skipped.')
    }
    const result = await api().invoke('notes:saveContent', {
      id,
      baseRevision: current.revision,
      content: { schemaVersion: NOTE_SCHEMA_VERSION, doc: next },
      height: noteContentHeight(current, { doc: next })
    })
    if (!result.ok) {
      throw new Error('This note was changed in another window, so this step was skipped.')
    }
  }
  return { label: 'Edit text', undo: () => apply(after, before), redo: () => apply(before, after) }
}

// ── Conflicts and other windows ──────────────────────────────────────────────

/**
 * Another window saved this note first. 'mine' saves this version over theirs, 'theirs'
 * loads their version here, 'copy' keeps theirs and saves this version as a new note.
 */
export function resolveConflict(choice: 'mine' | 'theirs' | 'copy'): Promise<void> {
  return queued(async () => {
    const editing = notes().editing
    if (!editing?.conflict || !editor) return
    const theirs = editing.conflict
    const mine = editor.getJSON() as RichNode
    if (choice === 'copy') await saveAsNewNote(mine, editing.objectId)
    if (choice === 'theirs' || choice === 'copy') {
      const doc = theirs.content?.doc ?? (JSON.parse(savedJson) as RichNode)
      editor.commands.setContent(doc, { emitUpdate: false })
      savedJson = JSON.stringify(editor.getJSON())
    }
    baseRevision = theirs.revision
    notes().updateEditing({ conflict: null, status: 'unsaved' })
    if (choice === 'mine') await saveNow()
    else notes().updateEditing({ status: 'saved' })
  })
}

/** The note was trashed while being edited: keep the text as a new note, or let it go. */
export function resolveDeleted(choice: 'keep' | 'discard'): Promise<void> {
  return queued(async () => {
    const editing = notes().editing
    if (!editing?.deleted || !editor) return
    if (choice === 'keep') await saveAsNewNote(editor.getJSON() as RichNode, editing.objectId)
    close(false)
  })
}

async function saveAsNewNote(doc: RichNode, nextTo: string, boardId?: string): Promise<void> {
  const lastCopy = notes().lastCopy
  const source: CanvasObject | undefined =
    currentObjects().find((o) => o.id === nextTo) ??
    (lastCopy?.id === nextTo ? lastCopy : undefined)
  const targetBoard = boardId ?? useWorkspaceStore.getState().board?.id
  if (!targetBoard) return
  const read = source ? readNote(source.data) : null
  const besideSource = source && targetBoard === source.boardId
  const created = await api().invoke('notes:create', {
    boardId: targetBoard,
    at: besideSource ? { x: source.x + source.width + 24, y: source.y } : { x: 0, y: 0 },
    width: source?.width,
    content: { schemaVersion: NOTE_SCHEMA_VERSION, doc },
    appearance: read?.ok ? read.note.appearance : undefined
  })
  const height = noteContentHeight(created)
  if (Math.abs(height - created.height) > 0.5) {
    await api().invoke('notes:updateStyle', [{ id: created.id, height }])
  }
  record({
    label: 'Add note',
    undo: () => api().invoke('objects:delete', [created.id]),
    redo: () => api().invoke('objects:restore', [created.id])
  })
  showNotice(
    besideSource
      ? 'Your version was saved as a new note next to this one.'
      : 'Your unsaved text was kept as a new note on this board.',
    6000
  )
}

/**
 * Before this window shows another board (or closes the project): finish editing. If the text
 * can't be saved, stay — unless staying isn't possible (the board is gone), in which case the
 * text is kept as a new note on the board being shown.
 */
export async function leaveNote(targetBoardId: string | null, force: boolean): Promise<boolean> {
  if (await endEditing()) return true
  if (!force) return false
  await queued(async () => {
    const editing = notes().editing
    if (!editing || !editor) return
    if (targetBoardId && hasUnsavedChanges()) {
      await saveAsNewNote(editor.getJSON() as RichNode, editing.objectId, targetBoardId).catch(
        reportError
      )
    }
    close(editing.readOnly)
  })
  return true
}

setLeaveGuard((target, force) => leaveNote(target, force))

// Keep the last copy of the edited note. If it disappears from this board (moved to the trash
// in another window) after being changed here, the user can keep the text as a new note;
// if nothing was changed, editing just stops.
let removedWhileEditing: string | null = null
useWorkspaceStore.subscribe((state) => {
  const editing = notes().editing
  if (!editing || state.board?.id !== editing.boardId) return
  const here = state.board.objects.find((o) => o.id === editing.objectId)
  if (here) {
    if (here !== notes().lastCopy) useNoteStore.setState({ lastCopy: here })
    return
  }
  if (editing.deleted || removedWhileEditing === editing.objectId) return
  removedWhileEditing = editing.objectId
  void queued(async () => {
    const now = notes().editing
    if (now?.objectId !== editing.objectId || now.deleted) return
    const changed =
      hasUnsavedChanges() || (!!startDoc && !sameDoc(startDoc, JSON.parse(savedJson) as RichNode))
    if (changed && !now.readOnly)
      notes().updateEditing({ status: 'error', deleted: true, error: null })
    else close(now.readOnly)
  }).finally(() => {
    removedWhileEditing = null
  })
})

window.api.on('notes:editedElsewhere', (ids) => {
  useNoteStore.setState({ editedElsewhere: new Set(ids) })
})

window.api.on('notes:leaseLost', ({ objectId }) => {
  const handedOver = () =>
    void api()
      .invoke('notes:handedOver', objectId)
      .catch(() => {})
  if (notes().editing?.objectId !== objectId) return handedOver()
  // Save what's here first (the other window waits for it); the revision check protects
  // the other window's work if this save comes too late.
  editor?.setEditable(false)
  void queued(saveNow).then(() => {
    handedOver()
    if (notes().editing?.objectId !== objectId) return
    notes().updateEditing({ readOnly: true })
  })
})

// Escape finishes editing even when the text doesn't have focus (e.g. after clicking a toolbar
// button). The editor handles its own Escape first; open popovers close themselves instead.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || e.defaultPrevented || !notes().editing || notes().linkEditorOpen) return
  if (
    (e.target as Element | null)?.closest?.('[role="menu"], [role="listbox"], [data-note-popover]')
  )
    return
  e.preventDefault()
  void endEditing()
})

window.api.on('window:flushRequest', () => {
  void queued(saveNow).finally(() => void api().invoke('window:flushed'))
})

// ── The editor ───────────────────────────────────────────────────────────────

/** Keys that control the editing session rather than the text. */
const SessionKeys = Extension.create({
  name: 'noteSessionKeys',
  // Before the formatting shortcuts (text alignment also uses Ctrl+Shift+E).
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Escape: () => {
        void endEditing()
        return true
      },
      'Mod-Shift-e': () => {
        setMode(notes().editing?.mode === 'expanded' ? 'inline' : 'expanded')
        return true
      },
      'Mod-k': () => {
        useNoteStore.setState({ linkEditorOpen: true })
        return true
      },
      // Plain paste. Handled here rather than left to the browser: its built-in shortcut for this
      // only exists on Windows, so Ctrl/Cmd+Shift+V would do nothing on macOS.
      'Mod-Shift-v': () => {
        void pastePlainText(this.editor)
        return true
      }
    }
  }
})

/** Replaces the selection with the clipboard's plain text: no formatting, one paragraph per line. */
async function pastePlainText(editor: Editor): Promise<void> {
  const text = await api().invoke('clipboard:readText')
  if (!text || editor.isDestroyed) return
  const lines = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')
  editor
    .chain()
    .focus()
    .insertContent(
      lines.map((line) => ({
        type: 'paragraph',
        content: line ? [{ type: 'text', text: line }] : []
      }))
    )
    .run()
}

function createEditor(doc: RichNode): Editor {
  return new Editor({
    extensions: [
      ...noteExtensions,
      Placeholder.configure({ placeholder: 'Type something…' }),
      SessionKeys
    ],
    content: doc,
    injectCSS: false,
    // Focused by placePendingCaret once it's on screen.
    autofocus: false,
    editorProps: {
      attributes: { class: 'cw-note-content', 'aria-label': 'Note text', spellcheck: 'true' },
      transformPastedHTML: cleanPastedHtml,
      handlePaste: (_view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const hasFiles = [...data.items].some((item) => item.kind === 'file')
        if (hasFiles && !data.getData('text/plain').trim()) {
          showNotice(
            'Images can’t go inside notes. Click outside the note and paste to put it on the canvas.',
            6000
          )
          return true
        }
        return false
      },
      // Files dropped on a note go on the canvas (the canvas handles the drop), never inside.
      handleDrop: (_view, event) => (event.dataTransfer?.files.length ?? 0) > 0,
      handleClick: (view, pos, event) => {
        if (!(event.ctrlKey || event.metaKey)) return false
        const link = view.state.doc
          .resolve(pos)
          .marks()
          .find((m) => m.type.name === 'link')
        if (!link) return false
        openLink(String(link.attrs.href))
        return true
      }
    },
    onUpdate: onChange
  })
}

/** Opens a note link: internal destinations stay in the app, web links use the browser. */
export function openLink(href: string): void {
  const destination = destinationFromHref(href)
  if (destination) {
    void import('../relations/navigate')
      .then(({ navigateTo }) => navigateTo(destination))
      .catch(reportError)
    return
  }
  void api()
    .invoke('links:open', href)
    .catch((error: unknown) => reportError(error))
}
