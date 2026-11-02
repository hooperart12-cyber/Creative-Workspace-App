/**
 * Canvas and board edits. Every edit goes through here so it can be undone (§20):
 * each one performs the change, then records how to undo and redo it.
 */
import { parseComment } from '@shared/comments'
import { parseConnection, releaseGroupEndpoint } from '@shared/connections'
import { normalizePublicUrl } from '@shared/destinations'
import { positionForCenter, rotatedCenter } from '@shared/geometry'
import { ensurePdfCovers } from '../pdf/pdfCover'
import type { CanvasObject, ImportResult, ObjectPatch, Point } from '@shared/types'
import { isAutoHeightNote, noteContentHeight } from '../notes/measure'
import { history as undoHistory, useCanvasStore } from '../store/canvasStore'
import { reportError, showNotice, useProjectStore } from '../store/projectStore'
import { useWorkspaceStore } from '../store/workspaceStore'
import {
  align,
  distribute,
  expandToGroups,
  matchSize,
  reorder,
  type AlignMode,
  type DistributeAxis,
  type ZOrderOp
} from './arrange'
import {
  boundsOf,
  fitViewport,
  intersects,
  objectBounds,
  screenToWorld,
  stepZoom,
  zoomAt
} from './geometry'
import type { Command } from './history'
import { serialQueue } from './queue'

const BOARD_CARD = { width: 200, height: 160 }
/** Offset for duplicates and repeated pastes, so copies don't hide the original. */
const PASTE_OFFSET = 24

const api = () => window.api
const workspace = () => useWorkspaceStore.getState()
const canvas = () => useCanvasStore.getState()

export const currentObjects = (): CanvasObject[] => workspace().board?.objects ?? []

export const selectedObjects = (): CanvasObject[] => {
  const selection = canvas().selection
  return currentObjects().filter((o) => selection.has(o.id))
}

/**
 * Edits run one at a time, in the order they were made: an undo pressed straight after
 * Delete waits until the delete is saved and recorded, instead of undoing the step before.
 */
const enqueue = serialQueue()

/** Runs a task in the edit queue without error handling (note saves handle their own). */
export const queued = enqueue

/** Runs an edit; on failure shows the error and refetches so the screen matches the data. */
export function run(edit: () => Promise<void>): Promise<void> {
  return enqueue(async () => {
    try {
      await edit()
    } catch (error) {
      reportError(error)
      await workspace().refresh()
    }
  })
}

export function record(command: Command): void {
  undoHistory.push(command)
  canvas().bumpHistory()
}

export const undo = () =>
  run(async () => {
    await undoHistory.undo()
    canvas().bumpHistory()
  })

export const redo = () =>
  run(async () => {
    await undoHistory.redo()
    canvas().bumpHistory()
  })

/** Applies placement/arrangement patches (move, resize, group, lock, z-order, align…). */
export function applyPatches(raw: ObjectPatch[], label: string): Promise<void> {
  return run(async () => {
    if (raw.length === 0) return
    const byId = new Map(currentObjects().map((o) => [o.id, o]))
    const patches = raw.map((patch) => roundPatch(fitAutoHeight(patch, byId.get(patch.id))))
    const before: ObjectPatch[] = patches.map((patch) => {
      const original = byId.get(patch.id)
      const inverse: ObjectPatch = { id: patch.id }
      for (const key of Object.keys(patch) as (keyof ObjectPatch)[]) {
        if (key !== 'id' && original) Object.assign(inverse, { [key]: original[key] })
      }
      return inverse
    })
    workspace().patchObjects(patches)
    await api().invoke('objects:update', patches)
    record({
      label,
      undo: () => api().invoke('objects:update', before),
      redo: () => api().invoke('objects:update', patches)
    })
  })
}

/**
 * Auto-height notes are as tall as their text: a new width sets the height, and a height
 * on its own (e.g. "Same height") is ignored.
 */
