/** Moves slide and object comments when a stack gains, loses, or releases an image. */
import { and, eq, isNull } from 'drizzle-orm'
import { parseComment, type CommentAnchor } from '@shared/comments'
import type { CommentShift } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects } from '../db/schema'

type Shift =
  CommentShift | { op: 'attach-slide'; slideId: string } | { op: 'attach-stack'; stackId: string }

/** The undo of a comment move. Applied in reverse so a later move is undone first. */
export function invertCommentShifts(steps: CommentShift[]): Shift[] {
  return [...steps].reverse().map((step) => {
    if (step.op === 'slide-to-object') return { ...step, op: 'object-to-slide' }
    if (step.op === 'object-to-slide') return { ...step, op: 'slide-to-object' }
    if (step.op === 'detach-slide') return { op: 'attach-slide', slideId: step.slideId }
    return { op: 'attach-stack', stackId: step.stackId }
  })
}

export function shiftComments(db: ProjectDb, steps: Shift[]): void {
  if (steps.length === 0) return
  const rows = db
    .select()
    .from(boardObjects)
    .where(and(eq(boardObjects.type, 'comment'), isNull(boardObjects.deletedAt)))
    .all()
  const when = new Date()
  for (const row of rows) {
    const comment = parseComment(row.data)
    if (!comment || comment.anchor.detached === 'user') continue
    let anchor: CommentAnchor | null = comment.anchor
    for (const step of steps) anchor = anchor ? applyShift(anchor, step) : null
    if (!anchor || sameAnchor(anchor, comment.anchor)) continue
    db.update(boardObjects)
      .set({
        data: { ...comment, anchor },
        revision: row.revision + 1,
        updatedAt: when
      })
      .where(eq(boardObjects.id, row.id))
      .run()
  }
}

function applyShift(anchor: CommentAnchor, step: Shift): CommentAnchor {
  if (step.op === 'slide-to-object') {
    if (anchor.scope !== 'slide' || anchor.slideId !== step.slideId || anchor.detached !== 'none')
      return anchor
    return { ...anchor, scope: 'object', targetId: step.objectId, slideId: null, detached: 'none' }
  }
  if (step.op === 'object-to-slide') {
    if (
      anchor.scope !== 'object' ||
      anchor.targetId !== step.objectId ||
      anchor.detached !== 'none'
    )
      return anchor
    return {
      ...anchor,
      scope: 'slide',
      targetId: step.stackId,
      slideId: step.slideId,
      detached: 'none'
    }
  }
  if (step.op === 'detach-slide') {
    if (anchor.scope !== 'slide' || anchor.slideId !== step.slideId || anchor.detached !== 'none')
      return anchor
    return { ...anchor, detached: 'missing' }
  }
  if (step.op === 'attach-slide') {
    if (
      anchor.scope !== 'slide' ||
      anchor.slideId !== step.slideId ||
      anchor.detached !== 'missing'
    )
      return anchor
    return { ...anchor, detached: 'none' }
  }
  if (step.op === 'detach-stack') {
    if (anchor.scope !== 'stack' || anchor.targetId !== step.stackId || anchor.detached !== 'none')
      return anchor
    return { ...anchor, detached: 'missing' }
  }
  if (anchor.scope !== 'stack' || anchor.targetId !== step.stackId || anchor.detached !== 'missing')
    return anchor
  return { ...anchor, detached: 'none' }
}

function sameAnchor(left: CommentAnchor, right: CommentAnchor): boolean {
  return (
    left.scope === right.scope &&
    left.targetId === right.targetId &&
    left.slideId === right.slideId &&
    left.detached === right.detached
  )
}
