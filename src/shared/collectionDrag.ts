/**
 * Drag planning. The page list is not reordered here. The caller commits
 * `pageIds` and `beforeId` only after the drop.
 */
import { withLockedPartners, type SequenceItem } from './collectionOrder'

export interface DragPage extends SequenceItem {
  span: 1 | 2
}

export interface DragGhost {
  count: number
  locked: boolean
  wide: boolean
}

export type DropPlan =
  | { ok: true; pageIds: string[]; beforeId: string | null; ghost: DragGhost }
  | { ok: false; error: string; ghost: DragGhost }

export function dragGhost(pages: readonly DragPage[], ids: readonly string[]): DragGhost {
  const pageIds = withLockedPartners([...pages], [...ids])
  const moving = new Set(pageIds)
  const chosen = pages.filter((page) => moving.has(page.id))
  return {
    count: chosen.length,
    locked: chosen.some((page) => page.spreadId != null),
    wide: chosen.some((page) => page.span === 2)
  }
}

/**
 * `overId` null appends. A drop between two pages of a locked pair that is not
 * part of the drag is refused. Dropping onto the selection is refused.
 */
export function dropPlan(
  pages: readonly DragPage[],
  ids: readonly string[],
  overId: string | null,
  place: 'before' | 'after'
): DropPlan {
  const ghost = dragGhost(pages, ids)
  const pageIds = withLockedPartners([...pages], [...ids])
  if (pageIds.length === 0) return { ok: false, error: 'Select a page to move.', ghost }
  const moving = new Set(pageIds)
  const rest = pages.filter((page) => !moving.has(page.id))
  if (!overId) return { ok: true, pageIds, beforeId: null, ghost }
  if (moving.has(overId)) {
    return { ok: false, error: 'Drop beside the selection, not onto it.', ghost }
  }
  const index = rest.findIndex((page) => page.id === overId)
  if (index < 0) return { ok: false, error: 'That page is not in this collection.', ghost }
  const at = place === 'before' ? index : index + 1
  const left = rest[at - 1]
  const right = rest[at]
  if (left?.spreadId && left.spreadId === right?.spreadId) {
    return { ok: false, error: 'That would split a locked spread.', ghost }
  }
  return { ok: true, pageIds, beforeId: right?.id ?? null, ghost }
}

/** The pages that would sit against the block. Does not reorder `pages`. */
export function neighborPreview(
  pages: readonly DragPage[],
  pageIds: readonly string[],
  beforeId: string | null
): { earlier: string | null; later: string | null } {
  const moving = new Set(pageIds)
  const rest = pages.filter((page) => !moving.has(page.id))
  const at = beforeId ? rest.findIndex((page) => page.id === beforeId) : rest.length
  return {
    earlier: rest[at - 1]?.id ?? null,
    later: beforeId && at < 0 ? null : (rest[at]?.id ?? null)
  }
}