function fitAutoHeight(patch: ObjectPatch, object: CanvasObject | undefined): ObjectPatch {
  if (!object || !isAutoHeightNote(object)) return patch
  if (patch.width === undefined && patch.height === undefined) return patch
  return { ...patch, height: noteContentHeight(object, { width: patch.width ?? object.width }) }
}

/** Keeps stored geometry tidy: zoom and resize math produce values like 209.99999999999997. */
function roundPatch(patch: ObjectPatch): ObjectPatch {
  const out: ObjectPatch = { ...patch }
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) {
    const value = out[key]
    if (value !== undefined) out[key] = Math.round(value * 100) / 100
  }
  return out
}

/** Creates a board. On the open board, the new card is selected and put into rename mode. */
export function createBoard(parentId: string, at?: Point): Promise<void> {
  return run(async () => {
    const created = await api().invoke('board:create', { parentId, at })
    record({
      label: 'Create board',
      undo: () => api().invoke('objects:delete', [created.objectId]),
      redo: () => api().invoke('objects:restore', [created.objectId])
    })
    const onOpenBoard = workspace().board?.id === parentId
    if (onOpenBoard) canvas().setSelection([created.objectId])
    workspace().setRenaming({
      type: 'board',
      id: created.id,
      source: onOpenBoard ? 'board' : 'sidebar'
    })
  })
}

/** Creates a board on the open board, centred on a world point (or the middle of the view). */
export function createBoardOnCanvas(center?: Point): Promise<void> {
  const board = workspace().board
  if (!board) return Promise.resolve()
  const { viewport, viewSize } = canvas()
  const c = center ?? screenToWorld({ x: viewSize.width / 2, y: viewSize.height / 2 }, viewport)
  const at = {
    x: Math.round(c.x - BOARD_CARD.width / 2),
    y: Math.round(c.y - BOARD_CARD.height / 2)
  }
  // Don't cover existing objects (e.g. clicking "Board" twice): move right until there's room.
  const free = (p: Point) =>
    !currentObjects().some((o) =>
      intersects(objectBounds(o), { ...p, width: BOARD_CARD.width, height: BOARD_CARD.height })
    )
  for (let tries = 0; tries < 50 && !free(at); tries++) at.x += BOARD_CARD.width + PASTE_OFFSET
  return createBoard(board.id, at)
}

export function renameBoard(id: string, title: string): Promise<void> {
  return run(async () => {
    workspace().setRenaming(null)
    const before = workspace().tree?.boards.find((b) => b.id === id)?.title
    const next = title.trim()
    if (!next || next === before || before === undefined) return
    await api().invoke('board:rename', id, next)
    record({
      label: 'Rename board',
      undo: () => api().invoke('board:rename', id, before),
      redo: () => api().invoke('board:rename', id, next)
    })
  })
}

/** Moves objects to the trash. Board cards take their board and everything inside it. */
export function deleteObjects(ids: string[]): Promise<void> {
  return run(async () => {
    if (ids.length === 0) return
    await api().invoke('objects:delete', ids)
    canvas().setSelection([])
    record({
      label: 'Move to trash',
      undo: () => api().invoke('objects:restore', ids),
      redo: () => api().invoke('objects:delete', ids)
    })
  })
}

/** Trashes a board from the sidebar or a dialog (it may not be on the open board). */
export function deleteBoard(id: string): Promise<void> {
  return run(async () => {
    workspace().setDialog(null)
    const { cardId } = await api().invoke('board:delete', id)
    if (!cardId) return
    record({
      label: 'Move board to trash',
      undo: () => api().invoke('objects:restore', [cardId]),
      redo: () => api().invoke('objects:delete', [cardId])
    })
  })
}

/** Moves a board under another board (sidebar drag, Move to… dialog). */
export function moveBoard(id: string, newParentId: string): Promise<void> {
  return run(async () => {
    workspace().setDialog(null)
    const oldParent = workspace().tree?.boards.find((b) => b.id === id)?.parentBoardId
    if (!oldParent || oldParent === newParentId) return
    await api().invoke('board:move', id, newParentId)
    record({
      label: 'Move board',
      undo: () => api().invoke('board:move', id, oldParent),
      redo: () => api().invoke('board:move', id, newParentId)
    })
  })
}

