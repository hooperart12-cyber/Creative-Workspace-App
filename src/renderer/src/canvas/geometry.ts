import type { Point, Viewport } from '@shared/types'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Size {
  width: number
  height: number
}

export const MIN_ZOOM = 0.05
export const MAX_ZOOM = 8
/** Zoom levels used by +/- keys and buttons (like Figma's steps). */
export const ZOOM_STEPS = [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8]

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom))

export const screenToWorld = (p: Point, vp: Viewport): Point => ({
  x: (p.x - vp.x) / vp.zoom,
  y: (p.y - vp.y) / vp.zoom
})

export const worldToScreen = (p: Point, vp: Viewport): Point => ({
  x: p.x * vp.zoom + vp.x,
  y: p.y * vp.zoom + vp.y
})

/** Changes zoom while keeping the world point under `screenPoint` fixed (zoom to cursor). */
export function zoomAt(vp: Viewport, screenPoint: Point, zoom: number): Viewport {
  const next = clampZoom(zoom)
  const world = screenToWorld(screenPoint, vp)
  return { zoom: next, x: screenPoint.x - world.x * next, y: screenPoint.y - world.y * next }
}

/** Next zoom step in a direction (+1 in, -1 out). */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  const epsilon = 1e-6
  if (direction > 0) return ZOOM_STEPS.find((z) => z > zoom + epsilon) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((z) => z < zoom - epsilon) ?? MIN_ZOOM
}

/** Camera that shows `rect` centred in a view of `size`, never zooming in past `maxZoom`. */
export function fitViewport(rect: Rect, size: Size, padding = 64, maxZoom = 1): Viewport {
  const availableW = Math.max(1, size.width - padding * 2)
  const availableH = Math.max(1, size.height - padding * 2)
  const zoom = clampZoom(
    Math.min(maxZoom, availableW / Math.max(rect.width, 1), availableH / Math.max(rect.height, 1))
  )
  return {
    zoom,
    x: size.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: size.height / 2 - (rect.y + rect.height / 2) * zoom
  }
}

export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null
  const left = Math.min(...rects.map((r) => r.x))
  const top = Math.min(...rects.map((r) => r.y))
  const right = Math.max(...rects.map((r) => r.x + r.width))
  const bottom = Math.max(...rects.map((r) => r.y + r.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** Normalised rectangle between two corner points (for marquee selection). */
export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  }
}

export const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

export const containsPoint = (r: Rect, p: Point): boolean =>
  p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height

/** The visible world area for a viewport and screen size. */
export function visibleWorld(vp: Viewport, size: Size): Rect {
  const topLeft = screenToWorld({ x: 0, y: 0 }, vp)
  return { ...topLeft, width: size.width / vp.zoom, height: size.height / vp.zoom }
}
