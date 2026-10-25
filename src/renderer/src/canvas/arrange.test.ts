import { describe, expect, it } from 'vitest'
import type { CanvasObject } from '@shared/types'
import {
  align,
  distribute,
  expandToGroups,
  findDropTarget,
  matchSize,
  reorder,
  smartSnap,
  snapToGrid
} from './arrange'

function obj(
  id: string,
  x: number,
  y: number,
  w = 100,
  h = 100,
  extra: Partial<CanvasObject> = {}
): CanvasObject {
  return {
    id,
    boardId: 'b',
    type: 'board',
    x,
    y,
    width: w,
    height: h,
    rotation: 0,
    zIndex: 0,
    locked: false,
    groupId: null,
    linkedBoardId: null,
    assetId: null,
    data: {},
    revision: 0,
    ...extra
  }
}

describe('align', () => {
  const objects = [obj('a', 0, 0, 100, 50), obj('b', 200, 100, 50, 50)]
  it('aligns edges and centres to the selection bounds', () => {
    expect(align(objects, 'left')).toEqual([{ id: 'b', x: 0 }])
    expect(align(objects, 'right')).toEqual([{ id: 'a', x: 150 }])
    expect(align(objects, 'hcenter')).toEqual([
      { id: 'a', x: 75 },
      { id: 'b', x: 100 }
    ])
    expect(align(objects, 'bottom')).toEqual([{ id: 'a', y: 100 }])
  })
  it('needs at least two objects', () => {
    expect(align([objects[0]], 'left')).toEqual([])
  })
})

describe('distribute', () => {
  it('makes gaps equal, keeping the outermost objects in place', () => {
    const objects = [obj('a', 0, 0, 100), obj('c', 500, 0, 100), obj('b', 120, 0, 100)]
    // span 0..600, total width 300, gap 150 → b at 250
    expect(distribute(objects, 'horizontal')).toEqual([{ id: 'b', x: 250 }])
  })
  it('needs at least three objects', () => {
    expect(distribute([obj('a', 0, 0), obj('b', 10, 0)], 'vertical')).toEqual([])
  })
})

describe('matchSize', () => {
  it('matches the largest width and/or height', () => {
    const objects = [obj('a', 0, 0, 100, 40), obj('b', 0, 0, 60, 80)]
    expect(matchSize(objects, 'width')).toEqual([{ id: 'b', width: 100 }])
    expect(matchSize(objects, 'both')).toEqual([
      { id: 'a', width: 100, height: 80 },
      { id: 'b', width: 100, height: 80 }
    ])
  })
})

const image = (id: string, x: number, y: number, w: number, h: number, extra = {}) =>
  obj(id, x, y, w, h, {
    type: 'image',
    asset: {
      id: `asset-${id}`,
      sha256: 'a'.repeat(64),
      originalName: `${id}.png`,
      mime: 'image/png',
      ext: 'png',
      bytes: 1,
      width: w * 10,
      height: h * 10,
      hasAlpha: true,
      pageCount: null,
      previewAssetId: null,
      preview: null
    },
    ...extra
  })

describe('images in arrangement', () => {
  it('keeps image proportions when matching sizes', () => {
    const objects = [obj('card', 0, 0, 300, 100), image('wide', 0, 0, 200, 100)]
    expect(matchSize(objects, 'width')).toEqual([{ id: 'wide', width: 300, height: 150 }])
    expect(matchSize(objects, 'height')).toEqual([])
    // "Both": the image fits inside 300 × 400 instead of stretching.
    expect(matchSize([obj('card', 0, 0, 300, 400), image('tall', 0, 0, 100, 200)], 'both')).toEqual(
      [{ id: 'tall', width: 200, height: 400 }]
    )
  })

  it('aligns rotated objects by the area they cover', () => {
    // Rotated 90° around its top-left corner, a 100 × 50 image covers x -50..0, y 0..100.
    const rotated = image('r', 0, 0, 100, 50, { rotation: 90 })
    const plain = obj('p', 100, 200, 50, 50)
    const patches = align([rotated, plain], 'left')
    expect(patches).toEqual([{ id: 'p', x: -50 }])
    const right = align([rotated, plain], 'right')
    // Bounds span -50..150; the rotated image's right edge (0) moves to 150.
    expect(right).toEqual([{ id: 'r', x: 150 }])
  })

  it('distributes by the area objects cover', () => {
    const objects = [
      obj('a', 0, 0, 100, 100),
      image('r', 300, 0, 100, 50, { rotation: 90 }), // covers x 250..300
      obj('c', 500, 0, 100, 100)
    ]
    // span 0..600, sizes 100 + 50 + 100, gap 175 → the image covers 275..325, so x = 325
    const [patch] = distribute(objects, 'horizontal')
    expect(patch.id).toBe('r')
    expect(patch.x).toBeCloseTo(325)
  })

  it('finds drop targets under rotated board cards', () => {
    const card = obj('card', 0, 0, 200, 100, { rotation: 90 }) // covers x -100..0
    expect(findDropTarget([card], new Set(), { x: -50, y: 50 })?.id).toBe('card')
    expect(findDropTarget([card], new Set(), { x: 50, y: 50 })).toBeUndefined()
  })
})

