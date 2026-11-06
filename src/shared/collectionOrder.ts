import { naturalCompare } from './collections'

/** Sidebar order. Manual uses the stored order. The others only change what you see. */
export type CollectionOrderMode = 'manual' | 'name' | 'created' | 'modified'

export interface OrderedItem {
  id: string
  label: string
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/** Orders items inside one folder. Name order is numeric, so "Page 2" stays before "Page 10". */
export function orderCollectionItems<T extends OrderedItem>(
  items: T[],
  mode: CollectionOrderMode
): T[] {
  const copy = [...items]
  const byId = (a: T, b: T) => a.id.localeCompare(b.id)
  if (mode === 'name') return copy.sort((a, b) => naturalCompare(a.label, b.label) || byId(a, b))
  if (mode === 'created') return copy.sort((a, b) => a.createdAt - b.createdAt || byId(a, b))
  if (mode === 'modified') return copy.sort((a, b) => b.updatedAt - a.updatedAt || byId(a, b))
  return copy.sort((a, b) => a.sortOrder - b.sortOrder || byId(a, b))
}

/** Puts `id` in front of `beforeId`, or at the end when `beforeId` is null. */
export function placeBefore(ids: string[], id: string, beforeId: string | null): string[] {
  if (!ids.includes(id)) throw new Error('That item is not in this folder.')
  const rest = ids.filter((item) => item !== id)
  if (beforeId && !rest.includes(beforeId)) {
    throw new Error('Drop it beside an item in the same folder.')
  }
  const at = beforeId ? rest.indexOf(beforeId) : rest.length
  return [...rest.slice(0, at), id, ...rest.slice(at)]
}

export interface SequenceItem {
  id: string
  spreadId: string | null
}

/** A locked partner is included so a move cannot leave one page of the pair behind. */
export function withLockedPartners(pages: SequenceItem[], ids: string[]): string[] {
  const selected = new Set(ids)
  for (const page of pages) {
    if (!selected.has(page.id) || !page.spreadId) continue
    for (const partner of pages) {
      if (partner.spreadId === page.spreadId) selected.add(partner.id)
    }
  }
  return pages.map((page) => page.id).filter((id) => selected.has(id))
}

/**
 * One step earlier or later in the sequence. A locked pair is moved whole, and the
 * step jumps over another locked pair instead of landing between its pages.
 * Returns null when the pages are already at that end.
 */
export function stepPages(
  pages: SequenceItem[],
  ids: string[],
  direction: 'earlier' | 'later'
): { pageIds: string[]; beforeId: string | null } | null {
  const moving = withLockedPartners(pages, ids)
  if (moving.length === 0) return null
  const movingSet = new Set(moving)
  const first = pages.findIndex((page) => page.id === moving[0])
  const last = pages.findIndex((page) => page.id === moving[moving.length - 1])
  if (first < 0 || last < 0) return null
  if (direction === 'earlier') {
    const prev = pages[first - 1]
    if (!prev || movingSet.has(prev.id)) return null
    const target = prev.spreadId ? pages.find((page) => page.spreadId === prev.spreadId) : prev
    if (!target || movingSet.has(target.id)) return null
    return { pageIds: moving, beforeId: target.id }
  }
  const next = pages[last + 1]
  if (!next || movingSet.has(next.id)) return null
  let afterIndex = last + 2
  if (next.spreadId) {
    let end = last + 1
    for (let index = last + 1; index < pages.length; index += 1) {
      if (pages[index]?.spreadId !== next.spreadId) break
      end = index
    }
    afterIndex = end + 1
  }
  const after = pages[afterIndex]
  return { pageIds: moving, beforeId: after && !movingSet.has(after.id) ? after.id : null }
}

/**
 * Page selection is a set of page ids. Shift extends from the focused id through the
 * clicked id in the current sequence. It does not use page numbers.
 */
export function selectPageIds(
  orderedIds: string[],
  selected: readonly string[],
  focusId: string | null,
  clickedId: string,
  mode: 'replace' | 'toggle' | 'range'
): { selected: string[]; focusId: string } {
  if (!orderedIds.includes(clickedId)) {
    return {
      selected: orderedIds.filter((id) => selected.includes(id)),
      focusId: focusId ?? clickedId
    }
  }
  if (mode === 'replace') return { selected: [clickedId], focusId: clickedId }
  if (mode === 'toggle') {
    const next = new Set(selected)
    if (next.has(clickedId)) next.delete(clickedId)
    else next.add(clickedId)
    return { selected: orderedIds.filter((id) => next.has(id)), focusId: clickedId }
  }
  const anchor = focusId && orderedIds.includes(focusId) ? focusId : clickedId
  const start = orderedIds.indexOf(anchor)
  const end = orderedIds.indexOf(clickedId)
  const [from, to] = start < end ? [start, end] : [end, start]
  return { selected: orderedIds.slice(from, to + 1), focusId: clickedId }
}
