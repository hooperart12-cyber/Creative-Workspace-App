import { describe, expect, it } from 'vitest'
import {
  bindingConflict,
  clickZone,
  cropInset,
  explicitNextChapter,
  parseReaderPrefs,
  READER_PRESETS,
  readerStep,
  resumePageId,
  WESTERN_BINDINGS,
  writesResume,
  zoomAt
} from './reader'

const pages = [
  { id: 'cover', span: 1 as const, spreadId: null },
  { id: 'left', span: 1 as const, spreadId: 'pair' },
  { id: 'right', span: 1 as const, spreadId: 'pair' },
  { id: 'tail', span: 1 as const, spreadId: null }
]

describe('reader session', () => {
  it('does not write a resume when a window only closes or refreshes', () => {
    expect(writesResume('interact')).toBe(true)
    expect(writesResume('close')).toBe(false)
    expect(writesResume('refresh')).toBe(false)
  })

  it('keeps a saved page id and falls back to the first page', () => {
    expect(resumePageId('tail', pages)).toBe('tail')
    expect(resumePageId('gone', pages)).toBe('cover')
    expect(resumePageId(null, [])).toBeNull()
  })

  it('steps a spread as one unit and stops at the end', () => {
    expect(readerStep(pages, 'left', 'spread', 'next')).toEqual({ pageId: 'tail', ended: false })
    expect(readerStep(pages, 'tail', 'single', 'next')).toEqual({ pageId: 'tail', ended: true })
    expect(readerStep(pages, 'cover', 'single', 'next').pageId).toBe('left')
  })

  it('uses an explicit next chapter and reader-only key bindings', () => {
    expect(explicitNextChapter(null)).toBeNull()
    expect(explicitNextChapter('chapter-2')).toBe('chapter-2')
    expect(READER_PRESETS.manga.bindings.next).toBe('ArrowLeft')
    expect(READER_PRESETS.western.layout).toBe('single')
    expect(bindingConflict({ ...WESTERN_BINDINGS, previous: WESTERN_BINDINGS.next })).toMatch(
      /ArrowRight/
    )
    expect(bindingConflict(WESTERN_BINDINGS)).toBeNull()
  })

  it('turns from a click only while fitted, and zooms toward the pointer', () => {
    expect(clickZone(10, 300, 1)).toBe('previous')
    expect(clickZone(200, 300, 1)).toBe('next')
    expect(clickZone(150, 300, 1)).toBeNull()
    expect(clickZone(10, 300, 2)).toBeNull()
    expect(zoomAt({ zoom: 1, x: 0, y: 0 }, 2, 0, 0, 0, 0)).toEqual({ zoom: 2, x: 0, y: 0 })
    expect(zoomAt({ zoom: 1, x: 0, y: 0 }, 2, 10, 0, 0, 0).x).toBe(-10)
  })

  it('reads global appearance and ignores a per-collection theme', () => {
    const prefs = parseReaderPrefs(
      JSON.stringify({
        collectionId: 'nope',
        theme: 'night',
        appearance: { background: '#222222', fit: 'width', margin: 12 },
        bindings: { next: 'n' }
      })
    )
    expect(prefs.appearance.background).toBe('#222222')
    expect(prefs.appearance.fit).toBe('width')
    expect(prefs.bindings.next).toBe('n')
    expect(prefs.bindings.previous).toBe('ArrowLeft')
    expect(prefs).not.toHaveProperty('collectionId')
    expect(cropInset({ x: 10, y: 0, w: 10, h: 20 }, 40, 20)).toBe('inset(0% 50% 0% 25%)')
  })
})
