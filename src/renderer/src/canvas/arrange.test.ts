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
