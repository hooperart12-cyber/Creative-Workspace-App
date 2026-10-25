import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, inArray, isNull, max, or } from 'drizzle-orm'
import { rotatedBounds } from '@shared/geometry'
import type { BoardDetail, BoardListItem, CanvasObject, Point, Viewport } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { assets, boardObjects, boards } from '../db/schema'
import { toAssetInfo } from './assets'

export const DEFAULT_BOARD_TITLE = 'Untitled board'

/** Default size of a board card on the canvas. */
export const BOARD_CARD_SIZE = { width: 200, height: 160 } as const

/** Gap left between existing content and auto-placed objects. */
export const PLACEMENT_GAP = 40

type ObjectRow = typeof boardObjects.$inferSelect

let lastDeletion = 0

/**
 * Timestamp for a trash operation. Strictly increasing, because restore uses the
 * timestamp to find everything trashed together: two deletes in the same millisecond
 * must not look like one.
 */
export function deletionTime(): Date {
  lastDeletion = Math.max(Date.now(), lastDeletion + 1)
  return new Date(lastDeletion)
}

export function toCanvasObject(row: ObjectRow): CanvasObject {
  return {
    id: row.id,
    boardId: row.boardId,
    type: row.type,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    rotation: row.rotation,
    zIndex: row.zIndex,
    locked: row.locked,
    groupId: row.groupId,
    linkedBoardId: row.linkedBoardId,
    assetId: row.assetId,
    data: row.data
  }
}

/**
 * Board hierarchy (§3). Every nested board is also a `board` card (a row in
 * `board_objects`) on its parent board; the card's position is the board's place
 * on the parent canvas.
 */
export class BoardRepository {
  constructor(
    private readonly db: ProjectDb,
    private readonly mainBoardId: string
  ) {}

  list(): BoardListItem[] {
    return this.db
      .select({ id: boards.id, title: boards.title, parentBoardId: boards.parentBoardId })
      .from(boards)
      .where(isNull(boards.deletedAt))
      .orderBy(asc(boards.createdAt))
      .all()
  }

