/** Keeps connections and comments attached to the right objects when content is copied or removed. */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { parseComment } from '@shared/comments'
import { parseConnection, remapConnection } from '@shared/connections'
import { parseDestination, remapDestination } from '@shared/destinations'
import type { ProjectDb } from '../db/client'
import { boardObjects, commentMessages, taggings, tags } from '../db/schema'

const stamp = () => new Date()

function asData(value: object): Record<string, unknown> {
  return { ...value }
}

/** After objects leave a board, keep their connections and comments and remember who they pointed at. */
export function detachFromTargets(
  db: ProjectDb,
  removedIds: string[],
  movedWith: string[] = []
): void {
  if (removedIds.length === 0) return
  const gone = new Set(removedIds)
  const travelled = new Set(movedWith)
  const rows = db
    .select()
    .from(boardObjects)
    .where(
      and(inArray(boardObjects.type, ['connection', 'comment']), isNull(boardObjects.deletedAt))
    )
    .all()
  const when = stamp()
  for (const row of rows) {
    if (row.type === 'connection') {
      const data = parseConnection(row.data)
      if (!data) continue
      let changed = false
      for (const key of ['start', 'end'] as const) {
        const attachment = data[key].attachment
        if (
          attachment &&
          gone.has(attachment.id) &&
          !attachment.userHeld &&
          !travelled.has(row.id)
        ) {
          data[key] = { ...data[key], attachment: { ...attachment, missing: true } }
          changed = true
        }
      }
      if (changed)
        db.update(boardObjects)
          .set({ data: asData(data), updatedAt: when })
          .where(eq(boardObjects.id, row.id))
          .run()
    }
    if (row.type === 'comment') {
      const data = parseComment(row.data)
      if (
        !data?.anchor.targetId ||
        !gone.has(data.anchor.targetId) ||
        data.anchor.detached === 'user'
      )
        continue
      data.anchor = { ...data.anchor, detached: 'missing' }
      db.update(boardObjects)
        .set({ data: asData(data), updatedAt: when })
        .where(eq(boardObjects.id, row.id))
        .run()
    }
  }
}

/** Puts an endpoint or comment back only when the user has not chosen a new place. */
export function reattachTargets(db: ProjectDb, restoredIds: string[]): void {
  if (restoredIds.length === 0) return
  const back = new Set(restoredIds)
  const rows = db
    .select()
    .from(boardObjects)
    .where(
      and(inArray(boardObjects.type, ['connection', 'comment']), isNull(boardObjects.deletedAt))
    )
    .all()
  const when = stamp()
  for (const row of rows) {
    if (row.type === 'connection') {
      const data = parseConnection(row.data)
      if (!data) continue
      let changed = false
      for (const key of ['start', 'end'] as const) {
        const attachment = data[key].attachment
        if (attachment?.missing && !attachment.userHeld && back.has(attachment.id)) {
          data[key] = { ...data[key], attachment: { ...attachment, missing: false } }
          changed = true
        }
      }
      if (changed)
        db.update(boardObjects)
          .set({ data: asData(data), updatedAt: when })
          .where(eq(boardObjects.id, row.id))
          .run()
    }
    if (row.type === 'comment') {
      const data = parseComment(row.data)
      if (
        data?.anchor.detached === 'missing' &&
        data.anchor.targetId &&
        back.has(data.anchor.targetId)
      ) {
        data.anchor = { ...data.anchor, detached: 'none' }
        db.update(boardObjects)
          .set({ data: asData(data), updatedAt: when })
          .where(eq(boardObjects.id, row.id))
          .run()
      }
    }
  }
}

