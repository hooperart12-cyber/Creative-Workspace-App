/** Geometry shared by the main process and the canvas. */

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Axis-aligned bounds of an object as drawn. Objects rotate around their top-left
 * corner (x, y), which is how Konva positions rotated nodes.
 */
export function rotatedBounds(o: Box & { rotation?: number }): Box {
  const rotation = o.rotation ?? 0
  if (rotation % 360 === 0) return { x: o.x, y: o.y, width: o.width, height: o.height }
  const rad = (rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const corners = [
    [0, 0],
    [o.width, 0],
    [o.width, o.height],
    [0, o.height]
  ].map(([cx, cy]) => ({ x: o.x + cx * cos - cy * sin, y: o.y + cx * sin + cy * cos }))
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  const left = Math.min(...xs)
  const top = Math.min(...ys)
  return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top }
}
