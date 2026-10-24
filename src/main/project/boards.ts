import { randomUUID } from 'node:crypto'
import { and, asc, count, eq, inArray, isNull, max, or } from 'drizzle-orm'
import type { BoardCard, BoardDetail, BoardListItem } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects, boards } from '../db/schema'

export const DEFAULT_BOARD_TITLE = 'Untitled board'

/** Layout used to auto-place new board cards until the M2 canvas lets users arrange them. */
export const CARD_GRID = { columns: 4, width: 220, height: 180, gap: 24 } as const

/**
 * Board hierarchy (§3). Every nested board is also a `board` card on its parent
 * board, so the canvas (M2) can render cards from `board_objects` directly.
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

    const breadcrumb: { id: string; title: string }[] = []
    let cursor: { id: string; title: string; parentBoardId: string | null } | undefined = board
    while (cursor) {
      breadcrumb.unshift({ id: cursor.id, title: cursor.title })
      cursor = cursor.parentBoardId ? this.find(cursor.parentBoardId) : undefined
    }

    const rows = this.db
      .select({
        objectId: boardObjects.id,
        boardId: boards.id,
        title: boards.title,
        x: boardObjects.x,
        y: boardObjects.y
      })
      .from(boardObjects)
      .innerJoin(boards, eq(boardObjects.linkedBoardId, boards.id))
      .where(
        and(
          eq(boardObjects.boardId, id),
          eq(boardObjects.type, 'board'),
          isNull(boardObjects.deletedAt),
          isNull(boards.deletedAt)
        )
      )
      .orderBy(asc(boardObjects.zIndex), asc(boardObjects.createdAt))
      .all()

    const cards: BoardCard[] = rows.map((row) => ({
      ...row,
      childBoardCount: this.childCount(row.boardId)
    }))

    return {
      id: board.id,
      title: board.title,
      parentBoardId: board.parentBoardId,
      isMain: board.id === this.mainBoardId,
      breadcrumb,
      cards
    }
  }

  create(parentId: string, title?: string): BoardListItem {
    this.require(parentId)
    const id = randomUUID()
    const cleanTitle = title?.trim() || DEFAULT_BOARD_TITLE
    const now = new Date()
    this.db.transaction((tx) => {
      tx.insert(boards)
        .values({ id, parentBoardId: parentId, title: cleanTitle, createdAt: now, updatedAt: now })
        .run()
      tx.insert(boardObjects)
        .values({
          id: randomUUID(),
          boardId: parentId,
          type: 'board',
          linkedBoardId: id,
          ...this.nextCardPlacement(parentId),
          width: CARD_GRID.width,
          height: CARD_GRID.height,
          createdAt: now,
          updatedAt: now
        })
        .run()
    })
    return { id, title: cleanTitle, parentBoardId: parentId }
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

  /** Moves a board (and everything inside it) onto another board. */
  move(id: string, newParentId: string): void {
    if (id === this.mainBoardId) throw new Error('The main board cannot be moved.')
    const board = this.require(id)
    this.require(newParentId)
    if (board.parentBoardId === newParentId) return
    if (newParentId === id || this.isDescendant(newParentId, id)) {
      throw new Error('A board cannot be moved inside itself.')
    }
    const now = new Date()
    this.db.transaction((tx) => {
      tx.update(boards)
        .set({ parentBoardId: newParentId, updatedAt: now })
        .where(eq(boards.id, id))
        .run()
      tx.update(boardObjects)
        .set({ boardId: newParentId, ...this.nextCardPlacement(newParentId), updatedAt: now })
        .where(and(eq(boardObjects.linkedBoardId, id), eq(boardObjects.type, 'board')))
        .run()
    })
  }

  /** Moves a board, all boards nested in it, and their contents to the trash (soft delete). */
  delete(id: string): { deletedBoardIds: string[] } {
    if (id === this.mainBoardId) throw new Error('The main board cannot be deleted.')
    this.require(id)
    const ids = [id, ...this.descendantIds(id)]
    const now = new Date()
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

  private find(id: string) {
    return this.db
      .select({ id: boards.id, title: boards.title, parentBoardId: boards.parentBoardId })
      .from(boards)
      .where(and(eq(boards.id, id), isNull(boards.deletedAt)))
      .get()
  }

  private require(id: string) {
    const board = this.find(id)
    if (!board) throw new Error('Board not found. It may have been deleted.')
    return board
  }

  private childCount(id: string): number {
    return this.db
      .select({ n: count() })
      .from(boards)
      .where(and(eq(boards.parentBoardId, id), isNull(boards.deletedAt)))
      .get()!.n
  }

  /** True if `id` is somewhere below `ancestorId`. */
  private isDescendant(id: string, ancestorId: string): boolean {
    let cursor = this.find(id)?.parentBoardId ?? null
    while (cursor) {
      if (cursor === ancestorId) return true
      cursor = this.find(cursor)?.parentBoardId ?? null
    }
    return false
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

  /** Next free grid slot and z-order on a board. */
  private nextCardPlacement(boardId: string): { x: number; y: number; zIndex: number } {
    const stats = this.db
      .select({ n: count(), top: max(boardObjects.zIndex) })
      .from(boardObjects)
      .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
      .get()!
    const slot = stats.n
    const column = slot % CARD_GRID.columns
    const row = Math.floor(slot / CARD_GRID.columns)
    return {
      x: column * (CARD_GRID.width + CARD_GRID.gap),
      y: row * (CARD_GRID.height + CARD_GRID.gap),
      zIndex: (stats.top ?? 0) + 1
    }
  }
}
