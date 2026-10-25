/**
 * Lays out note text for the canvas (ADR-014). The browser does the layout: the note is
 * rendered into a hidden copy of the editor (same schema, same CSS, same width), and we read
 * back where every piece of text ended up. The canvas then paints exactly that, so the
 * editor and the canvas break lines in the same places and nothing jumps when editing starts.
 */
import { DOMSerializer, Node as PMNode } from '@tiptap/pm/model'
import type { NoteAppearance, RichNode } from '@shared/notes'
import { noteSchema } from './extensions'
import { fontsVersion, registerNoteFonts } from './fonts'
import './note.css'

/** A stretch of text on one line with one style. Coordinates are from the note's top-left. */
export interface TextRun {
  text: string
  x: number
  /** Top of the text box (the font's ascent + descent), and its height. */
  top: number
  height: number
  width: number
  baseline: number
  font: string
  fontSize: number
  color: string
  underline: boolean
  strike: boolean
  highlight: string | null
  href: string | null
}

export interface ListMarker {
  text: string
  /** Right edge of the marker (it ends where the item's text starts). */
  right: number
  baseline: number
  font: string
  color: string
}

export interface NoteLayout {
  /** Height the note needs to show all its text (including padding and border). */
  height: number
  runs: TextRun[]
  markers: ListMarker[]
}

const serializer = DOMSerializer.fromSchema(noteSchema)

/**
 * The note's DOM, as the editor would show it. Empty paragraphs and lines ending in a line
 * break get the same placeholder <br> ProseMirror adds, so they have the same height.
 */
export function renderNoteDom(doc: RichNode): DocumentFragment {
  const node = PMNode.fromJSON(noteSchema, doc)
  node.check()
  const fragment = serializer.serializeFragment(node.content, { document }) as DocumentFragment
  fragment.querySelectorAll('p, h1, h2, h3').forEach((block) => {
    const last = block.lastChild
    if (!last || (last.nodeType === Node.ELEMENT_NODE && (last as Element).tagName === 'BR')) {
      const br = document.createElement('br')
      br.className = 'ProseMirror-trailingBreak'
      block.appendChild(br)
    }
  })
  return fragment
}

/** Inline styles for the note box, shared by the canvas measurement and the editors. */
export function noteBoxStyle(appearance: NoteAppearance): {
  padding: string
  borderWidth: string
} {
  return {
    padding: `${appearance.padding}px`,
    borderWidth: `${appearance.borderWidth}px`
  }
}

let host: HTMLDivElement | null = null

function measuringHost(): HTMLDivElement {
  if (!host || !host.isConnected) {
    registerNoteFonts()
    host = document.createElement('div')
    host.className = 'cw-note-measure'
    host.setAttribute('aria-hidden', 'true')
    document.body.appendChild(host)
  }
  return host
}

const metricsCache = new Map<string, { ascent: number; height: number }>()
let metricsContext: CanvasRenderingContext2D | null = null

/**
 * Where the browser puts the baseline of a font: `ascent` below the top of a text box (the
 * box getClientRects reports), and that box's `height`. Measured in the page, once per font,
 * because the browser's rounding differs slightly from the canvas's own font metrics.
 */
function fontMetrics(font: string): { ascent: number; height: number } {
  const key = `${font}|${fontsVersion()}`
  let metrics = metricsCache.get(key)
  if (!metrics) {
    const probe = document.createElement('div')
    probe.style.cssText = 'position:absolute;white-space:nowrap;line-height:normal'
    const text = document.createElement('span')
    text.style.font = font
    text.textContent = 'Hg'
    const mark = document.createElement('span')
    mark.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline'
    text.appendChild(mark)
    probe.appendChild(text)
    measuringHost().appendChild(probe)
    const box = text.getClientRects()[0]
    metrics = { ascent: mark.getBoundingClientRect().bottom - box.top, height: box.height }
    probe.remove()
    metricsCache.set(key, metrics)
  }
  return metrics
}

export function textWidth(text: string, font: string): number {
  metricsContext ??= document.createElement('canvas').getContext('2d')!
  metricsContext.font = font
  return metricsContext.measureText(text).width
}

