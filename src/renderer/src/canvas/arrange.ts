import type { CanvasObject, ObjectPatch } from '@shared/types'
import type { Point } from '@shared/types'
import { boundsOf, containsPoint, objectBounds, type Rect } from './geometry'
import { lockedAspectRatio } from './objectTypes'

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom'
export type DistributeAxis = 'horizontal' | 'vertical'
export type ZOrderOp = 'forward' | 'backward' | 'front' | 'back'

/**
 * Aligns objects to the edges or centre of their combined bounds. Rotated objects align by
 * the area they cover on screen; objects only move, never change size.
 */
export function align(objects: CanvasObject[], mode: AlignMode): ObjectPatch[] {
  const boxes = new Map(objects.map((o) => [o.id, objectBounds(o)]))
  const b = boundsOf([...boxes.values()])
  if (!b || objects.length < 2) return []
  return objects
    .map((o) => {
      const box = boxes.get(o.id)!
      switch (mode) {
        case 'left':
          return { id: o.id, x: o.x + b.x - box.x }
        case 'hcenter':
          return { id: o.id, x: o.x + b.x + (b.width - box.width) / 2 - box.x }
        case 'right':
          return { id: o.id, x: o.x + b.x + b.width - box.width - box.x }
        case 'top':
          return { id: o.id, y: o.y + b.y - box.y }
        case 'vcenter':
          return { id: o.id, y: o.y + b.y + (b.height - box.height) / 2 - box.y }
        case 'bottom':
          return { id: o.id, y: o.y + b.y + b.height - box.height - box.y }
      }
    })
    .filter((p) => changed(objects, p))
}

/** Spaces objects so the gaps between them are equal; the first and last stay put. */
export function distribute(objects: CanvasObject[], axis: DistributeAxis): ObjectPatch[] {
  if (objects.length < 3) return []
  const pos = axis === 'horizontal' ? 'x' : 'y'
  const size = axis === 'horizontal' ? 'width' : 'height'
  const items = objects.map((o) => ({ o, box: objectBounds(o) }))
  const sorted = items.sort((a, b) => a.box[pos] - b.box[pos])
  const first = sorted[0].box
  const last = sorted[sorted.length - 1].box
  const span = last[pos] + last[size] - first[pos]
  const totalSize = sorted.reduce((sum, { box }) => sum + box[size], 0)
  const gap = (span - totalSize) / (sorted.length - 1)
  const patches: ObjectPatch[] = []
  let cursor = first[pos] + first[size] + gap
  for (const { o, box } of sorted.slice(1, -1)) {
    patches.push({ id: o.id, [pos]: o[pos] + cursor - box[pos] })
    cursor += box[size] + gap
  }
  return patches.filter((p) => changed(objects, p))
}

/**
 * Makes every object as wide and/or tall as the largest one. Images keep their aspect
 * ratio: they scale to the target width or height, and for "both" fit inside that box.
 */
export function matchSize(
  objects: CanvasObject[],
  dimension: 'width' | 'height' | 'both'
): ObjectPatch[] {
  if (objects.length < 2) return []
  const width = Math.max(...objects.map((o) => o.width))
  const height = Math.max(...objects.map((o) => o.height))
  return objects
    .map((o): ObjectPatch => {
      const ratio = lockedAspectRatio(o)
      if (ratio) {
        const scale =
          dimension === 'width'
            ? width / o.width
            : dimension === 'height'
              ? height / o.height
              : Math.min(width / o.width, height / o.height)
        return { id: o.id, width: o.width * scale, height: (o.width * scale) / ratio }
      }
      return {
        id: o.id,
        ...(dimension !== 'height' ? { width } : {}),
        ...(dimension !== 'width' ? { height } : {})
      }
    })
    .filter((p) => changed(objects, p))
}