/** Moves objects from the open board into another board (drag onto a card, crumb or sidebar row). */
export function nestObjects(ids: string[], targetBoardId: string): Promise<void> {
  return run(async () => {
    const board = workspace().board
    const moving = currentObjects().filter((o) => ids.includes(o.id))
    const bounds = boundsOf(moving)
    if (!board || !bounds || targetBoardId === board.id) return
    await api().invoke('objects:moveToBoard', ids, targetBoardId)
    canvas().setSelection([])
    const home = { x: bounds.x, y: bounds.y }
    record({
      label: 'Move into board',
      undo: () => api().invoke('objects:moveToBoard', ids, board.id, home),
      redo: () => api().invoke('objects:moveToBoard', ids, targetBoardId)
    })
  })
}

// ── Clipboard ────────────────────────────────────────────────────────────────

export function copySelection(mode: 'copy' | 'cut'): Promise<void> {
  return run(async () => {
    const board = workspace().board
    const ids = [...canvas().selection]
    if (!board || ids.length === 0) return
    await api().invoke('clipboard:set', { mode, objectIds: ids, sourceBoardId: board.id })
    canvas().setCut(mode === 'cut' ? ids : [])
  })
}

/**
 * Pastes at a world point (or offset from the originals when pasting on the same board).
 * If something else was copied since (an image in a browser, files in File Explorer, a
 * screenshot), that is imported instead.
 */
export async function paste(at?: Point): Promise<void> {
  // Set when the clipboard holds something from another program; imported after the queued step.
  let external = null as { boardId: string; center: Point } | null
  await run(async () => {
    const board = workspace().board
    if (!board) return
    const clip = await api().invoke('clipboard:get')
    if (!clip) {
      canvas().setCut([])
      external = { boardId: board.id, center: at ?? viewCenter() }
      return
    }
    const target = at ?? defaultPastePoint(clip.objectIds, clip.sourceBoardId === board.id)

    if (clip.mode === 'cut') {
      const sourceBoard = clip.sourceBoardId
      const original = currentObjects().filter((o) => clip.objectIds.includes(o.id))
      const home = boundsOf(original)
      await api().invoke('objects:moveToBoard', clip.objectIds, board.id, target)
      await api().invoke('clipboard:set', null)
      canvas().setCut([])
      canvas().setSelection(clip.objectIds)
      record({
        label: 'Paste',
        undo: () =>
          api().invoke(
            'objects:moveToBoard',
            clip.objectIds,
            sourceBoard,
            home ? { x: home.x, y: home.y } : undefined
          ),
        redo: () => api().invoke('objects:moveToBoard', clip.objectIds, board.id, target)
      })
      return
    }

    let created = await api().invoke('objects:copyTo', clip.objectIds, board.id, target)
    canvas().setSelection(created)
    record({
      label: 'Paste',
      undo: () => api().invoke('objects:delete', created),
      redo: async () => {
        created = await api().invoke('objects:copyTo', clip.objectIds, board.id, target)
      }
    })
  })
  if (external) {
    const { boardId, center } = external
    const placed = await importThenPlace(
      boardId,
      () => api().invoke('clipboard:importExternal'),
      center,
      !at
    )
    const text = (await api().invoke('clipboard:readText')).trim()
    const href = normalizePublicUrl(text)
    if (!placed && href) {
      await run(async () => {
        const created = await api().invoke('relations:createLink', boardId, center, {
          version: 1,
          title: '',
          description: '',
          layout: 'compact',
          destination: { kind: 'url', href }
        })
        canvas().setSelection([created.id])
        record({
          label: 'Paste link',
          undo: () => api().invoke('objects:delete', [created.id]),
          redo: () => api().invoke('objects:restore', [created.id])
        })
      })
    }
  }
}

