import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NoteContent } from '@shared/notes'

export interface NoteDraft {
  objectId: string
  baseRevision: number
  content: NoteContent
  plainText: string
  writtenAt: number
}

export type DraftAssessment =
  { kind: 'redundant' } | { kind: 'restore' } | { kind: 'conflict' } | { kind: 'missing' }

export function assessDraft(
  draft: NoteDraft,
  current: { revision: number; contentJson: string } | null
): DraftAssessment {
  if (!current) return { kind: 'missing' }
  if (current.contentJson === JSON.stringify(draft.content)) return { kind: 'redundant' }
  if (current.revision === draft.baseRevision) return { kind: 'restore' }
  return { kind: 'conflict' }
}

export function draftPath(projectPath: string, objectId: string): string {
  return join(projectPath, 'recovery', `${objectId}.json`)
}

export function writeDraft(projectPath: string, draft: NoteDraft): void {
  const directory = join(projectPath, 'recovery')
  mkdirSync(directory, { recursive: true })
  const finalPath = draftPath(projectPath, draft.objectId)
  const temporary = join(directory, `.${randomUUID()}.json`)
  writeFileSync(temporary, JSON.stringify(draft))
  renameSync(temporary, finalPath)
}

export function readDrafts(projectPath: string): NoteDraft[] {
  const directory = join(projectPath, 'recovery')
  let names: string[]
  try {
    names = readdirSync(directory)
  } catch {
    return []
  }
  const drafts: NoteDraft[] = []
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue
    try {
      const parsed = JSON.parse(readFileSync(join(directory, name), 'utf8')) as NoteDraft
      if (parsed && typeof parsed.objectId === 'string' && parsed.content) drafts.push(parsed)
    } catch {
      // A torn file is ignored until the next write replaces it.
    }
  }
  return drafts
}

export function removeDraft(projectPath: string, objectId: string): void {
  rmSync(draftPath(projectPath, objectId), { force: true })
}

/**
 * Drops a draft only when it matches the saved note. A newer saved note keeps the draft
 * so the user can recover it as a copy.
 */
export function takeDrafts(
  projectPath: string,
  currentOf: (objectId: string) => { revision: number; contentJson: string } | null
): { draft: NoteDraft; assessment: DraftAssessment }[] {
  const pending = []
  for (const draft of readDrafts(projectPath)) {
    const assessment = assessDraft(draft, currentOf(draft.objectId))
    if (assessment.kind === 'redundant') removeDraft(projectPath, draft.objectId)
    else pending.push({ draft, assessment })
  }
  return pending
}
