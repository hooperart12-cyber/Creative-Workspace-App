import { describe, expect, it } from 'vitest'
import {
  MAX_ZOOM,
  MIN_ZOOM,
  boundsOf,
  fitViewport,
  intersects,
  rectFromPoints,
  screenToWorld,
  stepZoom,
  visibleWorld,
  worldToScreen,
  zoomAt
} from './geometry'

describe('camera math', () => {
  const vp = { x: 100, y: 50, zoom: 2 }

  it('converts between screen and world coordinates', () => {
    expect(screenToWorld({ x: 300, y: 250 }, vp)).toEqual({ x: 100, y: 100 })
    expect(worldToScreen({ x: 100, y: 100 }, vp)).toEqual({ x: 300, y: 250 })
  })

  it('zooms toward the cursor, keeping the point under it fixed', () => {
    const cursor = { x: 400, y: 300 }
    const before = screenToWorld(cursor, vp)
    const next = zoomAt(vp, cursor, 4)
    expect(next.zoom).toBe(4)
    expect(screenToWorld(cursor, next)).toEqual(before)
  })

  it('clamps zoom to the allowed range', () => {
    expect(zoomAt(vp, { x: 0, y: 0 }, 100).zoom).toBe(MAX_ZOOM)
    expect(zoomAt(vp, { x: 0, y: 0 }, 0).zoom).toBe(MIN_ZOOM)
  })

  it('steps through zoom levels', () => {
    expect(stepZoom(1, 1)).toBe(1.5)
    expect(stepZoom(1, -1)).toBe(0.75)
    expect(stepZoom(0.8, -1)).toBe(0.75)
    expect(stepZoom(MAX_ZOOM, 1)).toBe(MAX_ZOOM)
    expect(stepZoom(MIN_ZOOM, -1)).toBe(MIN_ZOOM)
  })

  it('fits content in view, centred, without zooming past 100%', () => {
    const size = { width: 1000, height: 600 }
    const small = fitViewport({ x: 0, y: 0, width: 100, height: 100 }, size)
    expect(small.zoom).toBe(1)
    expect(worldToScreen({ x: 50, y: 50 }, small)).toEqual({ x: 500, y: 300 })

    const big = fitViewport({ x: -1000, y: 0, width: 4000, height: 1000 }, size, 50)
    expect(big.zoom).toBeCloseTo(900 / 4000)
    const visible = visibleWorld(big, size)
    expect(visible.x).toBeLessThanOrEqual(-1000)
    expect(visible.x + visible.width).toBeGreaterThanOrEqual(3000)
  })
})

describe('rectangles', () => {
  it('computes combined bounds', () => {
    expect(boundsOf([])).toBeNull()
    expect(
      boundsOf([
        { x: 0, y: 10, width: 10, height: 10 },
        { x: 50, y: -5, width: 20, height: 5 }
      ])
    ).toEqual({ x: 0, y: -5, width: 70, height: 25 })
  })

  it('builds a marquee rectangle from any two corners', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({
      x: 0,
      y: 5,
      width: 10,
      height: 15
    })
  })

  it('detects overlap (touching edges do not count)', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 }
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true)
    expect(intersects(a, { x: 10, y: 0, width: 10, height: 10 })).toBe(false)
  })
})