export function duplicateSelection(): Promise<void> {
  return run(async () => {
    const board = workspace().board
    const selected = selectedObjects()
    const bounds = boundsOf(selected)
    if (!board || !bounds) return
    const ids = selected.map((o) => o.id)
    const at = { x: bounds.x + PASTE_OFFSET, y: bounds.y + PASTE_OFFSET }
    let created = await api().invoke('objects:copyTo', ids, board.id, at)
    canvas().setSelection(created)
    record({
      label: 'Duplicate',
      undo: () => api().invoke('objects:delete', created),
      redo: async () => {
        created = await api().invoke('objects:copyTo', ids, board.id, at)
      }
    })
  })
}

function defaultPastePoint(ids: string[], sameBoard: boolean): Point {
  const originals = boundsOf(currentObjects().filter((o) => ids.includes(o.id)))
  if (sameBoard && originals) {
    return { x: originals.x + PASTE_OFFSET, y: originals.y + PASTE_OFFSET }
  }
  const { viewport, viewSize } = canvas()
  return screenToWorld({ x: viewSize.width / 3, y: viewSize.height / 3 }, viewport)
}

// ── Images ───────────────────────────────────────────────────────────────────

export const viewCenter = (): Point => {
  const { viewport, viewSize } = canvas()
  return screenToWorld({ x: viewSize.width / 2, y: viewSize.height / 2 }, viewport)
}

/** Places library entries that are already stored. One undo step removes the new cards. */
export function placeExistingAssets(assetIds: string[], at: Point): Promise<void> {
  return run(async () => {
    const board = workspace().board
    if (!board || assetIds.length === 0) return
    const created = await api().invoke('objects:createFromAssets', {
      boardId: board.id,
      assetIds,
      center: at,
      avoidOverlap: false
    })
    if (workspace().board?.id === board.id) canvas().setSelection(created)
    record({
      label: created.length === 1 ? 'Add file' : 'Add files',
      undo: () => api().invoke('objects:delete', created),
      redo: () => api().invoke('objects:restore', created)
    })
  })
}

/** Imports files dropped from File Explorer / Finder or a browser, centred on `at`. */
export async function importDroppedFiles(files: File[], at: Point): Promise<void> {
  const board = workspace().board
  if (!board || files.length === 0) return
  await importThenPlace(
    board.id,
    async () => {
      // Files on disk are imported by path (no copy through the renderer). Things without a
      // path, like an image dragged out of a browser, are sent as bytes.
      const paths: string[] = []
      const unsaved: File[] = []
      for (const file of files) {
        const path = api().pathForFile(file)
        if (path) paths.push(path)
        else unsaved.push(file)
      }
      const fromDisk = paths.length
        ? await api().invoke('assets:importFiles', paths)
        : { imported: [], skipped: [], warnings: [], entryIds: [] }
      if (unsaved.length === 0) return fromDisk
      const bytes = await Promise.all(
        unsaved.map(async (file) => ({
          name: file.name,
          bytes: new Uint8Array(await file.arrayBuffer())
        }))
      )
      const fromMemory = await api().invoke('assets:importBytes', bytes)
      return {
        imported: [...fromDisk.imported, ...fromMemory.imported],
        skipped: [...fromDisk.skipped, ...fromMemory.skipped],
        warnings: [...fromDisk.warnings, ...fromMemory.warnings],
        entryIds: [...fromDisk.entryIds, ...fromMemory.entryIds]
      }
    },
    at,
    false
  )
}

/** Asks for image files and places them at `at` (or the middle of the view, next to what's there). */
export async function addImagesFromPicker(at?: Point): Promise<void> {
  // The picker stays open as long as the user likes, so it isn't part of the queued edit.
  const paths = await api()
    .invoke('dialog:pickImages')
    .catch((error: unknown) => {
      reportError(error)
      return []
    })
  if (paths.length === 0) return
  const board = workspace().board
  if (!board) return
  await importThenPlace(
    board.id,
    () => api().invoke('assets:importFiles', paths, { imagesOnly: true }),
    at ?? viewCenter(),
    !at
  )
}

