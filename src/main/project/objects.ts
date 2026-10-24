import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ObjectPatch, Point } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects, boards } from '../db/schema'
import { deletionTime, remap, type BoardRepository } from './boards'

const PATCHABLE = ['x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'groupId'] as const

/** Smallest allowed object size, so nothing can be resized out of existence. */
export const MIN_OBJECT_SIZE = 24

/**
 * Operations on objects placed on board canvases (§4). Board cards are special:
 * trashing, moving or copying a card does the same to the board it opens.
 */
export class ObjectRepository {
  constructor(
    private readonly db: ProjectDb,
    private readonly boards: BoardRepository
  ) {}

  /** Applies placement/arrangement changes to several objects in one transaction. */
  update(patches: ObjectPatch[]): void {
    if (patches.length === 0) return
    const now = new Date()
    this.db.transaction((tx) => {
      for (const patch of patches) {
        const values: Partial<typeof boardObjects.$inferInsert> = { updatedAt: now }
        for (const key of PATCHABLE) {
          if (patch[key] !== undefined) Object.assign(values, { [key]: patch[key] })
        }
        if (values.width !== undefined) values.width = Math.max(MIN_OBJECT_SIZE, values.width)
        if (values.height !== undefined) values.height = Math.max(MIN_OBJECT_SIZE, values.height)
        const result = tx
          .update(boardObjects)
          .set(values)
          .where(and(eq(boardObjects.id, patch.id), isNull(boardObjects.deletedAt)))
          .run()
        if (result.changes === 0) throw new Error('Object not found. It may have been deleted.')
      }
    })
  }

  /** Moves objects to the trash. Board cards trash their board and everything inside it. */
  delete(ids: string[]): void {
    const rows = this.rows(ids, { includeDeleted: false })
    const now = deletionTime()
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (row.type === 'board' && row.linkedBoardId) {
          this.boards.delete(row.linkedBoardId)
        } else {
          tx.update(boardObjects)
            .set({ deletedAt: now, updatedAt: now })
            .where(eq(boardObjects.id, row.id))
            .run()
        }
      }
    })
  }

  /** Brings trashed objects back (undo of delete). */
  restore(ids: string[]): void {
    const rows = this.rows(ids, { includeDeleted: true })
    const now = new Date()
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (!row.deletedAt) continue
        if (row.type === 'board' && row.linkedBoardId) {
          this.boards.restore(row.linkedBoardId)
        } else {
          this.boards.require(row.boardId)
          tx.update(boardObjects)
            .set({ deletedAt: null, updatedAt: now })
            .where(eq(boardObjects.id, row.id))
            .run()
        }
      }
    })
  }

  /**
   * Moves objects onto another board (or repositions them on the same one), keeping
   * their layout relative to each other. The set's top-left corner goes to `at`,
   * or below the target's existing content.
   */
  moveToBoard(ids: string[], targetBoardId: string, at?: Point): void {
    this.boards.require(targetBoardId)
    const rows = this.rows(ids, { includeDeleted: false })
    if (rows.length === 0) return
    const origin = at ?? this.boards.placementBelowContent(targetBoardId)
    const left = Math.min(...rows.map((r) => r.x))
    const top = Math.min(...rows.map((r) => r.y))
    const now = new Date()

    this.db.transaction((tx) => {
      let z = this.boards.topZ(targetBoardId)
      for (const row of [...rows].sort((a, b) => a.zIndex - b.zIndex)) {
        const position = { x: origin.x + (row.x - left), y: origin.y + (row.y - top) }
        if (row.type === 'board' && row.linkedBoardId) {
          this.boards.move(row.linkedBoardId, targetBoardId, position)
        } else {
          const changingBoard = row.boardId !== targetBoardId
          tx.update(boardObjects)
            .set({
              boardId: targetBoardId,
              ...position,
              ...(changingBoard ? { zIndex: ++z } : {}),
              updatedAt: now
            })
            .where(eq(boardObjects.id, row.id))
            .run()
        }
      }
    })
  }

  /**
   * Copies objects onto a board with the set's top-left at `at`. Board cards copy their
   * whole board (deep copy). Copies keep their stacking order and get their own groups.
   * Returns the new object ids in the same order as `ids`.
   */
  copyTo(ids: string[], targetBoardId: string, at: Point): string[] {
    this.boards.require(targetBoardId)
    const rows = this.rows(ids, { includeDeleted: false })
    if (rows.length === 0) return []
    const left = Math.min(...rows.map((r) => r.x))
    const top = Math.min(...rows.map((r) => r.y))
    const now = new Date()
    const newIds = new Map<string, string>()
    const groupIds = new Map<string, string>()

    this.db.transaction((tx) => {
      for (const row of [...rows].sort((a, b) => a.zIndex - b.zIndex)) {
        const position = { x: at.x + (row.x - left), y: at.y + (row.y - top) }
        const groupId = row.groupId ? remap(groupIds, row.groupId) : null
        if (row.type === 'board' && row.linkedBoardId) {
          const cardId = this.boards.duplicate(row.linkedBoardId, targetBoardId, position)
          tx.update(boardObjects)
            .set({ groupId, width: row.width, height: row.height })
            .where(eq(boardObjects.id, cardId))
            .run()
          newIds.set(row.id, cardId)
        } else {
          const id = randomUUID()
          tx.insert(boardObjects)
            .values({
              ...row,
              id,
              boardId: targetBoardId,
              ...position,
              zIndex: this.boards.topZ(targetBoardId) + 1,
              groupId,
              createdAt: now,
              updatedAt: now,
              deletedAt: null
            })
            .run()
          newIds.set(row.id, id)
        }
      }
    })
    return ids.filter((id) => newIds.has(id)).map((id) => newIds.get(id)!)
  }

  /** The board an object lives on (used to check clipboard pastes). */
  boardOf(id: string): string | undefined {
    return this.db
      .select({ boardId: boardObjects.boardId })
      .from(boardObjects)
      .innerJoin(boards, eq(boards.id, boardObjects.boardId))
      .where(and(eq(boardObjects.id, id), isNull(boardObjects.deletedAt), isNull(boards.deletedAt)))
      .get()?.boardId
  }

  private rows(ids: string[], { includeDeleted }: { includeDeleted: boolean }) {
    if (ids.length === 0) return []
    const rows = this.db
      .select()
      .from(boardObjects)
      .where(
        includeDeleted
          ? inArray(boardObjects.id, ids)
          : and(inArray(boardObjects.id, ids), isNull(boardObjects.deletedAt))
      )
      .all()
    if (rows.length !== new Set(ids).size) {
      throw new Error('Some items were not found. They may have been changed in another window.')
    }
    return rows
  }
}
