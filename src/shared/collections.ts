/**
 * Page collections (M9). A page id is not a page number. Numbers and spreads are derived
 * from the sequence, the collection's opening side, and each page's role.
 */

export const PAGE_ROLES = ['cover', 'title', 'story', 'bonus', 'end', 'blank'] as const
export type PageRole = (typeof PAGE_ROLES)[number]

export const PAGE_STATUSES = ['not_started', 'in_progress', 'done', 'skipped'] as const
export type PageStatus = (typeof PAGE_STATUSES)[number]

export type ReadingDirection = 'ltr' | 'rtl'
export type PageSide = 'left' | 'right'

/** Stable ids for the built-in templates. Editing one never rewrites a collection. */
export const BUILTIN_TEMPLATES = {
  blank: 'a1000000-0000-4000-8000-000000000001',
  manga: 'a1000000-0000-4000-8000-000000000002',
  comic: 'a1000000-0000-4000-8000-000000000003'
} as const

export interface TemplateStage {
  name: string
}

export interface TemplateData {
  direction: ReadingDirection
  firstPageSide: PageSide
  stages: TemplateStage[]
}

export const BLANK_TEMPLATE: TemplateData = {
  direction: 'ltr',
  firstPageSide: 'right',
  stages: [{ name: 'Work' }]
}

export const MANGA_TEMPLATE: TemplateData = {
  direction: 'rtl',
  firstPageSide: 'right',
  stages: [
    { name: 'Thumbnail' },
    { name: 'Sketch' },
    { name: 'Inks' },
    { name: 'Tones' },
    { name: 'Lettering' }
  ]
}

export const COMIC_TEMPLATE: TemplateData = {
  direction: 'ltr',
  firstPageSide: 'right',
  stages: [
    { name: 'Layout' },
    { name: 'Pencils' },
    { name: 'Inks' },
    { name: 'Colors' },
    { name: 'Letters' }
  ]
}

export interface NumberedPage {
  id: string
  role: PageRole | null
  /** Null means "use the role". Cover, title, end, and blank are unnumbered unless set false. */
  unnumbered: boolean | null
}

/** Cover, title, end, and intentional blank stay out of the story count unless overridden. */
export function pageIsUnnumbered(page: NumberedPage): boolean {
  if (page.unnumbered != null) return page.unnumbered
  return (
    page.role === 'cover' || page.role === 'title' || page.role === 'end' || page.role === 'blank'
  )
}

/** Story numbers for the pages that count. Unnumbered pages map to null. Ids are unchanged. */
export function derivedNumbers(pages: NumberedPage[], start = 1): Map<string, number | null> {
  const numbers = new Map<string, number | null>()
  let next = start
  for (const page of pages) {
    if (pageIsUnnumbered(page)) {
      numbers.set(page.id, null)
      continue
    }
    numbers.set(page.id, next)
    next += 1
  }
  return numbers
}

export interface SequencePage {
  id: string
  /** 2 when one image occupies two reading positions. The file is not sliced. */
  span: 1 | 2
  /** Shared by exactly two adjacent pages the reader must keep together. */
  spreadId: string | null
}

export interface ReadingSpread {
  pageIds: string[]
  wide: boolean
  locked: boolean
}

/**
 * Facing pages from the sequence. The first ordinary page sits alone.
 * A wide page and a locked pair each take a whole spread. Which side a page
 * sits on is decided later, from the collection's direction and opening side.
 */
export function layoutSpreads(pages: SequencePage[]): ReadingSpread[] {
  const spreads: ReadingSpread[] = []
  let opened = false
  let index = 0
  const alone = (page: SequencePage): ReadingSpread => ({
    pageIds: [page.id],
    wide: false,
    locked: false
  })
  while (index < pages.length) {
    const page = pages[index]!
    const next = pages[index + 1]
    if (page.span === 2) {
      spreads.push({ pageIds: [page.id], wide: true, locked: false })
      opened = true
      index += 1
      continue
    }
    if (page.spreadId && next && next.span !== 2 && next.spreadId === page.spreadId) {
      spreads.push({ pageIds: [page.id, next.id], wide: false, locked: true })
      opened = true
      index += 2
      continue
    }
    const nextStartsPair =
      !!next?.spreadId && pages[index + 2]?.spreadId === next.spreadId && next.span !== 2
    if (!opened) {
      spreads.push(alone(page))
      opened = true
      index += 1
      continue
    }
    if (next && next.span !== 2 && !nextStartsPair && !next.spreadId) {
      spreads.push({ pageIds: [page.id, next.id], wide: false, locked: false })
      index += 2
      continue
    }
    spreads.push(alone(page))
    index += 1
  }
  return spreads
}

/** Which screen side the first page of a spread sits on. */
export function spreadSides(
  spread: ReadingSpread,
  direction: ReadingDirection,
  firstPageSide: PageSide
): { id: string; side: PageSide }[] {
  if (spread.pageIds.length === 1) {
    return [{ id: spread.pageIds[0]!, side: spread.wide ? firstPageSide : firstPageSide }]
  }
  const [first, second] = spread.pageIds
  const firstSide: PageSide = direction === 'rtl' ? 'right' : 'left'
  const other: PageSide = firstSide === 'left' ? 'right' : 'left'
  return [
    { id: first!, side: firstSide },
    { id: second!, side: other }
  ]
}

/** Page entries, reading slots, and artwork files are different counts. */
export function collectionCounts(pages: { span: 1 | 2; hasArtwork: boolean }[]): {
  entries: number
  readingPositions: number
  withArtwork: number
  placeholders: number
} {
  return {
    entries: pages.length,
    readingPositions: pages.reduce((sum, page) => sum + page.span, 0),
    withArtwork: pages.filter((page) => page.hasArtwork).length,
    placeholders: pages.filter((page) => !page.hasArtwork).length
  }
}

/** Natural order: "Page 2" before "Page 10". */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}
