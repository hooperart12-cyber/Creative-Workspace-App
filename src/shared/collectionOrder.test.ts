import { describe, expect, it } from 'vitest'
import { orderCollectionItems, placeBefore, selectPageIds, stepPages } from './collectionOrder'

const item = (
  id: string,
  label: string,
  sortOrder: number,
  createdAt: number,
  updatedAt = createdAt
) => ({ id, label, sortOrder, createdAt, updatedAt })

describe('collection order', () => {
  const items = [
    item('b', 'Page 10', 0, 2, 5),
    item('a', 'Page 2', 1, 1, 9),
    item('c', 'Cover', 2, 3, 4)
  ]

  it('keeps manual order and sorts names with page 2 before page 10', () => {
    expect(orderCollectionItems(items, 'manual').map((entry) => entry.id)).toEqual(['b', 'a', 'c'])
    expect(orderCollectionItems(items, 'name').map((entry) => entry.id)).toEqual(['c', 'a', 'b'])
    expect(orderCollectionItems(items, 'created').map((entry) => entry.id)).toEqual(['a', 'b', 'c'])
    expect(orderCollectionItems(items, 'modified').map((entry) => entry.id)).toEqual([
      'a',
      'b',
      'c'
    ])
  })

  it('places an item before another without using it as a parent', () => {
    expect(placeBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(placeBefore(['a', 'b', 'c'], 'a', null)).toEqual(['b', 'c', 'a'])
  })

  it('moves a locked pair as one step and jumps over another pair', () => {
    const pages = [
      { id: 'open', spreadId: null },
      { id: 'left', spreadId: 'pair' },
      { id: 'right', spreadId: 'pair' },
      { id: 'tail', spreadId: null }
    ]
    expect(stepPages(pages, ['right'], 'earlier')).toEqual({
      pageIds: ['left', 'right'],
      beforeId: 'open'
    })
    expect(stepPages(pages, ['open'], 'later')).toEqual({
      pageIds: ['open'],
      beforeId: 'tail'
    })
    expect(stepPages(pages, ['left'], 'earlier')).toEqual({
      pageIds: ['left', 'right'],
      beforeId: 'open'
    })
    expect(stepPages(pages, ['open'], 'earlier')).toBeNull()
  })

  it('selects page ids, and a shift range follows the sequence rather than the page number', () => {
    const ordered = ['page-10', 'page-2', 'cover']
    expect(selectPageIds(ordered, [], null, 'page-2', 'replace')).toEqual({
      selected: ['page-2'],
      focusId: 'page-2'
    })
    const ranged = selectPageIds(ordered, ['page-10'], 'page-10', 'cover', 'range')
    expect(ranged.selected).toEqual(['page-10', 'page-2', 'cover'])
    expect(selectPageIds(ordered, ranged.selected, 'cover', 'page-2', 'toggle').selected).toEqual([
      'page-10',
      'cover'
    ])
  })
})
