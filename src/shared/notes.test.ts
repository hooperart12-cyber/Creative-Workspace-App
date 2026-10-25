import { describe, expect, it } from 'vitest'
import {
  DEFAULT_APPEARANCE,
  MAX_NOTE_BYTES,
  NoteContentError,
  isEmptyDoc,
  isSafeLink,
  migrateContent,
  plainTextOf,
  readNote,
  sameDoc,
  sanitizeAppearance,
  sanitizeDoc,
  type RichNode
} from './notes'

const p = (text: string, marks?: RichNode['marks']): RichNode => ({
  type: 'paragraph',
  content: [{ type: 'text', text, ...(marks ? { marks } : {}) }]
})
const doc = (...content: RichNode[]): RichNode => ({ type: 'doc', content })

describe('sanitizeDoc', () => {
  it('keeps supported formatting and is canonical', () => {
    const input = doc(
      { type: 'heading', attrs: { level: 2, textAlign: 'center' }, content: [{ type: 'text', text: 'Title' }] },
      p('Bold and red', [
        { type: 'bold' },
        { type: 'textStyle', attrs: { color: '#ff0000', fontSize: '24px', fontFamily: "'CW Lora', serif" } }
      ]),
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [p('one')] }]
      },
      {
        type: 'orderedList',
        attrs: { start: 3 },
        content: [{ type: 'listItem', content: [p('three')] }]
      }
    )
    const clean = sanitizeDoc(input)
    expect(clean.content![0]).toMatchObject({ type: 'heading', attrs: { level: 2, textAlign: 'center' } })
    expect(clean.content![1].content![0].marks).toEqual([
      { type: 'bold' },
      { type: 'textStyle', attrs: { color: '#ff0000', fontFamily: "'CW Lora', serif", fontSize: '24px' } }
    ])
    expect(clean.content![3].attrs).toMatchObject({ start: 3 })
    expect(sanitizeDoc(clean)).toEqual(clean)
  })

  it('drops unsafe links but keeps their text', () => {
    for (const href of ['javascript:alert(1)', 'file:///C:/secret.txt', 'data:text/html,hi', 'cw-asset://x']) {
      const clean = sanitizeDoc(doc(p('click', [{ type: 'link', attrs: { href } }])))
      expect(clean.content![0].content![0]).toEqual({ type: 'text', text: 'click' })
    }
    const safe = sanitizeDoc(doc(p('site', [{ type: 'link', attrs: { href: 'https://example.com' } }])))
    expect(safe.content![0].content![0].marks![0]).toMatchObject({
      type: 'link',
      attrs: { href: 'https://example.com' }
    })
  })

  it('refuses images, scripts and other nodes notes cannot hold', () => {
    for (const node of [
      { type: 'image', attrs: { src: 'x.png' } },
      { type: 'codeBlock' },
      { type: 'table', content: [] },
      { type: 'script', text: 'alert(1)' }
    ]) {
      expect(() => sanitizeDoc(doc(node as RichNode))).toThrow(NoteContentError)
    }
    expect(() =>
      sanitizeDoc(doc({ type: 'paragraph', content: [{ type: 'image', attrs: { src: 'x' } }] }))
    ).toThrow(NoteContentError)
  })

  it('drops unknown marks and invalid attribute values', () => {
    const clean = sanitizeDoc(
      doc({
        type: 'paragraph',
        attrs: { textAlign: 'sideways', lineHeight: 99, spaceAfter: -5, onclick: 'x' },
        content: [
          {
            type: 'text',
            text: 'x',
            marks: [
              { type: 'evil' },
              { type: 'textStyle', attrs: { color: 'url(javascript:1)', fontSize: '999px' } },
              { type: 'highlight', attrs: { color: 'expression(1)' } }
            ]
          }
        ]
      })
    )
    const para = clean.content![0]
    expect(para.attrs).toEqual({ textAlign: null, lineHeight: 4, spaceAfter: 0 })
    expect(para.content![0].marks).toEqual([
      { type: 'textStyle', attrs: { color: null, fontFamily: null, fontSize: '200px' } },
      { type: 'highlight', attrs: { color: null } }
    ])
  })

  it('refuses damaged structure and oversized notes', () => {
    expect(() => sanitizeDoc({ type: 'paragraph' })).toThrow(NoteContentError)
    expect(() => sanitizeDoc(doc({ type: 'bulletList', content: [] }))).toThrow(NoteContentError)
    expect(() =>
      sanitizeDoc(doc({ type: 'bulletList', content: [{ type: 'listItem', content: [] }] }))
    ).toThrow(NoteContentError)
    expect(() => sanitizeDoc(doc(p('x'.repeat(MAX_NOTE_BYTES))))).toThrow(/too long/)
  })

  it('gives an empty document a paragraph', () => {
    expect(sanitizeDoc({ type: 'doc' })).toEqual({ type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: null, lineHeight: null, spaceAfter: null } }] })
  })
})

describe('readNote', () => {
  it('fills in defaults for a note with only content', () => {
    const result = readNote({ content: { schemaVersion: 1, doc: doc(p('hi')) } })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.note.appearance).toEqual(DEFAULT_APPEARANCE)
      expect(result.note.sizing).toBe('auto')
    }
  })

  it('reports unreadable content with the plain text that survives', () => {
    expect(readNote({ content: 'garbage', plainText: 'saved words' })).toEqual({
      ok: false,
      plainText: 'saved words'
    })
    expect(readNote({ content: { schemaVersion: 99, doc: doc() } }).ok).toBe(false)
    expect(() => migrateContent(null)).toThrow(NoteContentError)
  })
})

describe('plain text and helpers', () => {
  it('puts paragraphs, list items and line breaks on their own lines', () => {
    const d = doc(
      { type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: 'b' }] },
      { type: 'bulletList', content: [{ type: 'listItem', content: [p('c')] }] }
    )
    expect(plainTextOf(d)).toBe('a\nb\nc')
    expect(isEmptyDoc(doc({ type: 'paragraph' }, p('   ')))).toBe(true)
    expect(isEmptyDoc(d)).toBe(false)
  })

  it('compares documents by content, not attribute order', () => {
    const a = doc({ type: 'paragraph', attrs: { lineHeight: null, textAlign: 'left' }, content: [{ type: 'text', text: 'x' }] })
    const b = doc({ type: 'paragraph', attrs: { textAlign: 'left' }, content: [{ type: 'text', text: 'x' }] })
    expect(sameDoc(a, b)).toBe(true)
    expect(sameDoc(a, doc(p('y')))).toBe(false)
  })

  it('allows only web and mail links', () => {
    expect(isSafeLink('https://example.com/a?b')).toBe(true)
    expect(isSafeLink('http://example.com')).toBe(true)
    expect(isSafeLink('mailto:me@example.com')).toBe(true)
    expect(isSafeLink('javascript:alert(1)')).toBe(false)
    expect(isSafeLink('file:///etc/passwd')).toBe(false)
    expect(isSafeLink('example.com')).toBe(false)
  })

  it('keeps only valid appearance values', () => {
    expect(
      sanitizeAppearance({ mode: 'floating', background: '#abc', padding: 500, shadow: 'yes', extra: 1 })
    ).toEqual({ mode: 'floating', background: '#abc', padding: 64 })
  })
})