/** Asks for any files and places them: images, PDFs, and everything else the library can store. */
export async function addFilesFromPicker(at?: Point): Promise<void> {
  const paths = await api()
    .invoke('dialog:pickFiles')
    .catch((error: unknown) => {
      reportError(error)
      return []
    })
  if (paths.length === 0) return
  const board = workspace().board
  if (!board) return
  await importThenPlace(
    board.id,
    () => api().invoke('assets:importFiles', paths),
    at ?? viewCenter(),
    !at
  )
}

/**
 * Copying files in (hashing, decoding, thumbnails) can take seconds, so it runs outside the
 * edit queue: dragging, undo and delete keep working meanwhile. Only putting the finished
 * import on the board is a queued, undoable edit.
 */
async function importThenPlace(
  boardId: string,
  importWork: () => Promise<ImportResult | null>,
  center: Point,
  avoidOverlap: boolean
): Promise<boolean> {
  let result: ImportResult | null
  try {
    result = await withProgress(importWork)
  } catch (error) {
    reportError(error)
    return false
  }
  if (!result) return false
  // A file the tool refused (a PDF on the image tool, a remote link) still needs the notice.
  // There is nothing to put on the board, so this is not an undo step.
  if (result.imported.length === 0) {
    reportSkipped(result)
    return false
  }
  await run(() => placeImported(result, boardId, center, avoidOverlap))
  return true
}

/** Imports in progress; "Importing…" stays up until the last one finishes. */
let importsRunning = 0

/** Shows "Importing…" if an import takes more than a moment. */
async function withProgress<T>(work: () => Promise<T>): Promise<T> {
  importsRunning++
  const timer = setTimeout(() => showNotice('Importing…', 0), 400)
  try {
    return await work()
  } finally {
    clearTimeout(timer)
    importsRunning--
    if (importsRunning === 0 && useProjectStore.getState().notice === 'Importing…') {
      showNotice(null)
    }
  }
}

/** Puts freshly imported images on a board as one undoable step and reports skipped files. */
async function placeImported(
  result: ImportResult,
  boardId: string,
  center: Point,
  avoidOverlap: boolean
): Promise<void> {
  reportSkipped(result)
  if (result.imported.length === 0) return
  const assetIds = result.imported.map((a) => a.id)
  const created = await api().invoke('objects:createFromAssets', {
    boardId,
    assetIds,
    center,
    avoidOverlap
  })
  if (workspace().board?.id === boardId) canvas().setSelection(created)
  const images = result.imported.every((asset) => asset.mime.startsWith('image/'))
  record({
    label:
      created.length === 1
        ? images
          ? 'Add image'
          : 'Add file'
        : images
          ? 'Add images'
          : 'Add files',
    undo: () => api().invoke('objects:delete', created),
    redo: () => api().invoke('objects:restore', created)
  })
  void ensurePdfCovers(result.imported)
}

function reportSkipped({ imported, skipped, warnings }: ImportResult): void {
  if (warnings.length > 0 && skipped.length === 0) {
    showNotice(warnings.map((warning) => warning.message).join('\n'), 12000)
  }
  if (skipped.length === 0) return
  const lines = skipped.map((s) => `• ${s.name}: ${s.reason}`)
  const head =
    imported.length === 0
      ? skipped.length === 1
        ? 'This file couldn’t be added:'
        : 'These files couldn’t be added:'
      : `Added ${imported.length} ${
          imported.every((asset) => asset.mime.startsWith('image/')) ? 'image' : 'file'
        }${imported.length === 1 ? '' : 's'}. ` +
        `${skipped.length} file${skipped.length === 1 ? ' was' : 's were'} skipped:`
  const shown = lines.slice(0, 5)
  if (lines.length > shown.length) shown.push(`…and ${lines.length - shown.length} more`)
  showNotice([head, ...shown].join('\n'), 12000)
}

