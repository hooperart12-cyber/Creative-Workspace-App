/**
 * Collection-local search. A filter hides pages; it does not change their order
 * and it is not saved.
 */

export interface CollectionSearchPage {
  id: string
  title: string
  label: string
  notes: string
  number: number | null
  overallStatus: string
  role: string | null
  spreadId: string | null
  span: 1 | 2
  versionNames: string[]
  fileNames: string[]
  tags: string[]
  comments: string[]
  stageNotes: string[]
  /** True when the page has no displayed artwork. */
  blank: boolean
}

/** A non-empty query blocks reordering. Clearing it shows the full sequence again. */
export function collectionQueryActive(query: string): boolean {
  return query.trim().length > 0
}

/** Keeps sequence order. Every word must match. `status:`, `role:`, and `tag:` limit one field. */
export function filterCollectionPages<T extends CollectionSearchPage>(
  pages: T[],
  query: string
): T[] {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return pages
  return pages.filter((page) => tokens.every((token) => pageMatches(page, token)))
}

export function hiddenSelectionCount(
  selected: readonly string[],
  visible: readonly string[]
): number {
  const shown = new Set(visible)
  return selected.filter((id) => !shown.has(id)).length
}

/**
 * Rows that intersect the scroll window. `end` is exclusive. The caller still
 * owns the full page list; this only chooses what to draw.
 */
export function visiblePageRange(input: {
  count: number
  scrollTop: number
  viewport: number
  rowHeight: number
  columns: number
  overscan?: number
}): { start: number; end: number } {
  const columns = Math.max(1, Math.floor(input.columns))
  const rowHeight = Math.max(1, input.rowHeight)
  const overscan = input.overscan ?? 1
  const firstRow = Math.max(0, Math.floor(Math.max(0, input.scrollTop) / rowHeight) - overscan)
  const visibleRows = Math.ceil(Math.max(0, input.viewport) / rowHeight) + overscan * 2
  const start = Math.min(input.count, firstRow * columns)
  const end = Math.min(input.count, start + Math.max(columns, visibleRows * columns))
  return { start, end }
}

function pageMatches(page: CollectionSearchPage, token: string): boolean {
  const field = /^([a-z]+):(.*)$/.exec(token)
  if (field) {
    const key = field[1]
    const value = field[2] ?? ''
    if (key === 'status')
      return page.overallStatus.toLowerCase().replaceAll('_', ' ').includes(value)
    if (key === 'role') return (page.role ?? '').toLowerCase().includes(value)
    if (key === 'tag') return page.tags.some((tag) => tag.toLowerCase().includes(value))
    if (key === 'spread') {
      if (value === 'locked') return page.spreadId != null
      if (value === 'wide') return page.span === 2
      return false
    }
    if (key === 'blank') return page.blank
  }
  return haystack(page).includes(token)
}

function haystack(page: CollectionSearchPage): string {
  return [
    page.title,
    page.label,
    page.notes,
    page.number == null ? '' : String(page.number),
    page.overallStatus.replaceAll('_', ' '),
    page.role ?? '',
    page.blank ? 'blank placeholder' : '',
    page.spreadId ? 'locked spread' : '',
    page.span === 2 ? 'wide' : '',
    ...page.versionNames,
    ...page.fileNames,
    ...page.tags,
    ...page.comments,
    ...page.stageNotes
  ]
    .join('\n')
    .toLowerCase()
}
