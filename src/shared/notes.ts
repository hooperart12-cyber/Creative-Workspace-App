/**
 * Rich text notes (§5, ADR-014): the stored format, its defaults, and the checks the main
 * process runs before saving. Pure TypeScript (no DOM, no Electron) so both processes use it.
 *
 * A note is a `board_objects` row with type `text`. Its `data` holds:
 *   content    { schemaVersion, doc }   ProseMirror JSON (never raw HTML)
 *   plainText  the text without formatting (empty-note checks now, project search later)
 *   appearance card/floating look; applies to the whole note
 *   sizing     'auto' (height follows the text) or 'fixed' (text scrolls inside)
 */

export const NOTE_TYPE = 'text'
export const NOTE_SCHEMA_VERSION = 1

/** A ProseMirror node as JSON. */
export interface RichNode {
  type: string
  attrs?: Record<string, unknown>
  content?: RichNode[]
  marks?: RichMark[]
  text?: string
}

export interface RichMark {
  type: string
  attrs?: Record<string, unknown>
}

export interface NoteContent {
  schemaVersion: number
  doc: RichNode
}

export type NoteMode = 'card' | 'floating'
export type NoteSizing = 'auto' | 'fixed'

/** Whole-note look. Padding and border width apply in both modes, so switching never moves the text. */
export interface NoteAppearance {
  mode: NoteMode
  background: string
  /** 0–1 */
  backgroundOpacity: number
  borderColor: string
  borderWidth: number
  radius: number
  padding: number
  shadow: boolean
}

export interface NoteData {
  content: NoteContent
  plainText: string
  appearance: NoteAppearance
  sizing: NoteSizing
}

export const DEFAULT_APPEARANCE: NoteAppearance = {
  mode: 'card',
  background: '#ffffff',
  backgroundOpacity: 1,
  borderColor: '#e3e1dc',
  borderWidth: 1,
  radius: 10,
  padding: 16,
  shadow: true
}

export const NOTE_DEFAULT_WIDTH = 280
/** Height of a new, empty note: one line of text plus padding and border. */
export const NEW_NOTE_HEIGHT = 56
export const NOTE_MIN_WIDTH = 80
export const NOTE_MIN_HEIGHT = 40
/** Largest note the app saves (the JSON document), so a runaway paste can't bloat the project. */
export const MAX_NOTE_BYTES = 512 * 1024

export const emptyDoc = (): RichNode => ({ type: 'doc', content: [{ type: 'paragraph' }] })

export const newNoteData = (): NoteData => ({
  content: { schemaVersion: NOTE_SCHEMA_VERSION, doc: emptyDoc() },
  plainText: '',
  appearance: { ...DEFAULT_APPEARANCE },
  sizing: 'auto'
})

/** Raised when a document doesn't fit the note schema. The message is shown to the user. */
export class NoteContentError extends Error {}

// ── Reading stored notes ─────────────────────────────────────────────────────

export type ReadNoteResult = { ok: true; note: NoteData } | { ok: false; plainText: string }

/**
 * Reads a note's `data`. Missing appearance or sizing fall back to defaults; content that
 * can't be understood is reported (with whatever plain text survives) instead of throwing,
 * so one damaged note never stops a board from opening.
 */
export function readNote(data: Record<string, unknown>): ReadNoteResult {
  const plainText = typeof data.plainText === 'string' ? data.plainText : ''
  let content: NoteContent
  try {
    content = migrateContent(data.content)
  } catch {
    return { ok: false, plainText }
  }
  return {
    ok: true,
    note: {
      content,
      plainText,
      appearance: { ...DEFAULT_APPEARANCE, ...sanitizeAppearance(data.appearance) },
      sizing: data.sizing === 'fixed' ? 'fixed' : 'auto'
    }
  }
}

/** Brings stored content up to the current schema version (throws if it can't be read). */
export function migrateContent(raw: unknown): NoteContent {
  if (!isRecord(raw)) throw new NoteContentError('This note has no content.')
  const version = raw.schemaVersion
  if (version === NOTE_SCHEMA_VERSION) {
    return { schemaVersion: NOTE_SCHEMA_VERSION, doc: sanitizeDoc(raw.doc) }
  }
  // Future versions convert step by step here (e.g. 1 → 2). A newer file than this app
  // understands is refused rather than guessed at.
  throw new NoteContentError('This note was saved by a newer version of the app.')
}

// ── Validation ───────────────────────────────────────────────────────────────

