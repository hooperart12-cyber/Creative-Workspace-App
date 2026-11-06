import { describe, expect, it } from 'vitest'
import {
  collectionCounts,
  derivedNumbers,
  inspectorLayout,
  layoutSpreads,
  naturalCompare,
  spreadSides,
  stageProgress
} from './collections'

describe('collection sequence', () => {
  it('numbers story pages and leaves cover, blank, and an explicit unnumbered page out', () => {
    const numbers = derivedNumbers(
      [
        { id: 'cover', role: 'cover', unnumbered: null },
        { id: 'a', role: 'story', unnumbered: null },
        { id: 'blank', role: 'blank', unnumbered: null },
        { id: 'b', role: 'story', unnumbered: true },
        { id: 'c', role: 'bonus', unnumbered: null }
      ],
      1
    )
    expect(numbers.get('cover')).toBeNull()
    expect(numbers.get('a')).toBe(1)
    expect(numbers.get('blank')).toBeNull()
    expect(numbers.get('b')).toBeNull()
    expect(numbers.get('c')).toBe(2)
  })

  it('keeps a locked pair and a wide page on their own spreads', () => {
    const spreads = layoutSpreads(
      [
        { id: 'open', span: 1, spreadId: null },
        { id: 'left', span: 1, spreadId: 'pair' },
        { id: 'right', span: 1, spreadId: 'pair' },
        { id: 'wide', span: 2, spreadId: null },
        { id: 'tail', span: 1, spreadId: null }
      ]
    )
    expect(spreads.map((spread) => spread.pageIds)).toEqual([
      ['open'],
      ['left', 'right'],
      ['wide'],
      ['tail']
    ])
    expect(spreads[1]).toMatchObject({ locked: true, wide: false })
    expect(spreads[2]).toMatchObject({ wide: true })
    expect(spreadSides(spreads[1]!, 'rtl', 'right').map((slot) => slot.side)).toEqual([
      'right',
      'left'
    ])
  })

  it('counts entries, reading positions, and artwork separately', () => {
    expect(
      collectionCounts([
        { span: 1, hasArtwork: true },
        { span: 2, hasArtwork: true },
        { span: 1, hasArtwork: false }
      ])
    ).toEqual({ entries: 3, readingPositions: 4, withArtwork: 2, placeholders: 1 })
  })

  it('counts finished stages without treating notes as progress', () => {
    expect(
      stageProgress(
        [{ id: 'inks', name: 'Inks' }],
        [
          { stageId: 'inks', state: 'done' },
          { stageId: 'inks', state: 'started' }
        ],
        2
      )
    ).toEqual([{ name: 'Inks', done: 1, total: 2 }])
  })

  it('keeps inspector width in range and ignores reader camera fields', () => {
    expect(inspectorLayout({ width: 900, collapsed: true, readerZoom: 4 })).toEqual({
      collapsed: true,
      width: 480
    })
    expect(inspectorLayout(null)).toEqual({ collapsed: false, width: 288 })
  })

  it('sorts page 2 before page 10', () => {
    expect(['Page 10', 'Page 2', 'Page 1'].sort(naturalCompare)).toEqual([
      'Page 1',
      'Page 2',
      'Page 10'
    ])
  })
})
