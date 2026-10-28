import { describe, expect, it } from 'vitest'
import type { SearchHit } from '@shared/types'
import { groupSearchHits } from './groupHits'

function hit(
  partial: Partial<SearchHit> & Pick<SearchHit, 'kind' | 'sourceId' | 'title'>
): SearchHit {
  return {
    assetId: null,
    page: null,
    snippet: '',
    location: 'Board',
    ...partial
  }
}

describe('groupSearchHits', () => {
  it('names the parent stack and opens that stack when only slides matched', () => {
    const slide = hit({
      kind: 'slide',
      sourceId: 'slide-1',
      title: 'left.png',
      objectId: 'stack-1',
      boardId: 'board-1',
      stackId: 'stack-1',
      slideId: 'slide-1',
      stackTitle: 'Heroes'
    })
    const [group] = groupSearchHits([slide])
    expect(group.kind).toBe('stack')
    if (group.kind !== 'stack') return
    expect(group.title).toBe('Heroes')
    expect(group.stack.kind).toBe('stack')
    expect(group.stack.objectId).toBe('stack-1')
    expect(group.stack.slideId).toBeNull()
    expect(group.slides).toEqual([slide])
  })

  it('keeps a real stack hit as the header and the slide as its own result', () => {
    const stack = hit({
      kind: 'stack',
      sourceId: 'stack-1',
      title: 'Heroes',
      objectId: 'stack-1',
      boardId: 'board-1',
      stackId: 'stack-1'
    })
    const slide = hit({
      kind: 'slide',
      sourceId: 'slide-2',
      title: 'right.png',
      objectId: 'stack-1',
      boardId: 'board-1',
      stackId: 'stack-1',
      slideId: 'slide-2',
      stackTitle: 'Heroes'
    })
    const [group] = groupSearchHits([slide, stack])
    if (group.kind !== 'stack') throw new Error('expected a stack group')
    expect(group.title).toBe('Heroes')
    expect(group.stack).toBe(stack)
    expect(group.slides.map((item) => item.slideId)).toEqual(['slide-2'])
  })
})
