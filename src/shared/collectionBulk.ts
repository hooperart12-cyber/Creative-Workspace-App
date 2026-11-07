/**
 * Bulk edits name the field they change. A status edit does not copy notes,
 * and Replace notes is refused until the caller confirms the preview.
 */
import {
  PAGE_ROLES,
  PAGE_STATUSES,
  type PagePatch,
  type PageRole,
  type PageStatus
} from './collections'

export type BulkOperation =
  | { kind: 'status'; status: PageStatus }
  | { kind: 'append-notes'; text: string }
  | { kind: 'replace-notes'; text: string }
  | { kind: 'role'; role: PageRole | null }
  | { kind: 'add-tag'; tagId: string }
  | { kind: 'remove-tag'; tagId: string }
  | { kind: 'set-stage'; stageId: string; state: PageStatus }

export interface BulkTarget {
  id: string
  notes: string
  overallStatus: string
  role: string | null
  tagIds?: readonly string[]
  stages?: readonly { stageId: string; state: string }[]
}

export type BulkUndoEntry =
  | { kind: 'page'; id: string; revision: number; previous: PagePatch }
  | { kind: 'tag'; id: string; tagId: string; added: boolean }
  | {
      kind: 'stage'
      id: string
      stageId: string
      previous: string | null
      previousNote: string
      applied: string
    }

export interface BulkPreflight {
  targeted: number
  alreadyMatching: string[]
  changed: string[]
  incompatible: { id: string; reason: string }[]
  /** True only for replacing notes. The caller must confirm before writing. */
  dangerous: boolean
  /** The only page fields this operation writes. */
  fields: string[]
}

export type BulkDecision =
  | { kind: 'same' }
  | { kind: 'incompatible'; reason: string }
  | { kind: 'change'; patch: PagePatch; previous: PagePatch }
  | { kind: 'tag'; tagId: string; added: boolean }
  | { kind: 'stage'; stageId: string; state: PageStatus; previous: string | null }

const FIELDS: Record<BulkOperation['kind'], string[]> = {
  status: ['overallStatus'],
  'append-notes': ['notes'],
  'replace-notes': ['notes'],
  role: ['role'],
  'add-tag': ['tag'],
  'remove-tag': ['tag'],
  'set-stage': ['stage']
}

export function preflightBulk(
  pages: readonly BulkTarget[],
  ids: readonly string[],
  operation: BulkOperation
): BulkPreflight {
  const byId = new Map(pages.map((page) => [page.id, page]))
  const alreadyMatching: string[] = []
  const changed: string[] = []
  const incompatible: { id: string; reason: string }[] = []
  for (const id of ids) {
    const page = byId.get(id)
    if (!page) {
      incompatible.push({ id, reason: 'That page is not in this collection.' })
      continue
    }
    const decision = bulkDecision(page, operation)
    if (decision.kind === 'same') alreadyMatching.push(id)
    else if (decision.kind === 'incompatible') incompatible.push({ id, reason: decision.reason })
    else changed.push(id)
  }
  return {
    targeted: ids.length,
    alreadyMatching,
    changed,
    incompatible,
    dangerous: operation.kind === 'replace-notes',
    fields: FIELDS[operation.kind]
  }
}

/** One page, one field. `same` and `incompatible` write nothing. */
export function bulkDecision(page: BulkTarget, operation: BulkOperation): BulkDecision {
  if (operation.kind === 'status') {
    if (page.overallStatus === operation.status) return { kind: 'same' }
    const previous = asStatus(page.overallStatus)
    return {
      kind: 'change',
      patch: { overallStatus: operation.status },
      previous: { overallStatus: previous }
    }
  }
  if (operation.kind === 'role') {
    if ((page.role ?? null) === operation.role) return { kind: 'same' }
    return {
      kind: 'change',
      patch: { role: operation.role },
      previous: { role: asRole(page.role) }
    }
  }
  if (operation.kind === 'append-notes') {
    const text = operation.text.trim()
    if (!text) return { kind: 'incompatible', reason: 'Enter the note to append.' }
    const notes = page.notes ? `${page.notes}\n${text}` : text
    return { kind: 'change', patch: { notes }, previous: { notes: page.notes } }
  }
  if (operation.kind === 'add-tag' || operation.kind === 'remove-tag') {
    if (!operation.tagId) return { kind: 'incompatible', reason: 'Choose a tag.' }
    const has = page.tagIds?.includes(operation.tagId) ?? false
    if (operation.kind === 'add-tag') {
      if (has) return { kind: 'same' }
      return { kind: 'tag', tagId: operation.tagId, added: true }
    }
    if (!has) return { kind: 'same' }
    return { kind: 'tag', tagId: operation.tagId, added: false }
  }
  if (operation.kind === 'set-stage') {
    if (!operation.stageId) return { kind: 'incompatible', reason: 'Choose a stage.' }
    const current = page.stages?.find((stage) => stage.stageId === operation.stageId)
    if (current?.state === operation.state) return { kind: 'same' }
    return {
      kind: 'stage',
      stageId: operation.stageId,
      state: operation.state,
      previous: current?.state ?? null
    }
  }
  if (page.notes === operation.text) return { kind: 'same' }
  return {
    kind: 'change',
    patch: { notes: operation.text },
    previous: { notes: page.notes }
  }
}

function asStatus(value: string): PageStatus {
  return PAGE_STATUSES.includes(value as PageStatus) ? (value as PageStatus) : 'not_started'
}

function asRole(value: string | null): PageRole | null {
  if (value == null) return null
  return PAGE_ROLES.includes(value as PageRole) ? (value as PageRole) : null
}