  get(id: string): BoardDetail {
    const board = this.require(id)
    const row = this.db.select().from(boards).where(eq(boards.id, id)).get()!

    const breadcrumb: { id: string; title: string }[] = []
    let cursor: { id: string; title: string; parentBoardId: string | null } | undefined = board
    while (cursor) {
      breadcrumb.unshift({ id: cursor.id, title: cursor.title })
      cursor = cursor.parentBoardId ? this.find(cursor.parentBoardId) : undefined
    }

    const rows = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.boardId, id), isNull(boardObjects.deletedAt)))
      .orderBy(asc(boardObjects.zIndex), asc(boardObjects.createdAt))
      .all()

    const assetIds = [...new Set(rows.flatMap((r) => (r.assetId ? [r.assetId] : [])))]
    const assetsById = new Map(
      (assetIds.length
        ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
        : []
      ).map((a) => [a.id, toAssetInfo(a)])
    )

    const objects: CanvasObject[] = []
    for (const objectRow of rows) {
      const object = toCanvasObject(objectRow)
      if (object.type === 'board') {
        const linked = object.linkedBoardId ? this.find(object.linkedBoardId) : undefined
        if (!linked) continue // card whose board is gone; never shown
        object.board = { title: linked.title, childBoardCount: this.childCount(linked.id) }
      }
      if (object.assetId) {
        const asset = assetsById.get(object.assetId)
        if (!asset) continue // its file record is gone; nothing to show
        object.asset = asset
      }
      objects.push(object)
    }

    return {
      id: board.id,
      title: board.title,
      parentBoardId: board.parentBoardId,
      isMain: board.id === this.mainBoardId,
      breadcrumb,
      objects,
      viewport: { x: row.viewportX, y: row.viewportY, zoom: row.viewportZoom }
    }
  }

  /** Creates a board inside `parentId`, with its card at `at` (or below existing content). */
  create(parentId: string, title?: string, at?: Point): BoardListItem & { objectId: string } {
    this.require(parentId)
    const id = randomUUID()
    const objectId = randomUUID()
    const cleanTitle = title?.trim() || DEFAULT_BOARD_TITLE
    const now = new Date()
    this.db.transaction((tx) => {
      tx.insert(boards)
        .values({ id, parentBoardId: parentId, title: cleanTitle, createdAt: now, updatedAt: now })
        .run()
      tx.insert(boardObjects)
        .values({
          id: objectId,
          boardId: parentId,
          type: 'board',
          linkedBoardId: id,
          ...(at ?? this.placementBelowContent(parentId)),
          zIndex: this.topZ(parentId) + 1,
          ...BOARD_CARD_SIZE,
          createdAt: now,
          updatedAt: now
        })
        .run()
    })
    return { id, title: cleanTitle, parentBoardId: parentId, objectId }
  }

  rename(id: string, title: string): void {
    this.require(id)
    const clean = title.trim()
    if (!clean) throw new Error('Board name cannot be empty.')
    this.db
      .update(boards)
      .set({ title: clean, updatedAt: new Date() })
      .where(eq(boards.id, id))
      .run()
  }

  /**
   * Moves a board (and everything inside it) onto another board. Its card goes to
   * `at` if given, otherwise below the target board's existing content.
   */
  move(id: string, newParentId: string, at?: Point): void {
    if (id === this.mainBoardId) throw new Error('The main board cannot be moved.')
    const board = this.require(id)
    this.require(newParentId)
    if (board.parentBoardId === newParentId && !at) return
    if (newParentId === id || this.isDescendant(newParentId, id)) {
      throw new Error('A board cannot be moved inside itself.')
    }
    const now = new Date()
    const sameParent = board.parentBoardId === newParentId
    this.db.transaction((tx) => {
      tx.update(boards)
        .set({ parentBoardId: newParentId, updatedAt: now })
        .where(eq(boards.id, id))
        .run()
      tx.update(boardObjects)
        .set({
          boardId: newParentId,
          ...(at ?? this.placementBelowContent(newParentId)),
          ...(sameParent ? {} : { zIndex: this.topZ(newParentId) + 1 }),
          updatedAt: now
        })
        .where(and(eq(boardObjects.linkedBoardId, id), eq(boardObjects.type, 'board')))
        .run()
    })
  }

  /** Moves a board, all boards nested in it, and their contents to the trash (soft delete). */
  delete(id: string): { deletedBoardIds: string[] } {
    if (id === this.mainBoardId) throw new Error('The main board cannot be deleted.')
    this.require(id)
    const ids = [id, ...this.descendantIds(id)]
    const now = deletionTime()
    this.db.transaction((tx) => {
      tx.update(boards).set({ deletedAt: now, updatedAt: now }).where(inArray(boards.id, ids)).run()
      tx.update(boardObjects)
        .set({ deletedAt: now, updatedAt: now })
        .where(
          and(
            isNull(boardObjects.deletedAt),
            or(inArray(boardObjects.boardId, ids), inArray(boardObjects.linkedBoardId, ids))
          )
        )
        .run()
    })
    return { deletedBoardIds: ids }
  }

  /**
   * Restores a trashed board together with everything that was trashed with it
   * (same deletion time). Used by undo now, and by the Trash view later.
   */
  restore(id: string): void {
    const row = this.db.select().from(boards).where(eq(boards.id, id)).get()
    if (!row) throw new Error('Board not found.')
    if (!row.deletedAt) return
    if (row.parentBoardId && !this.find(row.parentBoardId)) {
      throw new Error('Restore the board it was inside first.')
    }
    const deletedAt = row.deletedAt
    // Everything below this board that was deleted in the same operation.
    const ids = [id]
    let frontier = [id]
    while (frontier.length) {
      const children = this.db
        .select({ id: boards.id })
        .from(boards)
        .where(and(inArray(boards.parentBoardId, frontier), eq(boards.deletedAt, deletedAt)))
        .all()
        .map((r) => r.id)
      ids.push(...children)
      frontier = children
    }
    const now = new Date()
    this.db.transaction((tx) => {
      tx.update(boards)
        .set({ deletedAt: null, updatedAt: now })
        .where(inArray(boards.id, ids))
        .run()
      tx.update(boardObjects)
        .set({ deletedAt: null, updatedAt: now })
        .where(
          and(
            eq(boardObjects.deletedAt, deletedAt),
            or(inArray(boardObjects.boardId, ids), inArray(boardObjects.linkedBoardId, ids))
          )
        )
        .run()
    })
  }

  /**
   * Copies a board and everything inside it (nested boards and their objects) onto
   * `targetParentId`. Assets are shared, not duplicated (ADR-005). Returns the new card's id.
   */
  duplicate(id: string, targetParentId: string, at: Point): string {
    if (id === this.mainBoardId) throw new Error('The main board cannot be copied.')
    this.require(id)
    this.require(targetParentId)
    if (targetParentId === id || this.isDescendant(targetParentId, id)) {
      throw new Error('A board cannot be copied inside itself.')
    }
    const sourceIds = [id, ...this.descendantIds(id)]
    const newIds = new Map(sourceIds.map((sourceId) => [sourceId, randomUUID()]))
    const now = new Date()
    const cardId = randomUUID()

    this.db.transaction((tx) => {
      // Parents before children, so each copy's parent already exists.
      const sourceBoards = tx
        .select()
        .from(boards)
        .where(inArray(boards.id, sourceIds))
        .all()
        .sort((a, b) => sourceIds.indexOf(a.id) - sourceIds.indexOf(b.id))
      for (const board of sourceBoards) {
        tx.insert(boards)
          .values({
            ...board,
            id: newIds.get(board.id)!,
            parentBoardId:
              board.id === id ? targetParentId : (newIds.get(board.parentBoardId!) ?? null),
            createdAt: now,
            updatedAt: now,
            deletedAt: null
          })
          .run()
      }

      // Objects on the copied boards (including cards of nested boards).
      const sourceObjects = tx
        .select()
        .from(boardObjects)
        .where(and(inArray(boardObjects.boardId, sourceIds), isNull(boardObjects.deletedAt)))
        .all()
      const groupIds = new Map<string, string>()
      for (const object of sourceObjects) {
        if (object.linkedBoardId && !newIds.has(object.linkedBoardId)) continue
        tx.insert(boardObjects)
          .values({
            ...object,
            id: randomUUID(),
            boardId: newIds.get(object.boardId)!,
            linkedBoardId: object.linkedBoardId ? newIds.get(object.linkedBoardId)! : null,
            groupId: object.groupId ? remap(groupIds, object.groupId) : null,
            createdAt: now,
            updatedAt: now
          })
          .run()
      }

      // The card for the copy on the target board, same size as the original card.
      const original = tx
        .select()
        .from(boardObjects)
        .where(
          and(
            eq(boardObjects.linkedBoardId, id),
            eq(boardObjects.type, 'board'),
            isNull(boardObjects.deletedAt)
          )
        )
        .get()
      tx.insert(boardObjects)
        .values({
          id: cardId,
          boardId: targetParentId,
          type: 'board',
          linkedBoardId: newIds.get(id)!,
          x: at.x,
          y: at.y,
          width: original?.width ?? BOARD_CARD_SIZE.width,
          height: original?.height ?? BOARD_CARD_SIZE.height,
          zIndex: this.topZ(targetParentId) + 1,
          createdAt: now,
          updatedAt: now
        })
        .run()
    })
    return cardId
  }

  /** The id of the card that represents a board on its parent (null for the main board). */
  cardIdOf(id: string): string | null {
    return (
      this.db
        .select({ id: boardObjects.id })
        .from(boardObjects)
        .where(
          and(
            eq(boardObjects.linkedBoardId, id),
            eq(boardObjects.type, 'board'),
            isNull(boardObjects.deletedAt)
          )
        )
        .get()?.id ?? null
    )
  }

  /** Saves where the camera was on a board. Not broadcast: each window keeps its own view. */
  setViewport(id: string, viewport: Viewport): void {
    this.db
      .update(boards)
      .set({ viewportX: viewport.x, viewportY: viewport.y, viewportZoom: viewport.zoom })
      .where(eq(boards.id, id))
      .run()
  }

  /** Throws unless the board exists (and isn't trashed). */
  require(id: string) {
    const board = this.find(id)
    if (!board) throw new Error('Board not found. It may have been deleted.')
    return board
  }

  /** True if `id` is somewhere below `ancestorId`. */
  isDescendant(id: string, ancestorId: string): boolean {
    let cursor = this.find(id)?.parentBoardId ?? null
    while (cursor) {
      if (cursor === ancestorId) return true
      cursor = this.find(cursor)?.parentBoardId ?? null
    }
    return false
  }

  /** Top-left for new content: below everything already on the board, aligned to its left edge. */
  placementBelowContent(boardId: string): Point {
    const rows = this.contentBounds(boardId)
    if (rows.length === 0) return { x: 0, y: 0 }
    return {
      x: Math.min(...rows.map((r) => r.x)),
      y: Math.max(...rows.map((r) => r.y + r.height)) + PLACEMENT_GAP
    }
  }

  /** Where each object on a board is drawn (rotated objects take up their rotated bounds). */
  contentBounds(boardId: string) {
    return this.db
      .select({
        x: boardObjects.x,
        y: boardObjects.y,
        width: boardObjects.width,
        height: boardObjects.height,
        rotation: boardObjects.rotation
      })
      .from(boardObjects)
      .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
      .all()
      .map(rotatedBounds)
  }

  topZ(boardId: string): number {
    return (
      this.db
        .select({ top: max(boardObjects.zIndex) })
        .from(boardObjects)
        .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
        .get()?.top ?? 0
    )
  }

  private find(id: string) {
    return this.db
      .select({ id: boards.id, title: boards.title, parentBoardId: boards.parentBoardId })
      .from(boards)
      .where(and(eq(boards.id, id), isNull(boards.deletedAt)))
      .get()
  }

  private childCount(id: string): number {
    return this.db
      .select({ n: count() })
      .from(boards)
      .where(and(eq(boards.parentBoardId, id), isNull(boards.deletedAt)))
      .get()!.n
  }

  private descendantIds(id: string): string[] {
    const result: string[] = []
    let frontier = [id]
    while (frontier.length) {
      const children = this.db
        .select({ id: boards.id })
        .from(boards)
        .where(and(inArray(boards.parentBoardId, frontier), isNull(boards.deletedAt)))
        .all()
        .map((row) => row.id)
      result.push(...children)
      frontier = children
    }
    return result
  }
}

/** Gives each source group id one new id, so copies form their own groups. */
export function remap(map: Map<string, string>, id: string): string {
  let next = map.get(id)
  if (!next) {
    next = randomUUID()
    map.set(id, next)
  }
  return next
}
