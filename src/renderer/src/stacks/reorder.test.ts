import { describe, expect, it } from 'vitest'
import { reorderSlideIds } from './reorder'

describe('reorderSlideIds', () => {
  it('moves a thumbnail onto another and leaves a separate cover id alone', () => {
    const cover = 'slide-b'
    const next = reorderSlideIds(['slide-a', 'slide-b', 'slide-c'], 'slide-c', 'slide-a')
    expect(next).toEqual(['slide-c', 'slide-a', 'slide-b'])
    expect(cover).toBe('slide-b')
  })

  it('does not invent an order when the thumbnail is dropped on itself', () => {
    expect(reorderSlideIds(['slide-a', 'slide-b'], 'slide-a', 'slide-a')).toBeNull()
  })
})
