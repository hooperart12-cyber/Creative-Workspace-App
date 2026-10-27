import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  DEFAULT_APPEARANCE,
  NEW_NOTE_HEIGHT,
  NOTE_DEFAULT_WIDTH,
  NOTE_MIN_HEIGHT,
  NOTE_MIN_WIDTH,
  NOTE_SCHEMA_VERSION,
  NOTE_TYPE,
  migrateContent,
  newNoteData,
  plainTextOf,
  readNote,
  sanitizeAppearance,
  sanitizeDoc,
  type NoteContent
} from '@shared/notes'
import type {
  CanvasObject,
  CreateNoteInput,
  NoteStylePatch,
  SaveNoteInput,
  SaveNoteResult
} from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects } from '../db/schema'
import { toCanvasObject, type BoardRepository } from './boards'

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Rich text notes (§5, ADR-014). Placement, copying and the trash work like any other
 * object (ObjectRepository); this saves what's inside. Text saves are checked against the
 * revision the editor started from, so two windows can never silently overwrite each other.
 */
export class NoteRepository {
  constructor(
    private readonly db: ProjectDb,
    private readonly boards: BoardRepository
  ) {}

  create(input: CreateNoteInput): CanvasObject {
    this.boards.require(input.boardId)
    const data = newNoteData()
    if (input.content) {
      const doc = sanitizeDoc(input.content.doc)
      data.content = { schemaVersion: NOTE_SCHEMA_VERSION, doc }
      data.plainText = plainTextOf(doc)
    }
    data.appearance = { ...DEFAULT_APPEARANCE, ...sanitizeAppearance(input.appearance) }
    if (input.sizing === 'fixed') data.sizing = 'fixed'
    const id = randomUUID()
    const now = new Date()
    this.db
      .insert(boardObjects)
      .values({
        id,
        boardId: input.boardId,
        type: NOTE_TYPE,
        x: round2(input.at.x),
        y: round2(input.at.y),
        width: round2(Math.max(NOTE_MIN_WIDTH, input.width ?? NOTE_DEFAULT_WIDTH)),
        height: round2(Math.max(NOTE_MIN_HEIGHT, input.height ?? NEW_NOTE_HEIGHT)),
        zIndex: this.boards.topZ(input.boardId) + 1,
        data: data as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return this.get([id])[0]
  }

  /**
   * Saves a note's text if nobody else saved since `baseRevision`. Otherwise nothing is
   * written and the caller gets the other version, so the user can decide.
   */
  saveContent({ id, baseRevision, content, height }: SaveNoteInput): SaveNoteResult {
    const doc = sanitizeDoc(migrateContent(content).doc)
    return this.db.transaction((tx) => {
      const row = tx
        .select()
        .from(boardObjects)
        .where(and(eq(boardObjects.id, id), eq(boardObjects.type, NOTE_TYPE)))
        .get()
      if (!row || row.deletedAt) return { ok: false, reason: 'deleted' }
      if (row.revision !== baseRevision) {
        const current = readNote(row.data)
        return {
          ok: false,
          reason: 'conflict',
          revision: row.revision,
          content: current.ok ? current.note.content : null
        }
      }
      const data = {
        ...row.data,
        content: { schemaVersion: NOTE_SCHEMA_VERSION, doc } satisfies NoteContent,
        plainText: plainTextOf(doc)
      }
      const revision = row.revision + 1
      const autoHeight = row.data.sizing !== 'fixed'
      tx.update(boardObjects)
        .set({
          data,
          revision,
          ...(autoHeight && height !== undefined && Number.isFinite(height)
            ? { height: round2(Math.max(NOTE_MIN_HEIGHT, height)) }
            : {}),
          updatedAt: new Date()
        })
        .where(eq(boardObjects.id, id))
        .run()
      return { ok: true, revision }
    })
  }

  /** Changes whole-note appearance, sizing mode and height. Text is never touched. */
  updateStyle(patches: NoteStylePatch[]): void {
    if (patches.length === 0) return
    const now = new Date()
    this.db.transaction((tx) => {
      for (const patch of patches) {
        const row = tx
          .select()
          .from(boardObjects)
          .where(
            and(
              eq(boardObjects.id, patch.id),
              eq(boardObjects.type, NOTE_TYPE),
              isNull(boardObjects.deletedAt)
            )
          )
          .get()
        if (!row) throw new Error('Note not found. It may have been deleted.')
        const current = isRecord(row.data.appearance) ? row.data.appearance : {}
        const data: Record<string, unknown> = {
          ...row.data,
          appearance: {
            ...DEFAULT_APPEARANCE,
            ...sanitizeAppearance(current),
            ...sanitizeAppearance(patch.appearance)
          }
        }
        if (patch.sizing === 'auto' || patch.sizing === 'fixed') data.sizing = patch.sizing
        tx.update(boardObjects)
          .set({
            data,
            ...(patch.height !== undefined && Number.isFinite(patch.height)
              ? { height: round2(Math.max(NOTE_MIN_HEIGHT, patch.height)) }
              : {}),
            updatedAt: now
          })
          .where(eq(boardObjects.id, patch.id))
          .run()
      }
    })
  }

  /** Current notes among `ids` (trashed or missing ones are left out). */
  get(ids: string[]): CanvasObject[] {
    if (ids.length === 0) return []
    return this.db
      .select()
      .from(boardObjects)
      .where(
        and(
          inArray(boardObjects.id, ids),
          eq(boardObjects.type, NOTE_TYPE),
          isNull(boardObjects.deletedAt)
        )
      )
      .all()
      .map(toCanvasObject)
  }

  /** The board a note is on (for change broadcasts). */
  boardOf(id: string): string | undefined {
    return this.db
      .select({ boardId: boardObjects.boardId })
      .from(boardObjects)
      .where(eq(boardObjects.id, id))
      .get()?.boardId
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
