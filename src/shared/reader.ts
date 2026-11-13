/**
 * Reader and Artwork Review decisions that do not belong to one collection's theme.
 * A saved resume is the page id, layout, zoom, and pan. Appearance is global.
 */
import { layoutSpreads, type ArtworkState, type SequencePage } from './collections'

export type ReaderLayout = 'single' | 'spread' | 'continuous'

export interface ReaderPageView {
  id: string
  title: string
  label: string
  number: number | null
  role: string | null
  span: 1 | 2
  spreadId: string | null
  artwork: ArtworkState
  sha256: string | null
  width: number | null
  height: number | null
  crop: { x: number; y: number; w: number; h: number } | null
}

export interface ReaderDocument {
  id: string
  title: string
  direction: 'ltr' | 'rtl'
  firstPageSide: 'left' | 'right'
  nextCollectionId: string | null
  nextTitle: string | null
  resume: { pageId: string | null; layout: ReaderLayout; zoom: number; x: number; y: number }
  pages: ReaderPageView[]
}

export type ReaderCommand =
  'next' | 'previous' | 'zoomIn' | 'zoomOut' | 'fit' | 'planner' | 'review'

export type ReaderBindings = Record<ReaderCommand, string>

export interface ReaderAppearance {
  background: string
  margin: number
  gutter: number
  border: boolean
  fit: 'contain' | 'width' | 'height'
  allowEnlarge: boolean
  smooth: boolean
}

export interface ReaderPrefs {
  appearance: ReaderAppearance
  bindings: ReaderBindings
}

export const DEFAULT_READER_APPEARANCE: ReaderAppearance = {
  background: '#111111',
  margin: 24,
  gutter: 16,
  border: false,
  fit: 'contain',
  allowEnlarge: false,
  smooth: true
}

export const WESTERN_BINDINGS: ReaderBindings = {
  next: 'ArrowRight',
  previous: 'ArrowLeft',
  zoomIn: '=',
  zoomOut: '-',
  fit: '0',
  planner: 'p',
  review: 'r'
}

export const READER_PRESETS: Record<
  'western' | 'manga' | 'keyboard' | 'continuous',
  { layout: ReaderLayout; bindings: ReaderBindings }
> = {
  western: { layout: 'single', bindings: WESTERN_BINDINGS },
  manga: {
    layout: 'single',
    bindings: { ...WESTERN_BINDINGS, next: 'ArrowLeft', previous: 'ArrowRight' }
  },
  keyboard: {
    layout: 'single',
    bindings: { ...WESTERN_BINDINGS, next: 'j', previous: 'k' }
  },
  continuous: {
    layout: 'continuous',
    bindings: { ...WESTERN_BINDINGS, next: 'ArrowDown', previous: 'ArrowUp' }
  }
}

/** Close and refresh do not write the resume. Only a turn, zoom, or pan does. */
export function writesResume(reason: 'interact' | 'close' | 'refresh'): boolean {
  return reason === 'interact'
}

/** The saved page when it still exists. Otherwise the first page, never a made-up id. */
export function resumePageId(
  saved: string | null,
  pages: readonly { id: string }[]
): string | null {
  if (saved && pages.some((page) => page.id === saved)) return saved
  return pages[0]?.id ?? null
}

/**
 * Move one step. `next` follows the sequence, not the arrow key.
 * Spread layout steps a whole facing pair. Past the end, the page stays and `ended` is set.
 */
export function readerStep(
  pages: readonly SequencePage[],
  pageId: string,
  layout: ReaderLayout,
  way: 'next' | 'previous'
): { pageId: string; ended: boolean } {
  const units =
    layout === 'spread'
      ? layoutSpreads([...pages]).map((spread) => spread.pageIds[0]!)
      : pages.map((page) => page.id)
  const index =
    layout === 'spread'
      ? layoutSpreads([...pages]).findIndex((spread) => spread.pageIds.includes(pageId))
      : units.indexOf(pageId)
  if (index < 0) return { pageId, ended: false }
  const nextIndex = way === 'next' ? index + 1 : index - 1
  if (nextIndex < 0) return { pageId: units[0] ?? pageId, ended: false }
  if (nextIndex >= units.length) return { pageId, ended: true }
  return { pageId: units[nextIndex] ?? pageId, ended: false }
}

/** The next collection is only the one stored on this collection. */
export function explicitNextChapter(nextCollectionId: string | null): string | null {
  return nextCollectionId
}

export function bindingConflict(bindings: ReaderBindings): string | null {
  const seen = new Map<string, ReaderCommand>()
  for (const command of Object.keys(bindings) as ReaderCommand[]) {
    const key = bindings[command].toLowerCase()
    const other = seen.get(key)
    if (other) return `${bindings[command]} is used by ${other} and ${command}.`
    seen.set(key, command)
  }
  return null
}

/** Clicks turn pages only while the page is fit. A zoomed page is for panning. */
export function clickZone(x: number, width: number, zoom: number): 'previous' | 'next' | null {
  if (zoom > 1.01 || width <= 0) return null
  if (x < width / 3) return 'previous'
  if (x >= (width * 2) / 3) return 'next'
  return null
}

export function zoomAt(
  camera: { zoom: number; x: number; y: number },
  factor: number,
  cursorX: number,
  cursorY: number,
  originX: number,
  originY: number
): { zoom: number; x: number; y: number } {
  const zoom = Math.min(8, Math.max(0.25, camera.zoom * factor))
  const scale = zoom / camera.zoom
  return {
    zoom,
    x: camera.x - (cursorX - originX) * (scale - 1),
    y: camera.y - (cursorY - originY) * (scale - 1)
  }
}

/** Percent inset for a stored crop. Null when the image size is unknown. Does not change the file. */
export function cropInset(
  crop: { x: number; y: number; w: number; h: number } | null,
  width: number | null,
  height: number | null
): string | null {
  if (!crop || !width || !height || width <= 0 || height <= 0) return null
  const top = (crop.y / height) * 100
  const right = ((width - crop.x - crop.w) / width) * 100
  const bottom = ((height - crop.y - crop.h) / height) * 100
  const left = (crop.x / width) * 100
  return `inset(${top}% ${right}% ${bottom}% ${left}%)`
}

export function parseReaderPrefs(raw: string | null): ReaderPrefs {
  let parsed: unknown
  try {
    parsed = raw ? JSON.parse(raw) : null
  } catch {
    parsed = null
  }
  const record = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
  const appearance = record.appearance
  const look =
    appearance && typeof appearance === 'object' ? (appearance as Record<string, unknown>) : {}
  const fit = look.fit === 'width' || look.fit === 'height' ? look.fit : 'contain'
  const bindings = { ...WESTERN_BINDINGS }
  const stored = record.bindings
  if (stored && typeof stored === 'object') {
    for (const command of Object.keys(bindings) as ReaderCommand[]) {
      const key = (stored as Record<string, unknown>)[command]
      if (typeof key === 'string' && key.trim()) bindings[command] = key.trim()
    }
  }
  return {
    appearance: {
      background:
        typeof look.background === 'string' && /^#[0-9a-fA-F]{6}$/.test(look.background)
          ? look.background
          : DEFAULT_READER_APPEARANCE.background,
      margin: clampNumber(look.margin, 0, 80, DEFAULT_READER_APPEARANCE.margin),
      gutter: clampNumber(look.gutter, 0, 80, DEFAULT_READER_APPEARANCE.gutter),
      border: look.border === true,
      fit,
      allowEnlarge: look.allowEnlarge === true,
      smooth: look.smooth !== false
    },
    bindings
  }
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const number = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