/** Sizes images to their pixel size (1 pixel = 1 canvas unit), keeping their middle in place. */
export function resetImageSize(ids: string[]): Promise<void> {
  const patches = currentObjects()
    .filter((o) => ids.includes(o.id) && !o.locked && o.asset?.width && o.asset.height)
    .map((o) => {
      const width = o.asset!.width!
      const height = o.asset!.height!
      return {
        id: o.id,
        width,
        height,
        ...positionForCenter(rotatedCenter(o), width, height, o.rotation)
      }
    })
  return applyPatches(patches, 'Reset size')
}

/** Straightens rotated objects around their middle. */
export function resetRotation(ids: string[]): Promise<void> {
  const patches = currentObjects()
    .filter((o) => ids.includes(o.id) && !o.locked && o.rotation !== 0)
    .map((o) => ({
      id: o.id,
      rotation: 0,
      ...positionForCenter(rotatedCenter(o), o.width, o.height, 0)
    }))
  return applyPatches(patches, 'Reset rotation')
}

/** Saves a copy of an image's original file, exactly as it was imported. */
export async function saveOriginal(object: CanvasObject): Promise<void> {
  // Not an edit (nothing to undo), and its save dialog mustn't hold up queued edits.
  if (!object.asset) return
  await api()
    .invoke('assets:saveOriginal', object.asset.id)
    .catch((error: unknown) => reportError(error))
}

// ── Arrangement ──────────────────────────────────────────────────────────────

export function groupSelection(): Promise<void> {
  const selected = selectedObjects()
  if (selected.length < 2) return Promise.resolve()
  const groupId = crypto.randomUUID()
  return applyPatches(
    selected.map((o) => ({ id: o.id, groupId })),
    'Group'
  )
}

export function ungroupSelection(): Promise<void> {
  const selected = selectedObjects().filter((object) => object.groupId && !object.locked)
  if (selected.length === 0) return Promise.resolve()
  const selectedIds = new Set(selected.map((object) => object.id))
  const groupIds = new Set(selected.map((object) => object.groupId as string))
  const emptied = new Set(
    [...groupIds].filter(
      (groupId) =>
        !currentObjects().some(
          (object) => object.groupId === groupId && !selectedIds.has(object.id)
        )
    )
  )
  const patches = selected.map((object) => ({ id: object.id, groupId: null as string | null }))
  const connections = currentObjects().flatMap((object) => {
    if (object.type !== 'connection') return []
    const before = parseConnection(object.data)
    if (!before) return []
    const next = {
      ...before,
      start: releaseGroupEndpoint(before.start, emptied),
      end: releaseGroupEndpoint(before.end, emptied)
    }
    if (next.start === before.start && next.end === before.end) return []
    return [{ object, before, next }]
  })
  return run(async () => {
    const byId = new Map(currentObjects().map((object) => [object.id, object]))
    const before = patches.map((patch) => ({
      id: patch.id,
      groupId: byId.get(patch.id)?.groupId ?? null
    }))
    workspace().patchObjects(patches)
    await api().invoke('objects:update', patches)
    for (const change of connections) {
      await api().invoke(
        'relations:updateConnection',
        change.object.id,
        change.object.revision,
        change.next
      )
    }
    record({
      label: 'Ungroup',
      undo: async () => {
        await api().invoke('objects:update', before)
        for (const change of connections) {
          const current = workspace().board?.objects.find((item) => item.id === change.object.id)
          if (current)
            await api().invoke(
              'relations:updateConnection',
              current.id,
              current.revision,
              change.before
            )
        }
      },
      redo: async () => {
        await api().invoke('objects:update', patches)
        for (const change of connections) {
          const current = workspace().board?.objects.find((item) => item.id === change.object.id)
          if (current)
            await api().invoke(
              'relations:updateConnection',
              current.id,
              current.revision,
              change.next
            )
        }
      }
    })
  })
}

