import type { SearchHit } from '@shared/types'

export type SearchGroup =
  | { kind: 'single'; key: string; hit: SearchHit }
  | { kind: 'stack'; key: string; title: string; stack: SearchHit; slides: SearchHit[] }

/** Groups slide hits under their stack. A slide-only page still opens the parent stack. */
export function groupSearchHits(hits: SearchHit[]): SearchGroup[] {
  const groups: SearchGroup[] = []
  const stacks = new Map<string, Extract<SearchGroup, { kind: 'stack' }>>()
  for (const hit of hits) {
    if ((hit.kind === 'stack' || hit.kind === 'slide') && hit.stackId) {
      let group = stacks.get(hit.stackId)
      if (!group) {
        group = {
          kind: 'stack',
          key: hit.stackId,
          title: hit.kind === 'stack' ? hit.title : hit.stackTitle?.trim() || 'Stack',
          stack: hit.kind === 'stack' ? hit : stackHitFromSlide(hit),
          slides: []
        }
        stacks.set(hit.stackId, group)
        groups.push(group)
      }
      if (hit.kind === 'stack') {
        group.stack = hit
        group.title = hit.title
      } else group.slides.push(hit)
    } else {
      groups.push({
        kind: 'single',
        key: `${hit.kind}:${hit.sourceId}:${hit.page ?? ''}:${hit.objectId ?? ''}:${hit.entryId ?? ''}`,
        hit
      })
    }
  }
  return groups
}

/** A stack result built from a slide, so the group header selects the stack and not the slide. */
function stackHitFromSlide(hit: SearchHit): SearchHit {
  const stackId = hit.objectId ?? hit.stackId ?? hit.sourceId
  return {
    kind: 'stack',
    sourceId: stackId,
    assetId: null,
    page: null,
    title: hit.stackTitle?.trim() || 'Stack',
    snippet: '',
    location: hit.location,
    objectId: stackId,
    boardId: hit.boardId,
    stackId: hit.stackId,
    slideId: null
  }
}