interface StyleInfo {
  font: string
  fontSize: number
  color: string
  underline: boolean
  strike: boolean
  highlight: string | null
  href: string | null
}

const isTransparent = (color: string) =>
  color === 'transparent' || /rgba\(.*,\s*0\)$/.test(color.replace(/\s+/g, ' '))

const fontOf = (cs: CSSStyleDeclaration) =>
  `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`

/**
 * Measures a note. `width` is the note's width in canvas units. Throws if the document
 * doesn't fit the schema (callers show the note as unreadable instead).
 */
export function layoutNote(doc: RichNode, width: number, appearance: NoteAppearance): NoteLayout {
  const box = document.createElement('div')
  box.className = 'cw-note'
  Object.assign(box.style, noteBoxStyle(appearance), {
    width: `${width}px`,
    borderStyle: 'solid',
    borderColor: 'transparent'
  })
  const wrapper = document.createElement('div')
  const content = document.createElement('div')
  content.className = 'ProseMirror cw-note-content'
  content.appendChild(renderNoteDom(doc))
  wrapper.appendChild(content)
  box.appendChild(wrapper)
  const root = measuringHost()
  root.replaceChildren(box)

  try {
    const origin = box.getBoundingClientRect()
    const styles = new Map<Element, StyleInfo>()
    const styleOf = (el: Element): StyleInfo => {
      let info = styles.get(el)
      if (!info) {
        const cs = getComputedStyle(el)
        let underline = false
        let strike = false
        let highlight: string | null = null
        for (let a: Element | null = el; a && a !== content; a = a.parentElement) {
          const acs = a === el ? cs : getComputedStyle(a)
          const line = acs.textDecorationLine
          if (line.includes('underline')) underline = true
          if (line.includes('line-through')) strike = true
          if (!highlight && !isTransparent(acs.backgroundColor)) highlight = acs.backgroundColor
        }
        info = {
          font: fontOf(cs),
          fontSize: parseFloat(cs.fontSize),
          color: cs.color,
          underline,
          strike,
          highlight,
          href: el.closest('a')?.getAttribute('href') ?? null
        }
        styles.set(el, info)
      }
      return info
    }

    const runs: TextRun[] = []
    const firstRunOf = new Map<Text, number>()
    const range = document.createRange()
    const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (!node.data) continue
      const style = styleOf(node.parentElement!)
      const metrics = fontMetrics(style.font)
      firstRunOf.set(node, runs.length)
      for (const piece of linePieces(node, range)) {
        const top = piece.rect.top - origin.top
        runs.push({
          text: node.data.slice(piece.start, piece.end),
          x: piece.rect.left - origin.left,
          top,
          height: piece.rect.height,
          width: piece.rect.width,
          baseline: top + metrics.ascent,
          ...style
        })
      }
    }

    const markers: ListMarker[] = []
    content.querySelectorAll('li').forEach((li) => {
      const list = li.parentElement!
      const ordered = list.tagName === 'OL'
      let depth = 0
      for (let a: Element | null = list; a && a !== content; a = a.parentElement) {
        if (a.tagName === list.tagName) depth++
      }
      const index = [...list.children].indexOf(li)
      const start = ordered ? Number(list.getAttribute('start') ?? 1) : 1
      const text = ordered
        ? `${counterText(start + index, depth)}. `
        : `${['•', '◦', '▪'][Math.min(depth, 3) - 1]} `
      const cs = getComputedStyle(li)
      const font = fontOf(cs)
      const first = li.firstElementChild
      let baseline: number | null = null
      const firstText = first ? document.createTreeWalker(first, NodeFilter.SHOW_TEXT).nextNode() : null
      if (firstText && firstRunOf.has(firstText as Text)) {
        baseline = runs[firstRunOf.get(firstText as Text)!].baseline
      } else if (first) {
        // Empty item: the marker sits on the empty line's baseline.
        const fcs = getComputedStyle(first)
        const m = fontMetrics(fontOf(fcs))
        const lineHeight = parseFloat(fcs.lineHeight) || parseFloat(fcs.fontSize) * 1.4
        baseline = first.getBoundingClientRect().top - origin.top + (lineHeight - m.height) / 2 + m.ascent
      }
      if (baseline === null) return
      markers.push({
        text,
        right: li.getBoundingClientRect().left - origin.left,
        baseline,
        font,
        color: cs.color
      })
    })

    return { height: box.getBoundingClientRect().height, runs, markers }
  } finally {
    root.replaceChildren()
  }
}

