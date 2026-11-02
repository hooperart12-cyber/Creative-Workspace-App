import { describe, expect, it } from 'vitest'
import { defaultConnection } from './connections'
import {
  contentFrame,
  exportCommentView,
  exportConnectionDisplay,
  pictureBoxes,
  picturePixelRatio
} from './boardExport'

describe('board export frame', () => {
  it('pads the artwork and gives an empty board a page', () => {
    expect(contentFrame([])).toEqual({ x: 0, y: 0, width: 960, height: 640 })
    const frame = contentFrame([{ x: 10, y: 20, width: 100, height: 40 }])
    expect(frame.x).toBeLessThan(10)
    expect(frame.y).toBeLessThan(20)
    expect(frame.width).toBeGreaterThan(100)
    expect(frame.height).toBeGreaterThan(40)
  })

  it('keeps a hidden choice hidden and caps a huge board', () => {
    expect(exportConnectionDisplay('adaptive', 'current')).toBe('adaptive')
    expect(exportConnectionDisplay('adaptive', 'hide')).toBe('hidden')
    expect(exportConnectionDisplay('hidden', 'show')).toBe('full')
    expect(exportCommentView('open', 'show')).toBe('all')
    expect(exportCommentView('resolved', 'hide')).toBe('hidden')
    expect(picturePixelRatio(100, 80)).toBeGreaterThan(1)
    expect(picturePixelRatio(20000, 1000) * 20000).toBeLessThanOrEqual(8192)
  })

  it('frames a long connection from its endpoints, not its stored card size', () => {
    const data = defaultConnection({ x: 0, y: 0 }, { x: 2400, y: 80 })
    data.label = { text: 'allies', t: 0.5, offset: 40 }
    const frame = contentFrame(
      pictureBoxes(
        [{ type: 'connection', x: 0, y: 0, width: 240, height: 88, data }],
        'full',
        'open'
      )
    )
    expect(frame.x + frame.width).toBeGreaterThan(2400)
    expect(frame.y).toBeLessThan(0)
  })
})