describe('reorder (z-order)', () => {
  const stack = [
    obj('a', 0, 0, 1, 1, { zIndex: 1 }),
    obj('b', 0, 0, 1, 1, { zIndex: 2 }),
    obj('c', 0, 0, 1, 1, { zIndex: 3 }),
    obj('d', 0, 0, 1, 1, { zIndex: 4 })
  ]
  const order = (patches: { id: string; zIndex?: number }[]) => {
    const z = new Map(stack.map((o) => [o.id, o.zIndex]))
    for (const p of patches) z.set(p.id, p.zIndex!)
    return [...z.entries()]
      .sort((x, y) => x[1] - y[1])
      .map(([id]) => id)
      .join('')
  }

  it('brings to front / sends to back', () => {
    expect(order(reorder(stack, new Set(['a', 'c']), 'front'))).toBe('bdac')
    expect(order(reorder(stack, new Set(['d']), 'back'))).toBe('dabc')
  })
  it('moves one step forward / backward', () => {
    expect(order(reorder(stack, new Set(['b']), 'forward'))).toBe('acbd')
    expect(order(reorder(stack, new Set(['c']), 'backward'))).toBe('acbd')
  })
  it('does nothing when already in place', () => {
    expect(reorder(stack, new Set(['d']), 'front')).toEqual([])
    expect(reorder(stack, new Set(['a']), 'backward')).toEqual([])
  })
})

describe('groups', () => {
  it('expands a selection to whole groups', () => {
    const objects = [
      obj('a', 0, 0, 1, 1, { groupId: 'g' }),
      obj('b', 0, 0, 1, 1, { groupId: 'g' }),
      obj('c', 0, 0)
    ]
    expect([...expandToGroups(['a'], objects)].sort()).toEqual(['a', 'b'])
    expect([...expandToGroups(['c'], objects)]).toEqual(['c'])
  })
})

describe('snapping', () => {
  it('snaps values to a grid', () => {
    expect(snapToGrid(37, 20)).toBe(40)
    expect(snapToGrid(-9, 20)).toBe(-0)
  })

  it('snaps to nearby edges/centres and reports guides', () => {
    const other = { x: 0, y: 0, width: 100, height: 100 }
    const moving = { x: 104, y: 203, width: 50, height: 50 }
    const { dx, dy, guides } = smartSnap(moving, [other], 6)
    expect(dx).toBe(-4) // left edge snaps to other's right edge (100)
    expect(dy).toBe(0)
    expect(guides).toEqual([{ orientation: 'vertical', position: 100, from: 0, to: 253 }])
  })

  it('does not snap beyond the threshold', () => {
    const res = smartSnap(
      { x: 120, y: 300, width: 10, height: 10 },
      [{ x: 0, y: 0, width: 100, height: 100 }],
      6
    )
    expect(res).toEqual({ dx: 0, dy: 0, guides: [] })
  })
})

describe('findDropTarget', () => {
  it('returns the topmost board card under the point, ignoring dragged cards', () => {
    const objects = [
      obj('low', 0, 0, 200, 200, { zIndex: 1 }),
      obj('high', 50, 50, 200, 200, { zIndex: 2 }),
      obj('note', 0, 0, 500, 500, { zIndex: 3, type: 'note' })
    ]
    expect(findDropTarget(objects, new Set(), { x: 60, y: 60 })?.id).toBe('high')
    expect(findDropTarget(objects, new Set(['high']), { x: 60, y: 60 })?.id).toBe('low')
    expect(findDropTarget(objects, new Set(), { x: 400, y: 400 })).toBeUndefined()
  })
})