/** Points copied connections, comments, and links at the copied targets. Outside references stay. */
export function remapCopiedData(
  db: ProjectDb,
  ids: Map<string, string>,
  detachOutside: boolean
): void {
  const created = [...ids.values()]
  if (created.length === 0) return
  const rows = db.select().from(boardObjects).where(inArray(boardObjects.id, created)).all()
  const when = stamp()
  for (const row of rows) {
    const data = remapObjectData(row.type, row.data, ids, detachOutside)
    if (data)
      db.update(boardObjects)
        .set({ data, updatedAt: when })
        .where(eq(boardObjects.id, row.id))
        .run()
    if (row.type === 'connection' || row.type === 'link' || row.type === 'comment') {
      const source = [...ids.entries()].find(([, next]) => next === row.id)?.[0]
      if (source) copyObjectTags(db, source, row.id)
    }
  }
  for (const [fromId, toId] of ids) {
    const messages = db
      .select()
      .from(commentMessages)
      .where(and(eq(commentMessages.commentId, fromId), isNull(commentMessages.deletedAt)))
      .all()
    for (const message of messages) {
      db.insert(commentMessages)
        .values({
          ...message,
          id: randomUUID(),
          commentId: toId,
          createdAt: when,
          updatedAt: when,
          deletedAt: null
        })
        .run()
    }
  }
}

/** Comments attached to a moved object travel with it. Connections stay on the original board. */
export function commentIdsMovingWith(db: ProjectDb, objectIds: string[]): string[] {
  const moving = new Set(objectIds)
  const rows = db
    .select()
    .from(boardObjects)
    .where(and(eq(boardObjects.type, 'comment'), isNull(boardObjects.deletedAt)))
    .all()
  return rows.flatMap((row) => {
    if (moving.has(row.id)) return []
    const comment = parseComment(row.data)
    return comment?.anchor.targetId && moving.has(comment.anchor.targetId) ? [row.id] : []
  })
}

function remapObjectData(
  type: string,
  raw: Record<string, unknown> | null,
  ids: Map<string, string>,
  detachOutside: boolean
): Record<string, unknown> | null {
  const data = { ...(raw ?? {}) }
  let changed = false
  if (type === 'connection') {
    const connection = parseConnection(data)
    if (connection) return asData(remapConnection(connection, ids, detachOutside))
  }
  if (type === 'comment') {
    const comment = parseComment(data)
    if (comment?.anchor.targetId) {
      const next = ids.get(comment.anchor.targetId)
      if (next) comment.anchor = { ...comment.anchor, targetId: next, detached: 'none' }
      else if (detachOutside) comment.anchor = { ...comment.anchor, detached: 'missing' }
      changed = true
    }
    if (comment?.anchor.slideId && ids.has(comment.anchor.slideId)) {
      comment.anchor = { ...comment.anchor, slideId: ids.get(comment.anchor.slideId)! }
      changed = true
    }
    if (comment && changed) return asData(comment)
  }
  if (type === 'link' && data.destination) {
    const destination = parseDestination(data.destination)
    if (destination) {
      data.destination = remapDestination(destination, ids, detachOutside)
      changed = true
    }
  }
  if (data.navLink) {
    const destination = parseDestination(data.navLink)
    if (destination) {
      const next = remapDestination(destination, ids, detachOutside)
      if (next) data.navLink = next
      else delete data.navLink
      changed = true
    }
  }
  return changed ? data : null
}

function copyObjectTags(db: ProjectDb, fromId: string, toId: string): void {
  const when = stamp()
  const assigned = db
    .select()
    .from(taggings)
    .where(and(eq(taggings.targetType, 'object'), eq(taggings.targetId, fromId)))
    .all()
  for (const row of assigned) {
    db.insert(taggings)
      .values({
        id: randomUUID(),
        tagId: row.tagId,
        targetType: 'object',
        targetId: toId,
        createdAt: when
      })
      .run()
  }
  const oneOffs = db
    .select()
    .from(tags)
    .where(
      and(
        eq(tags.reusable, false),
        isNull(tags.deletedAt),
        eq(tags.ownerType, 'object'),
        eq(tags.ownerId, fromId)
      )
    )
    .all()
  for (const row of oneOffs) {
    db.insert(tags)
      .values({
        id: randomUUID(),
        name: row.name,
        normalizedName: row.normalizedName,
        color: row.color,
        reusable: false,
        ownerType: 'object',
        ownerId: toId,
        createdAt: when,
        updatedAt: when
      })
      .run()
  }
}
