import { describe, expect, it } from 'vitest'
import { assetUrl, pickVariant } from './assets'
import { positionForCenter, rotatedBounds, rotatedCenter } from './geometry'

const close = <T extends object>(actual: T, expected: Partial<Record<keyof T, number>>) => {
  for (const key of Object.keys(expected) as (keyof T)[]) {
    expect(actual[key]).toBeCloseTo(expected[key]!)
  }
}

describe('rotated geometry', () => {
  it('leaves unrotated objects alone', () => {
    expect(rotatedBounds({ x: 10, y: 20, width: 30, height: 40 })).toEqual({
      x: 10,
      y: 20,
      width: 30,
      height: 40
    })
  })

  it('rotates around the top-left corner', () => {
    close(rotatedBounds({ x: 0, y: 0, width: 100, height: 50, rotation: 90 }), {
      x: -50,
      y: 0,
      width: 50,
      height: 100
    })
    close(rotatedBounds({ x: 0, y: 0, width: 100, height: 100, rotation: 45 }), {
      x: -Math.SQRT1_2 * 100,
      y: 0,
      width: Math.SQRT2 * 100,
      height: Math.SQRT2 * 100
    })
  })

  it('finds and keeps the middle of rotated objects', () => {
    const o = { x: 0, y: 0, width: 100, height: 50, rotation: 90 }
    close(rotatedCenter(o), { x: -25, y: 50 })
    // Straightening around the middle.
    close(positionForCenter(rotatedCenter(o), 100, 50, 0), { x: -75, y: 25 })
    // Round trip at any angle.
    const p = positionForCenter({ x: 40, y: 60 }, 80, 20, 33)
    close(rotatedCenter({ ...p, width: 80, height: 20, rotation: 33 }), { x: 40, y: 60 })
  })
})

describe('image level of detail', () => {
  it('uses the smallest stored size that stays sharp', () => {
    expect(pickVariant(4000, 200)).toBe(256)
    expect(pickVariant(4000, 256)).toBe(256)
    expect(pickVariant(4000, 600)).toBe(1024)
    expect(pickVariant(4000, 1500)).toBe('original')
  })

  it('uses the original when it is no bigger than a thumbnail', () => {
    expect(pickVariant(200, 100)).toBe('original')
    expect(pickVariant(800, 200)).toBe(256)
    expect(pickVariant(800, 300)).toBe('original')
    expect(pickVariant(1024, 300)).toBe('original')
  })

  it('builds asset URLs', () => {
    expect(assetUrl('p1', 'ab'.repeat(32), 256)).toBe(`cw-asset://p1/${'ab'.repeat(32)}/256`)
  })
})
