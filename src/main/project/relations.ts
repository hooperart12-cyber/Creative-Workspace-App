/**
 * Connections, link cards, and comments (M8). They are board objects, so layer order,
 * locking, and trash already apply. This module owns their validated data and replies.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, min } from 'drizzle-orm'
import { parseComment, type CommentData } from '@shared/comments'
import {
  boundsOfPoints,
  connectionPoints,
  defaultConnection,
  parseConnection,
  type ConnectionData,
  type Point
} from '@shared/connections'
import { parseDestination, type Destination } from '@shared/destinations'
import type { CanvasObject } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects, boards, commentMessages, linkPreviews } from '../db/schema'
import type { BoardRepository } from './boards'

export const RELATION_CONFLICT = 'Another window changed this item. The change was not saved.'

const now = () => new Date()

function asData(
  value: ConnectionData | CommentData | Record<string, unknown>
): Record<string, unknown> {
  return { ...value }
}

export class RelationRepository {
  constructor(
    private readonly db: ProjectDb,
    private readonly boards: BoardRepository
  ) {}

  createConnection(
    boardId: string,
    start: Point,
    end: Point,
    data?: ConnectionData
  ): { id: string; revision: number } {
    this.boards.require(boardId)
    const stored = data ?? defaultConnection(start, end)
    const id = randomUUID()
    const bounds = boundsOfPoints(connectionPoints(stored))
    const bottom = this.db
      .select({ z: min(boardObjects.zIndex) })
      .from(boardObjects)
      .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
      .get()
    this.db
      .insert(boardObjects)
      .values({
        id,
        boardId,
        type: 'connection',
        ...bounds,
        zIndex: (bottom?.z ?? 0) - 1,
        data: asData(stored),
        createdAt: now(),
        updatedAt: now()
      })
      .run()
    return { id, revision: 0 }
  }

  updateConnection(id: string, baseRevision: number, data: ConnectionData): { revision: number } {
    const parsed = parseConnection(data)
    if (!parsed) throw new Error('That connection could not be saved.')
    return this.saveData(id, baseRevision, asData(parsed), 'connection')
  }

  createLink(
    boardId: string,
    at: Point,
    data: Record<string, unknown>
  ): { id: string; revision: number } {
    this.boards.require(boardId)
    const id = randomUUID()
    this.db
      .insert(boardObjects)
      .values({
        id,
        boardId,
        type: 'link',
        x: at.x,
        y: at.y,
        width: 240,
        height: 88,
        zIndex: this.boards.topZ(boardId) + 1,
        data,
        createdAt: now(),
        updatedAt: now()
      })
      .run()
    return { id, revision: 0 }
  }

  updateLink(
    id: string,
    baseRevision: number,
    data: Record<string, unknown>
  ): { revision: number } {
    return this.saveData(id, baseRevision, data, 'link')
  }

  /** Attaches or clears a destination on an existing object without replacing its other data. */
  setObjectLink(
    id: string,
    baseRevision: number,
    destination: Destination | null
  ): { revision: number } {
    const row = this.requireRow(id)
    if (row.revision !== baseRevision) throw new Error(RELATION_CONFLICT)
    const data = { ...(row.data ?? {}) }
    if (destination) data.navLink = destination
    else delete data.navLink
    return this.writeRow(id, baseRevision, data)
  }

  createComment(
    boardId: string,
    at: Point,
    data: CommentData,
    body: string
  ): { id: string; revision: number; messageId: string } {
    this.boards.require(boardId)
    const text = cleanBody(body)
    const id = randomUUID()
    const messageId = randomUUID()
    const stamp = now()
    this.db.transaction((tx) => {
      tx.insert(boardObjects)
        .values({
          id,
          boardId,
          type: 'comment',
          x: at.x,
          y: at.y,
          width: data.presentation === 'pin' ? 28 : 220,
          height: data.presentation === 'pin' ? 28 : 120,
          zIndex: this.boards.topZ(boardId) + 1,
          data: asData(data),
          createdAt: stamp,
          updatedAt: stamp
        })
        .run()
      tx.insert(commentMessages)
        .values({ id: messageId, commentId: id, body: text, createdAt: stamp, updatedAt: stamp })
        .run()
    })
    return { id, revision: 0, messageId }
  }

  updateComment(id: string, baseRevision: number, data: CommentData): { revision: number } {
    const parsed = parseComment(data)
    if (!parsed) throw new Error('That comment could not be saved.')
    return this.saveData(id, baseRevision, asData(parsed), 'comment')
  }

  addReply(
    id: string,
    baseRevision: number,
    body: string
  ): { revision: number; messageId: string } {
    const row = this.requireRow(id)
    if (row.type !== 'comment') throw new Error('Replies belong on a comment.')
    if (row.revision !== baseRevision) throw new Error(RELATION_CONFLICT)
    const messageId = randomUUID()
    const stamp = now()
    const revision = baseRevision + 1
    this.db.transaction((tx) => {
      const result = tx
        .update(boardObjects)
        .set({ revision, updatedAt: stamp })
        .where(
          and(
            eq(boardObjects.id, id),
            eq(boardObjects.revision, baseRevision),
            isNull(boardObjects.deletedAt)
          )
        )
        .run()
      if (result.changes !== 1) throw new Error(RELATION_CONFLICT)
      tx.insert(commentMessages)
        .values({
          id: messageId,
          commentId: id,
          body: cleanBody(body),
          createdAt: stamp,
          updatedAt: stamp
        })
        .run()
    })
    return { revision, messageId }
  }

  editReply(
    commentId: string,
    messageId: string,
    baseRevision: number,
    body: string
  ): { revision: number } {
    const stamp = now()
    const revision = baseRevision + 1
    this.db.transaction((tx) => {
      const result = tx
        .update(boardObjects)
        .set({ revision, updatedAt: stamp })
        .where(
          and(
            eq(boardObjects.id, commentId),
            eq(boardObjects.revision, baseRevision),
            isNull(boardObjects.deletedAt)
          )
        )
        .run()
      if (result.changes !== 1) throw new Error(RELATION_CONFLICT)
      const edited = tx
        .update(commentMessages)
        .set({ body: cleanBody(body), editedAt: stamp, updatedAt: stamp })
        .where(
          and(
            eq(commentMessages.id, messageId),
            eq(commentMessages.commentId, commentId),
            isNull(commentMessages.deletedAt)
          )
        )
        .run()
      if (edited.changes !== 1) throw new Error('That message is no longer there.')
    })
    return { revision }
  }

  deleteReply(commentId: string, messageId: string, baseRevision: number): { revision: number } {
    const stamp = now()
    const revision = baseRevision + 1
    this.db.transaction((tx) => {
      const result = tx
        .update(boardObjects)
        .set({ revision, updatedAt: stamp })
        .where(
          and(
            eq(boardObjects.id, commentId),
            eq(boardObjects.revision, baseRevision),
            isNull(boardObjects.deletedAt)
          )
        )
        .run()
      if (result.changes !== 1) throw new Error(RELATION_CONFLICT)
      tx.update(commentMessages)
        .set({ deletedAt: stamp, updatedAt: stamp })
        .where(and(eq(commentMessages.id, messageId), eq(commentMessages.commentId, commentId)))
        .run()
    })
    return { revision }
  }

  setBoardView(
    boardId: string,
    patch: { connectionDisplay?: string; crossingStyle?: string; commentView?: string }
  ): void {
    this.boards.require(boardId)
    const values: Partial<typeof boards.$inferInsert> = { updatedAt: now() }
    if (
      patch.connectionDisplay &&
      ['full', 'adaptive', 'minimal', 'hidden'].includes(patch.connectionDisplay)
    )
      values.connectionDisplay = patch.connectionDisplay
    if (patch.crossingStyle && ['plain', 'bridge', 'gap'].includes(patch.crossingStyle))
      values.crossingStyle = patch.crossingStyle
    if (patch.commentView && ['open', 'all', 'resolved', 'hidden'].includes(patch.commentView))
      values.commentView = patch.commentView
    this.db.update(boards).set(values).where(eq(boards.id, boardId)).run()
  }

  /** Comments and previews for the objects on a board. */
  decorate(objects: CanvasObject[]): CanvasObject[] {
    const commentIds = objects
      .filter((object) => object.type === 'comment')
      .map((object) => object.id)
    const linkIds = objects.filter((object) => object.type === 'link').map((object) => object.id)
    const messages = commentIds.length
      ? this.db
          .select()
          .from(commentMessages)
          .where(
            and(inArray(commentMessages.commentId, commentIds), isNull(commentMessages.deletedAt))
          )
          .orderBy(asc(commentMessages.createdAt))
          .all()
      : []
    const previews = linkIds.length
      ? this.db.select().from(linkPreviews).where(inArray(linkPreviews.objectId, linkIds)).all()
      : []
    const byComment = new Map<string, CanvasObject['messages']>()
    for (const message of messages) {
      const list = byComment.get(message.commentId) ?? []
      list.push({
        id: message.id,
        body: message.body,
        createdAt: message.createdAt.getTime(),
        editedAt: message.editedAt?.getTime() ?? null
      })
      byComment.set(message.commentId, list)
    }
    const byLink = new Map(previews.map((preview) => [preview.objectId, preview]))
    return objects.map((object) => {
      if (object.type === 'comment') return { ...object, messages: byComment.get(object.id) ?? [] }
      if (object.type !== 'link') return object
      const preview = byLink.get(object.id)
      return {
        ...object,
        preview: preview
          ? {
              url: preview.url,
              title: preview.title,
              description: preview.description,
              imageFile: preview.imageFile,
              fetchedAt: preview.fetchedAt.getTime(),
              error: preview.error
            }
          : null
      }
    })
  }

  integrity(): { kind: string; id: string; detail: string }[] {
    const rows = this.db
      .select()
      .from(boardObjects)
      .where(
        and(
          inArray(boardObjects.type, ['connection', 'link', 'comment']),
          isNull(boardObjects.deletedAt)
        )
      )
      .all()
    const ids = new Set(
      this.db
        .select({ id: boardObjects.id })
        .from(boardObjects)
        .where(isNull(boardObjects.deletedAt))
        .all()
        .map((row) => row.id)
    )
    const issues: { kind: string; id: string; detail: string }[] = []
    for (const row of rows) {
      const data = row.data ?? {}
      if (row.type === 'connection') {
        const connection = parseConnection(data)
        for (const end of [connection?.start, connection?.end]) {
          if (end?.attachment?.missing)
            issues.push({ kind: 'connection', id: row.id, detail: 'An endpoint is detached.' })
        }
      }
      if (row.type === 'comment') {
        const comment = parseComment(data)
        if (comment?.anchor.detached === 'missing')
          issues.push({ kind: 'comment', id: row.id, detail: 'The commented item is missing.' })
      }
      if (row.type === 'link') {
        const destination = parseDestination(data.destination)
        const objectId = destination && 'objectId' in destination ? destination.objectId : null
        if (objectId && !ids.has(objectId))
          issues.push({ kind: 'link', id: row.id, detail: 'Destination missing.' })
      }
    }
    return issues
  }

  private saveData(
    id: string,
    baseRevision: number,
    data: Record<string, unknown>,
    type: string
  ): { revision: number } {
    const row = this.requireRow(id)
    if (row.type !== type) throw new Error('That item is a different kind of object.')
    return this.writeRow(id, baseRevision, data)
  }

  private writeRow(
    id: string,
    baseRevision: number,
    data: Record<string, unknown>
  ): { revision: number } {
    const revision = baseRevision + 1
    const result = this.db
      .update(boardObjects)
      .set({ data, revision, updatedAt: now() })
      .where(
        and(
          eq(boardObjects.id, id),
          eq(boardObjects.revision, baseRevision),
          isNull(boardObjects.deletedAt)
        )
      )
      .run()
    if (result.changes !== 1) throw new Error(RELATION_CONFLICT)
    return { revision }
  }

  private requireRow(id: string) {
    const row = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.id, id), isNull(boardObjects.deletedAt)))
      .get()
    if (!row) throw new Error('Object not found. It may have been deleted.')
    return row
  }
}

function cleanBody(body: string): string {
  const text = body.trim()
  if (!text) throw new Error('Write something before posting.')
  if (text.length > 10000) throw new Error('That comment is too long.')
  return text
}

export {
  commentIdsMovingWith,
  detachFromTargets,
  reattachTargets,
  remapCopiedData
} from './relationRepair'
