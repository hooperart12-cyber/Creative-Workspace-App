/** Picture and package export choices shared by the canvas and the tests. */
import { parseComment, visibleInView, type CommentView } from './comments'
import { boundsOfPoints, connectionPoints, labelPosition, parseConnection } from './connections'
import { rotatedBounds, type Box } from './geometry'

export type ExportVisibility = 'current' | 'show' | 'hide'

export interface ExportCapture {
  connections: ExportVisibility
  comments: ExportVisibility
}

/** How a picture should draw connections. Hide stays hidden. Show uses full detail. */
export function exportConnectionDisplay(current: string, choice: ExportVisibility): string {
  if (choice === 'hide') return 'hidden'
  if (choice === 'show') return 'full'
  return current
}

/** How a picture should draw comments. Show means every status, not a delete. */
export function exportCommentView(current: string, choice: ExportVisibility): string {
  if (choice === 'hide') return 'hidden'
  if (choice === 'show') return 'all'
  return current
}

interface ExportObject {
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation?: number
  data: unknown
}

/**
 * World boxes of what a picture will draw. A connection is measured from its line,
 * bends, and label. Its stored card size is only a placeholder and would clip the line.
 */
export function pictureBoxes(
  objects: ExportObject[],
  connectionDisplay: string,
  commentView: string
): Box[] {
  const boxes: Box[] = []
  for (const object of objects) {
    if (object.type === 'connection') {
      if (connectionDisplay === 'hidden') continue
      const data = parseConnection(object.data)
      if (!data) continue
      const points = connectionPoints(data)
      if (data.label?.text) points.push(labelPosition(points, data.label))
      if (points.length > 0) boxes.push(boundsOfPoints(points, 48))
      continue
    }
    if (object.type === 'comment') {
      const comment = parseComment(object.data)
      if (!comment || !visibleInView(comment.status, commentView as CommentView, false)) continue
    }
    boxes.push(rotatedBounds(object))
  }
  return boxes
}

/** World bounds of the artwork, with padding. An empty board still has a page. */
export function contentFrame(boxes: Box[], padding = 48): Box {
  if (boxes.length === 0) return { x: 0, y: 0, width: 960, height: 640 }
  const left = Math.min(...boxes.map((box) => box.x)) - padding
  const top = Math.min(...boxes.map((box) => box.y)) - padding
  const right = Math.max(...boxes.map((box) => box.x + box.width)) + padding
  const bottom = Math.max(...boxes.map((box) => box.y + box.height)) + padding
  return { x: left, y: top, width: Math.max(1, right - left), height: Math.max(1, bottom - top) }
}

/**
 * Pixels per world unit. Small boards stay sharp. A long edge stops at 8192 device pixels
 * so a large board is not clipped and does not allocate an unbounded image.
 */
export function picturePixelRatio(width: number, height: number): number {
  const long = Math.max(width, height, 1)
  let ratio = 2
  if (long * ratio < 1200) ratio = Math.min(4, 1200 / long)
  if (long * ratio > 8192) ratio = 8192 / long
  return Math.max(0.25, ratio)
}
