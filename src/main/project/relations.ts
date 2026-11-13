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
import {
  boardObjects,
  boards,
  collectionPages,
  collections,
  commentMessages,
  linkPreviews,
  stackSlides
} from '../db/schema'
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

  /**
   * Lists broken references. A reference the user chose to keep is omitted.
   * Repair never deletes the connection, comment, or link.
   */
  integrity(): { kind: string; id: string; boardId: string; detail: string }[] {
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
    const boardIds = new Set(
      this.db
        .select({ id: boards.id })
        .from(boards)
        .where(isNull(boards.deletedAt))
        .all()
        .map((row) => row.id)
    )
    const slideIds = new Set(
      this.db
        .select({ id: stackSlides.id })
        .from(stackSlides)
        .all()
        .map((row) => row.id)
    )
    const collectionIds = new Set(
      this.db
        .select({ id: collections.id })
        .from(collections)
        .where(isNull(collections.deletedAt))
        .all()
        .map((row) => row.id)
    )
    const pageIds = new Set(
      this.db
        .select({ id: collectionPages.id })
        .from(collectionPages)
        .where(isNull(collectionPages.deletedAt))
        .all()
        .map((row) => row.id)
    )
    const issues: { kind: string; id: string; boardId: string; detail: string }[] = []
    for (const row of rows) {
      const data = row.data ?? {}
      if (row.type === 'connection') {
        const connection = parseConnection(data)
        for (const end of [connection?.start, connection?.end]) {
          if (end?.attachment?.missing && !end.attachment.userHeld)
            issues.push({
              kind: 'connection',
              id: row.id,
              boardId: row.boardId,
              detail: 'An endpoint is detached.'
            })
        }
      }
      if (row.type === 'comment') {
        const comment = parseComment(data)
        if (comment?.anchor.detached === 'missing')
          issues.push({
            kind: 'comment',
            id: row.id,
            boardId: row.boardId,
            detail: 'The commented item is missing.'
          })
      }
      if (row.type === 'link' && data.referenceHeld !== true) {
        const destination = parseDestination(data.destination)
        if (
          destination &&
          destinationMissing(destination, ids, boardIds, slideIds, collectionIds, pageIds)
        )
          issues.push({
            kind: 'link',
            id: row.id,
            boardId: row.boardId,
            detail: 'Destination missing.'
          })
      }
      if (
        row.type === 'board' &&
        typeof data.unavailableBoardId === 'string' &&
        data.boardReferenceHeld !== true
      ) {
        issues.push({
          kind: 'board',
          id: row.id,
          boardId: row.boardId,
          detail: 'Linked board is not in this project.'
        })
      }
    }
    return issues
  }

  repair(
    id: string,
    action: 'keep' | 'reattach' | 'clear'
  ): {
    type: string
    revision: number
    before: Record<string, unknown>
    previousLink: string | null
  } {
    const row = this.requireRow(id)
    if (
      row.type !== 'connection' &&
      row.type !== 'comment' &&
      row.type !== 'link' &&
      row.type !== 'board'
    ) {
      throw new Error('That item has no reference to repair.')
    }
    const before = { ...(row.data ?? {}) }
    const present = this.db
      .select({ id: boardObjects.id, groupId: boardObjects.groupId })
      .from(boardObjects)
      .where(isNull(boardObjects.deletedAt))
      .all()
    const live = new Set(present.map((item) => item.id))
    const groups = new Set(
      present.map((item) => item.groupId).filter((groupId): groupId is string => !!groupId)
    )
    const slides = new Set(
      this.db
        .select({ id: stackSlides.id })
        .from(stackSlides)
        .all()
        .map((slide) => slide.id)
    )
    const liveBoards = new Set(
      this.db
        .select({ id: boards.id })
        .from(boards)
        .where(isNull(boards.deletedAt))
        .all()
        .map((board) => board.id)
    )
    const collectionIds = new Set(
      this.db
        .select({ id: collections.id })
        .from(collections)
        .where(isNull(collections.deletedAt))
        .all()
        .map((item) => item.id)
    )
    const pageIds = new Set(
      this.db
        .select({ id: collectionPages.id })
        .from(collectionPages)
        .where(isNull(collectionPages.deletedAt))
        .all()
        .map((item) => item.id)
    )
    const next = repairedData(
      before,
      row.type,
      action,
      live,
      slides,
      groups,
      liveBoards,
      collectionIds,
      pageIds
    )
    let linkedBoardId: string | null | undefined
    if (typeof next.linkedWait === 'string') {
      linkedBoardId = next.linkedWait
      delete next.linkedWait
    }
    const saved = this.writeRow(id, row.revision, next, linkedBoardId)
    return {
      type: row.type,
      revision: saved.revision,
      before,
      previousLink: row.linkedBoardId
    }
  }

  restore(
    id: string,
    baseRevision: number,
    data: Record<string, unknown>,
    linkedBoardId?: string | null
  ): { revision: number } {
    const row = this.requireRow(id)
    if (
      row.type !== 'connection' &&
      row.type !== 'comment' &&
      row.type !== 'link' &&
      row.type !== 'board'
    ) {
      throw new Error('That item has no reference to repair.')
    }
    return this.writeRow(id, baseRevision, data, linkedBoardId)
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
    data: Record<string, unknown>,
    linkedBoardId?: string | null
  ): { revision: number } {
    const revision = baseRevision + 1
    const result = this.db
      .update(boardObjects)
      .set({
        data,
        revision,
        updatedAt: now(),
        ...(linkedBoardId !== undefined ? { linkedBoardId } : {})
      })
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

function destinationMissing(
  destination: Destination,
  liveObjects: Set<string>,
  liveBoards: Set<string>,
  liveSlides: Set<string>,
  liveCollections: Set<string>,
  livePages: Set<string>
): boolean {
  if (destination.kind === 'url') return false
  if (destination.kind === 'collection') return !liveCollections.has(destination.collectionId)
  if (destination.kind === 'page')
    return !livePages.has(destination.pageId) || !liveCollections.has(destination.collectionId)
  if (destination.kind === 'board' || destination.kind === 'camera')
    return !liveBoards.has(destination.boardId)
  if (destination.kind === 'slide')
    return !liveSlides.has(destination.slideId) || !liveObjects.has(destination.objectId)
  return !liveObjects.has(destination.objectId)
}

function repairedData(
  raw: Record<string, unknown>,
  type: string,
  action: 'keep' | 'reattach' | 'clear',
  liveObjects: Set<string>,
  liveSlides: Set<string>,
  liveGroups: Set<string>,
  liveBoards: Set<string>,
  liveCollections: Set<string>,
  livePages: Set<string>
): Record<string, unknown> {
  if (type === 'connection') {
    const connection = parseConnection(raw)
    if (!connection) throw new Error('That connection could not be read.')
    let changed = false
    for (const key of ['start', 'end'] as const) {
      const attachment = connection[key].attachment
      if (!attachment?.missing || attachment.userHeld) continue
      changed = true
      if (action === 'keep') {
        connection[key] = { ...connection[key], attachment: { ...attachment, userHeld: true } }
      } else if (action === 'clear') {
        connection[key] = { ...connection[key], attachment: null }
      } else {
        const present =
          attachment.kind === 'group'
            ? liveGroups.has(attachment.id)
            : liveObjects.has(attachment.id)
        if (!present) throw new Error('That item is still missing.')
        connection[key] = {
          ...connection[key],
          attachment: { ...attachment, missing: false, userHeld: false }
        }
      }
    }
    if (!changed) throw new Error('Nothing there needs repair.')
    return { ...connection }
  }
  if (type === 'comment') {
    const comment = parseComment(raw)
    if (!comment || comment.anchor.detached !== 'missing')
      throw new Error('Nothing there needs repair.')
    if (action === 'keep') return { ...comment, anchor: { ...comment.anchor, detached: 'user' } }
    if (action === 'clear') {
      return {
        ...comment,
        anchor: {
          ...comment.anchor,
          scope: 'free',
          targetId: null,
          slideId: null,
          detached: 'user'
        }
      }
    }
    const targetOk = !comment.anchor.targetId || liveObjects.has(comment.anchor.targetId)
    const slideOk = !comment.anchor.slideId || liveSlides.has(comment.anchor.slideId)
    if (!targetOk || !slideOk) throw new Error('That item is still missing.')
    return { ...comment, anchor: { ...comment.anchor, detached: 'none' } }
  }
  if (type === 'board') {
    const missingId = typeof raw.unavailableBoardId === 'string' ? raw.unavailableBoardId : null
    const held = raw.boardReferenceHeld === true
    const missing = !!missingId && !liveBoards.has(missingId)
    if (!missing && !held) throw new Error('Nothing there needs repair.')
    if (held && action !== 'reattach') throw new Error('Nothing there needs repair.')
    if (!missing && action !== 'reattach') throw new Error('Nothing there needs repair.')
    if (action === 'keep') return { ...raw, boardReferenceHeld: true }
    if (action === 'clear') {
      const next = { ...raw }
      delete next.unavailableBoardId
      delete next.boardReferenceHeld
      return next
    }
    if (missing || !missingId) throw new Error('That item is still missing.')
    const next: Record<string, unknown> = { ...raw, linkedWait: missingId }
    delete next.unavailableBoardId
    delete next.boardReferenceHeld
    return next
  }
  const destination = parseDestination(raw.destination)
  const missing =
    !!destination &&
    destinationMissing(destination, liveObjects, liveBoards, liveSlides, liveCollections, livePages)
  const held = raw.referenceHeld === true
  if (!missing && !held) throw new Error('Nothing there needs repair.')
  if (held && action !== 'reattach') throw new Error('Nothing there needs repair.')
  if (!missing && action !== 'reattach') throw new Error('Nothing there needs repair.')
  if (action === 'keep') return { ...raw, referenceHeld: true }
  if (action === 'clear') {
    const next = { ...raw }
    delete next.destination
    delete next.referenceHeld
    return next
  }
  if (missing) throw new Error('That item is still missing.')
  const next = { ...raw }
  delete next.referenceHeld
  return next
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