export function duplicateWithComments(): Promise<void> {
  return run(async () => {
    const board = workspace().board
    const selected = selectedObjects()
    const bounds = boundsOf(selected)
    if (!board || !bounds) return
    const ids = new Set(selected.map((object) => object.id))
    for (const object of board.objects) {
      if (object.type !== 'connection') continue
      const data = parseConnection(object.data)
      const start = data?.start.attachment?.id
      const end = data?.end.attachment?.id
      if (start && end && ids.has(start) && ids.has(end)) ids.add(object.id)
    }
    for (const object of board.objects) {
      if (object.type !== 'comment') continue
      const data = parseComment(object.data)
      if (data?.anchor.targetId && ids.has(data.anchor.targetId)) ids.add(object.id)
    }
    const at = { x: bounds.x + PASTE_OFFSET, y: bounds.y + PASTE_OFFSET }
    const source = [...ids]
    let created = await api().invoke('objects:copyTo', source, board.id, at)
    canvas().setSelection(created)
    record({
      label: 'Duplicate with comments',
      undo: () => api().invoke('objects:delete', created),
      redo: async () => {
        created = await api().invoke('objects:copyTo', source, board.id, at)
      }
    })
  })
}

/** Locks the selection, or unlocks it if everything selected is already locked. */
export function toggleLockSelection(): Promise<void> {
  const selected = selectedObjects()
  const lock = !selected.every((o) => o.locked)
  return applyPatches(
    selected.map((o) => ({ id: o.id, locked: lock })),
    lock ? 'Lock' : 'Unlock'
  )
}

export function reorderSelection(op: ZOrderOp): Promise<void> {
  return applyPatches(reorder(currentObjects(), canvas().selection, op), 'Change layer order')
}

export function alignSelection(mode: AlignMode): Promise<void> {
  return applyPatches(align(movable(), mode), 'Align')
}

export function distributeSelection(axis: DistributeAxis): Promise<void> {
  return applyPatches(distribute(movable(), axis), 'Distribute')
}

export function matchSizeSelection(dimension: 'width' | 'height' | 'both'): Promise<void> {
  return applyPatches(matchSize(movable(), dimension), 'Match size')
}

/** Selected objects that aren't locked (locked objects never move). */
const movable = () => selectedObjects().filter((o) => !o.locked)

export function selectAll(): void {
  canvas().setSelection(currentObjects().map((o) => o.id))
}

/** Selects objects, pulling in the rest of any group they belong to. */
export function selectWithGroups(ids: Iterable<string>): void {
  canvas().setSelection(expandToGroups(ids, currentObjects()))
}

// ── Camera ───────────────────────────────────────────────────────────────────

export function fitAll(): void {
  fitTo(currentObjects())
}

export function fitSelection(): void {
  const selected = selectedObjects()
  fitTo(selected.length ? selected : currentObjects(), 4)
}

function fitTo(objects: CanvasObject[], maxZoom = 1): void {
  const { viewSize, setViewport } = canvas()
  const bounds = boundsOf(objects.map(objectBounds))
  if (!bounds || viewSize.width === 0) {
    setViewport({ x: viewSize.width / 2, y: viewSize.height / 2, zoom: 1 })
    return
  }
  setViewport(fitViewport(bounds, viewSize, 64, maxZoom))
}

export function zoomStepAtCenter(direction: 1 | -1): void {
  const { viewport, viewSize, setViewport } = canvas()
  const center = { x: viewSize.width / 2, y: viewSize.height / 2 }
  setViewport(zoomAt(viewport, center, stepZoom(viewport.zoom, direction)))
}

export function zoomToActualSize(): void {
  const { viewport, viewSize, setViewport } = canvas()
  setViewport(zoomAt(viewport, { x: viewSize.width / 2, y: viewSize.height / 2 }, 1))
}