const BLOCKS = new Set(['paragraph', 'heading', 'bulletList', 'orderedList'])
const TEXTBLOCKS = new Set(['paragraph', 'heading'])
const SIMPLE_MARKS = new Set(['bold', 'italic', 'underline', 'strike'])
const ALIGNMENTS = new Set(['left', 'center', 'right', 'justify'])
const MAX_DEPTH = 24

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB = /^rgba?\(\s*[\d.]+%?\s*,\s*[\d.]+%?\s*,\s*[\d.]+%?\s*(?:,\s*[\d.]+%?\s*)?\)$/i
const FONT_SIZE = /^(\d{1,3}(?:\.\d+)?)px$/
const FONT_FAMILY = /^[\p{L}\p{N}\s"',._-]{1,200}$/u

export const isColor = (v: unknown): v is string =>
  typeof v === 'string' && (HEX.test(v) || RGB.test(v))

/** Links may only point at web pages or email addresses (never files, scripts or app pages). */
export function isSafeLink(href: unknown): href is string {
  if (typeof href !== 'string' || href.length > 2048) return false
  try {
    const url = new URL(href)
    return ['http:', 'https:', 'mailto:'].includes(url.protocol)
  } catch {
    return false
  }
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
const num = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : null

const fontSize = (v: unknown): string | null => {
  const m = typeof v === 'string' ? FONT_SIZE.exec(v) : null
  return m ? `${clamp(Number(m[1]), 6, 200)}px` : null
}

const fontFamily = (v: unknown): string | null =>
  typeof v === 'string' && FONT_FAMILY.test(v) ? v : null

const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.length <= max ? v : null

/**
 * Checks a document against the note schema and returns a clean copy. Unknown or invalid
 * attributes and marks are dropped; unsafe links lose their link. Structure that doesn't
 * fit (unknown node types, lists without items, …) is refused with a NoteContentError.
 * The result is canonical: cleaning it again gives the same JSON.
 */
export function sanitizeDoc(raw: unknown): RichNode {
  if (!isRecord(raw) || raw.type !== 'doc') throw new NoteContentError('Invalid note content.')
  if (JSON.stringify(raw).length > MAX_NOTE_BYTES) {
    throw new NoteContentError('This note is too long to save. Try splitting it into several notes.')
  }
  const blocks = children(raw).map((b) => block(b, 0))
  return { type: 'doc', content: blocks.length ? blocks : [block({ type: 'paragraph' }, 0)] }
}

function block(raw: unknown, depth: number): RichNode {
  if (depth > MAX_DEPTH) throw new NoteContentError('This note’s lists are nested too deeply.')
  if (!isRecord(raw) || typeof raw.type !== 'string' || !BLOCKS.has(raw.type)) {
    throw new NoteContentError('This note contains content that notes can’t hold.')
  }
  const attrs = isRecord(raw.attrs) ? raw.attrs : {}
  if (raw.type === 'paragraph' || raw.type === 'heading') {
    const out: RichNode = { type: raw.type, attrs: blockAttrs(raw.type, attrs) }
    const inline = children(raw).flatMap(inlineNode)
    if (inline.length) out.content = inline
    return out
  }
  // Lists: items only, each starting with a paragraph.
  const items = children(raw).map((item) => listItem(item, depth + 1))
  if (items.length === 0) throw new NoteContentError('A list in this note is empty.')
  const out: RichNode = { type: raw.type }
  if (raw.type === 'orderedList') {
    out.attrs = {
      start: Math.round(num(attrs.start, 0, 100000) ?? 1),
      type: str(attrs.type, 4)
    }
  }
  out.content = items
  return out
}

function listItem(raw: unknown, depth: number): RichNode {
  if (!isRecord(raw) || raw.type !== 'listItem') {
    throw new NoteContentError('A list in this note is damaged.')
  }
  const content = children(raw).map((b) => block(b, depth))
  if (content.length === 0 || content[0].type !== 'paragraph') {
    throw new NoteContentError('A list in this note is damaged.')
  }
  return { type: 'listItem', content }
}

function blockAttrs(type: string, attrs: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (type === 'heading') {
    const level = num(attrs.level, 1, 3)
    out.level = level === null ? 1 : Math.round(level)
  }
  out.textAlign =
    typeof attrs.textAlign === 'string' && ALIGNMENTS.has(attrs.textAlign) ? attrs.textAlign : null
  out.lineHeight = num(attrs.lineHeight, 0.8, 4)
  out.spaceAfter = num(attrs.spaceAfter, 0, 96)
  return out
}

function inlineNode(raw: unknown): RichNode[] {
  if (!isRecord(raw)) throw new NoteContentError('Invalid note content.')
  if (raw.type === 'hardBreak') {
    const marks = cleanMarks(raw.marks)
    return [marks.length ? { type: 'hardBreak', marks } : { type: 'hardBreak' }]
  }
  if (raw.type !== 'text') {
    throw new NoteContentError('This note contains content that notes can’t hold.')
  }
  if (typeof raw.text !== 'string') throw new NoteContentError('Invalid note content.')
  if (raw.text === '') return [] // ProseMirror never stores empty text
  const marks = cleanMarks(raw.marks)
  return [marks.length ? { type: 'text', text: raw.text, marks } : { type: 'text', text: raw.text }]
}

function cleanMarks(raw: unknown): RichMark[] {
  if (!Array.isArray(raw)) return []
  const out: RichMark[] = []
  const seen = new Set<string>()
  for (const mark of raw) {
    if (!isRecord(mark) || typeof mark.type !== 'string' || seen.has(mark.type)) continue
    const attrs = isRecord(mark.attrs) ? mark.attrs : {}
    let clean: RichMark | null = null
    if (SIMPLE_MARKS.has(mark.type)) clean = { type: mark.type }
    else if (mark.type === 'link' && isSafeLink(attrs.href)) {
      clean = {
        type: 'link',
        attrs: {
          href: attrs.href,
          target: str(attrs.target, 20),
          rel: str(attrs.rel),
          class: str(attrs.class),
          title: str(attrs.title, 500)
        }
      }
    } else if (mark.type === 'highlight') {
      clean = { type: 'highlight', attrs: { color: isColor(attrs.color) ? attrs.color : null } }
    } else if (mark.type === 'textStyle') {
      const style = {
        color: isColor(attrs.color) ? attrs.color : null,
        fontFamily: fontFamily(attrs.fontFamily),
        fontSize: fontSize(attrs.fontSize)
      }
      // A text style with nothing set means nothing; ProseMirror drops it too.
      if (style.color || style.fontFamily || style.fontSize) clean = { type: 'textStyle', attrs: style }
    }
    if (clean) {
      seen.add(mark.type)
      out.push(clean)
    }
  }
  return out
}

/** Whole-note look from untrusted input: only known keys with valid values survive. */
export function sanitizeAppearance(raw: unknown): Partial<NoteAppearance> {
  if (!isRecord(raw)) return {}
  const out: Partial<NoteAppearance> = {}
  if (raw.mode === 'card' || raw.mode === 'floating') out.mode = raw.mode
  if (isColor(raw.background)) out.background = raw.background
  if (isColor(raw.borderColor)) out.borderColor = raw.borderColor
  const opacity = num(raw.backgroundOpacity, 0, 1)
  if (opacity !== null) out.backgroundOpacity = opacity
  const border = num(raw.borderWidth, 0, 12)
  if (border !== null) out.borderWidth = border
  const radius = num(raw.radius, 0, 48)
  if (radius !== null) out.radius = radius
  const padding = num(raw.padding, 0, 64)
  if (padding !== null) out.padding = padding
  if (typeof raw.shadow === 'boolean') out.shadow = raw.shadow
  return out
}

/** True if two documents hold the same content and formatting. */
export function sameDoc(a: RichNode, b: RichNode): boolean {
  try {
    return JSON.stringify(sanitizeDoc(a)) === JSON.stringify(sanitizeDoc(b))
  } catch {
    return JSON.stringify(a) === JSON.stringify(b)
  }
}

// ── Plain text ───────────────────────────────────────────────────────────────

/** The note's text without formatting: one line per paragraph, heading or list item. */
export function plainTextOf(doc: RichNode): string {
  const lines: string[] = []
  const walk = (node: RichNode) => {
    if (TEXTBLOCKS.has(node.type)) {
      lines.push(
        (node.content ?? []).map((n) => (n.type === 'hardBreak' ? '\n' : (n.text ?? ''))).join('')
      )
      return
    }
    for (const child of node.content ?? []) walk(child)
  }
  walk(doc)
  return lines.join('\n')
}

export const isEmptyDoc = (doc: RichNode): boolean => plainTextOf(doc).trim() === ''

function children(node: Record<string, unknown>): unknown[] {
  if (node.content === undefined) return []
  if (!Array.isArray(node.content)) throw new NoteContentError('Invalid note content.')
  return node.content
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
