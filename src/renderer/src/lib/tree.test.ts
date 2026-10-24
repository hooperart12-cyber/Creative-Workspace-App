import { describe, expect, it } from 'vitest'
import { buildTree, descendantIds, flattenTree } from './tree'

const items = [
  { id: 'root', parent: null },
  { id: 'a', parent: 'root' },
  { id: 'b', parent: 'a' },
  { id: 'c', parent: 'root' },
  { id: 'orphan', parent: 'missing' }
]
const parentOf = (i: (typeof items)[number]) => i.parent

describe('tree helpers', () => {
  it('builds a forest and treats orphans as roots', () => {
    const roots = buildTree(items, parentOf)
    expect(roots.map((r) => r.item.id)).toEqual(['root', 'orphan'])
    expect(roots[0].children.map((c) => c.item.id)).toEqual(['a', 'c'])
  })

  it('finds all descendants', () => {
    expect([...descendantIds(items, parentOf, 'root')].sort()).toEqual(['a', 'b', 'c'])
    expect(descendantIds(items, parentOf, 'b').size).toBe(0)
  })

  it('flattens depth-first with depth', () => {
    const flat = flattenTree(buildTree(items, parentOf)).map((n) => `${n.depth}:${n.item.id}`)
    expect(flat).toEqual(['0:root', '1:a', '2:b', '1:c', '0:orphan'])
  })
})