/** Splits a text node into pieces that each sit on one line. */
function linePieces(
  node: Text,
  range: Range
): { start: number; end: number; rect: DOMRect }[] {
  range.selectNodeContents(node)
  const whole = visibleRects(range)
  if (whole.length === 0) return []
  if (whole.length === 1) return [{ start: 0, end: node.data.length, rect: whole[0] }]

  // Wrapped over several lines: find where each line starts, word by word (and character
  // by character for words the browser broke in the middle).
  const pieces: { start: number; end: number; rect: DOMRect | null }[] = []
  const measure = (start: number, end: number) => {
    range.setStart(node, start)
    range.setEnd(node, end)
    return visibleRects(range)
  }
  for (const word of wordSegmenter.segment(node.data)) {
    const start = word.index
    const end = start + word.segment.length
    const rects = measure(start, end)
    if (rects.length <= 1) {
      pieces.push({ start, end, rect: rects[0] ?? null })
      continue
    }
    for (const g of graphemeSegmenter.segment(word.segment)) {
      const gs = start + g.index
      const ge = gs + g.segment.length
      pieces.push({ start: gs, end: ge, rect: measure(gs, ge)[0] ?? null })
    }
  }

  const merged: { start: number; end: number; rect: DOMRect }[] = []
  for (const piece of pieces) {
    const last = merged.at(-1)
    if (last && (!piece.rect || sameLine(last.rect, piece.rect))) {
      last.end = piece.end
      if (piece.rect) {
        const right = Math.max(last.rect.right, piece.rect.right)
        last.rect = new DOMRect(last.rect.left, last.rect.top, right - last.rect.left, last.rect.height)
      }
    } else if (piece.rect) {
      merged.push({ start: piece.start, end: piece.end, rect: piece.rect })
    } else if (last) {
      last.end = piece.end
    }
  }
  return merged
}

const sameLine = (a: DOMRect, b: DOMRect) => Math.abs(a.top - b.top) < 1 && b.left >= a.left - 0.5

const wordSegmenter = new Intl.Segmenter(undefined, { granularity: 'word' })
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

function visibleRects(range: Range): DOMRect[] {
  const rects = [...range.getClientRects()]
  const sized = rects.filter((r) => r.width > 0)
  return sized.length ? sized : rects.slice(0, 1)
}

/** List numbering used by the note CSS: 1. → a. → i. as lists nest. */
export function counterText(n: number, depth: number): string {
  const style = (depth - 1) % 3
  if (style === 0 || n <= 0) return String(n)
  if (style === 1) {
    let s = ''
    for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(97 + ((v - 1) % 26)) + s
    return s
  }
  const numerals: [number, string][] = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'],
    [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ]
  let s = ''
  let v = n
  for (const [value, numeral] of numerals) {
    while (v >= value) {
      s += numeral
      v -= value
    }
  }
  return s
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  key: string
  layout: NoteLayout
}

const cache = new Map<string, CacheEntry>()
const MAX_CACHE = 2000

/**
 * Cached layout for a note on the canvas. Re-measures only when the text, width, box
 * spacing or loaded fonts change.
 */
export function cachedLayout(
  id: string,
  doc: RichNode,
  width: number,
  appearance: NoteAppearance
): NoteLayout {
  const key = `${width}|${appearance.padding}|${appearance.borderWidth}|${fontsVersion()}|${JSON.stringify(doc)}`
  const hit = cache.get(id)
  if (hit?.key === key) return hit.layout
  const layout = layoutNote(doc, width, appearance)
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!)
  cache.set(id, { key, layout })
  return layout
}

/** The last layout drawn for a note (for clicking links on the canvas). */
export const lastLayout = (id: string): NoteLayout | undefined => cache.get(id)?.layout
