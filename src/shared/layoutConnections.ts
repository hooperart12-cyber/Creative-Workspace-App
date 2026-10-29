/** Fills in connection endpoints from the objects currently on the board. */
import type { CanvasObject } from './types'
import { rotatedBounds } from './geometry'
import {
  boundsOfPoints,
  connectionPoints,
  parseConnection,
  resolveConnection,
  type Obstacle,
  type ResolvedWorld,
  type TargetBox
} from './connections'

export function layoutConnections(objects: CanvasObject[]): CanvasObject[] {
  const boxes = new Map<string, TargetBox>()
  const groups = new Map<string, TargetBox[]>()
  const obstacles: Obstacle[] = []
  for (const object of objects) {
    if (object.type === 'connection') continue
    const box: TargetBox = {
      id: object.id,
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
      rotation: object.rotation
    }
    boxes.set(object.id, box)
    if (object.groupId) {
      const list = groups.get(object.groupId) ?? []
      list.push(box)
      groups.set(object.groupId, list)
    }
    obstacles.push({ id: object.id, box: rotatedBounds(object) })
  }
  const world: ResolvedWorld = { objects: boxes, groups }
  return objects.map((object) => {
    if (object.type !== 'connection') return object
    const data = parseConnection(object.data)
    if (!data) return object
    const resolved = resolveConnection(data, world)
    const points = connectionPoints(resolved, resolved.routing === 'avoid' ? obstacles : [])
    const bounds = boundsOfPoints(points)
    return {
      ...object,
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      data: { ...resolved }
    }
  })
}
