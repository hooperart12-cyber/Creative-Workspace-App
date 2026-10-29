import { describe, expect, it } from 'vitest'
import {
  anchorOnImage,
  cardPoint,
  imageAnchorToCard,
  parseComment,
  visibleInView
} from './comments'

describe('comment anchors', () => {
  it('keeps an image pixel through a later crop and resize', () => {
    const asset = { width: 200, height: 100 }
    const card = { x: 10, y: 20, width: 200, height: 100, rotation: 0 }
    const stored = anchorOnImage(card, { x: 110, y: 70 }, asset, null)
    expect(stored).toEqual({ u: 0.5, v: 0.5 })
    const cropped = imageAnchorToCard(stored, asset, { x: 50, y: 0, width: 100, height: 100 })
    expect(cropped.u).toBeCloseTo(0.5)
    expect(cropped.v).toBeCloseTo(0.5)
    const drawn = cardPoint({ x: 0, y: 0, width: 100, height: 100, rotation: 0 }, cropped)
    expect(drawn).toEqual({ x: 50, y: 50 })
  })

  it('rotates the anchor with the card and leaves the stored fraction alone', () => {
    const point = cardPoint({ x: 0, y: 0, width: 100, height: 0, rotation: 90 }, { u: 1, v: 0 })
    expect(point.x).toBeCloseTo(0)
    expect(point.y).toBeCloseTo(100)
  })

  it('shows a hidden comment only when a jump forces it', () => {
    expect(visibleInView('open', 'hidden', false)).toBe(false)
    expect(visibleInView('open', 'hidden', true)).toBe(true)
    expect(visibleInView('resolved', 'open', false)).toBe(false)
    expect(visibleInView('resolved', 'all', false)).toBe(true)
  })

  it('does not turn a free comment into an attached one while parsing', () => {
    const parsed = parseComment({
      version: 1,
      presentation: 'pin',
      anchor: { scope: 'free', targetId: null, u: 0, v: 0, x: 4, y: 5, detached: 'user' }
    })
    expect(parsed?.presentation).toBe('pin')
    expect(parsed?.anchor.detached).toBe('user')
    expect(parsed?.anchor.targetId).toBeNull()
  })
})