/** Reorders the selection in the stack; returns new zIndex values for objects that moved. */
export function reorder(all: CanvasObject[], selected: Set<string>, op: ZOrderOp): ObjectPatch[] {
  const order = [...all].sort((a, b) => a.zIndex - b.zIndex).map((o) => o.id)
  let next = [...order]
  const inSelection = order.filter((id) => selected.has(id))
  const rest = order.filter((id) => !selected.has(id))
  if (op === 'front') next = [...rest, ...inSelection]
  if (op === 'back') next = [...inSelection, ...rest]
  if (op === 'forward') {
    for (let i = next.length - 2; i >= 0; i--) {
      if (selected.has(next[i]) && !selected.has(next[i + 1])) {
        ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
      }
    }
  }
  if (op === 'backward') {
    for (let i = 1; i < next.length; i++) {
      if (selected.has(next[i]) && !selected.has(next[i - 1])) {
        ;[next[i], next[i - 1]] = [next[i - 1], next[i]]
      }
    }
  }
  if (next.join() === order.join()) return []
  // Renumber the stack 1..n; only send objects whose number actually changes.
  const zById = new Map(all.map((o) => [o.id, o.zIndex]))
  return next
    .map((id, index) => ({ id, zIndex: index + 1 }))
    .filter((p) => zById.get(p.id) !== p.zIndex)
}

/** Adds every member of any group touched by `ids` (grouped objects select and move together). */
export function expandToGroups(ids: Iterable<string>, objects: CanvasObject[]): Set<string> {
  const result = new Set(ids)
  const groups = new Set(
    objects.filter((o) => result.has(o.id) && o.groupId).map((o) => o.groupId as string)
  )
  for (const o of objects) if (o.groupId && groups.has(o.groupId)) result.add(o.id)
  return result
}

export const snapToGrid = (value: number, grid: number): number => Math.round(value / grid) * grid

export interface Guide {
  orientation: 'vertical' | 'horizontal'
  /** World coordinate of the line (x for vertical, y for horizontal). */
  position: number
  from: number
  to: number
}

/**
 * Smart alignment guides (Figma-style): if the moving rectangle's edges or centre come
 * within `threshold` of another object's edges or centre, snap to it and show a guide.
 */
export function smartSnap(
  moving: Rect,
  others: Rect[],
  threshold: number
): { dx: number; dy: number; guides: Guide[] } {
  const xs = (r: Rect) => [r.x, r.x + r.width / 2, r.x + r.width]
  const ys = (r: Rect) => [r.y, r.y + r.height / 2, r.y + r.height]

  let bestX: { delta: number; position: number } | null = null
  let bestY: { delta: number; position: number } | null = null
  for (const other of others) {
    for (const mx of xs(moving)) {
      for (const ox of xs(other)) {
        const delta = ox - mx
        if (Math.abs(delta) <= threshold && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, position: ox }
        }
      }
    }
    for (const my of ys(moving)) {
      for (const oy of ys(other)) {
        const delta = oy - my
        if (Math.abs(delta) <= threshold && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, position: oy }
        }
      }
    }
  }

  const dx = bestX?.delta ?? 0
  const dy = bestY?.delta ?? 0
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy }
  const guides: Guide[] = []
  if (bestX) {
    const aligned = others.filter((o) => xs(o).some((v) => Math.abs(v - bestX!.position) < 0.5))
    const span = [snapped, ...aligned]
    guides.push({
      orientation: 'vertical',
      position: bestX.position,
      from: Math.min(...span.map((r) => r.y)),
      to: Math.max(...span.map((r) => r.y + r.height))
    })
  }
  if (bestY) {
    const aligned = others.filter((o) => ys(o).some((v) => Math.abs(v - bestY!.position) < 0.5))
    const span = [snapped, ...aligned]
    guides.push({
      orientation: 'horizontal',
      position: bestY.position,
      from: Math.min(...span.map((r) => r.x)),
      to: Math.max(...span.map((r) => r.x + r.width))
    })
  }
  return { dx, dy, guides }
}

/** Topmost board card under `point` that isn't being dragged: where dropped cards would nest. */
export function findDropTarget(
  objects: CanvasObject[],
  dragged: Set<string>,
  point: Point
): CanvasObject | undefined {
  return [...objects]
    .sort((a, b) => b.zIndex - a.zIndex)
    .find((o) => o.type === 'board' && !dragged.has(o.id) && containsPoint(objectBounds(o), point))
}

function changed(objects: CanvasObject[], patch: ObjectPatch): boolean {
  const o = objects.find((x) => x.id === patch.id)!
  return (Object.keys(patch) as (keyof ObjectPatch)[]).some(
    (key) => key !== 'id' && Math.abs((patch[key] as number) - (o[key] as number)) > 1e-9
  )
}
