import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import type {
  BoardDetail,
  CanvasObject,
  LibraryDetails,
  PromoteTagResult,
  RestoreTagResult,
  TagAssignment,
  TagPill,
  TagRecord,
  TagTarget,
  TagTargetType,
  TagVisibility
} from '@shared/types'
import type { ProjectDb } from '../db/client'
import { tagColor, tagNameParts } from './tagNames'

export const TAG_UNDO_REFUSED =
  'Those tags were changed in another window. This undo was not applied.'

interface TagRow {
  id: string
  name: string
  color: string | null
  reusable: number
  owner_type: TagTargetType | null
  owner_id: string | null
  archived_at: number | null
  deleted_at: number | null
  assignment_count: number
}

/**
 * Reusable tags, one-off tags, and their assignments.
 * Writes are one transaction. Assignment ids let an undo refuse when another window
 * has already changed that same assignment.
 */
export class TagRepository {
  constructor(private readonly db: ProjectDb) {}

  createReusable(name: string, color?: string | null): TagRecord {
    const parts = tagNameParts(name)
    const paint = tagColor(color)
    const taken = this.liveReusable(parts.normalized)
    if (taken) {
      throw new Error(
        taken.archived_at
          ? 'That name is reserved by an archived tag until it is permanently deleted.'
          : 'A tag with that name already exists.'
      )
    }
    const id = randomUUID()
    const now = Date.now()
    this.db.run(sql`
      INSERT INTO tags (
        id, name, normalized_name, color, reusable, owner_type, owner_id, archived_at,
        created_at, updated_at, deleted_at
      ) VALUES (
        ${id}, ${parts.name}, ${parts.normalized}, ${paint}, 1, NULL, NULL, NULL,
        ${now}, ${now}, NULL
      )
    `)
    return this.require(id)
  }

  createOneOff(name: string, target: TagTarget, color?: string | null): TagRecord {
    this.requireTarget(target.type, target.id)
    const parts = tagNameParts(name)
    const paint = tagColor(color)
    const id = randomUUID()
    const now = Date.now()
    try {
      this.db.run(sql`
        INSERT INTO tags (
          id, name, normalized_name, color, reusable, owner_type, owner_id, archived_at,
          created_at, updated_at, deleted_at
        ) VALUES (
          ${id}, ${parts.name}, ${parts.normalized}, ${paint}, 0, ${target.type}, ${target.id}, NULL,
          ${now}, ${now}, NULL
        )
      `)
    } catch (error) {
      if (String(error).includes('tags_oneoff_owner_idx')) {
        throw new Error('This item already has a one-off tag with that name.', { cause: error })
      }
      throw error
    }
    return this.require(id)
  }

  /** Deletes a one-off only while it is still the tag this window created. */
  removeOneOff(id: string): void {
    const row = this.db.get<{ reusable: number }>(sql`SELECT reusable FROM tags WHERE id = ${id}`)
    if (!row || row.reusable !== 0) throw new Error(TAG_UNDO_REFUSED)
    this.db.run(sql`DELETE FROM tags WHERE id = ${id} AND reusable = 0`)
  }

  /** Assigns a reusable tag. A second assignment of the same tag returns the existing row. */
  assign(tagId: string, target: TagTarget): TagAssignment & { created: boolean } {
    const tag = this.require(tagId)
    if (!tag.reusable) throw new Error('A one-off tag stays on the item it was created for.')
    if (tag.deleted) throw new Error('That tag is in the trash.')
    this.requireTarget(target.type, target.id)
    const existing = this.db.get<{ id: string }>(sql`
      SELECT id FROM taggings
      WHERE tag_id = ${tagId} AND target_type = ${target.type} AND target_id = ${target.id}
    `)
    if (existing) {
      return {
        id: existing.id,
        tagId,
        targetType: target.type,
        targetId: target.id,
        created: false
      }
    }
    const id = randomUUID()
    this.db.run(sql`
      INSERT INTO taggings (id, tag_id, target_type, target_id, created_at)
      VALUES (${id}, ${tagId}, ${target.type}, ${target.id}, ${Date.now()})
    `)
    return { id, tagId, targetType: target.type, targetId: target.id, created: true }
  }

  /** Removes one assignment. Returns the row that was deleted, so undo can restore that identity. */
  unassign(tagId: string, target: TagTarget): TagAssignment | null {
    const row = this.db.get<{ id: string }>(sql`
      SELECT id FROM taggings
      WHERE tag_id = ${tagId} AND target_type = ${target.type} AND target_id = ${target.id}
    `)
    if (!row) return null
    this.db.run(sql`DELETE FROM taggings WHERE id = ${row.id}`)
    return { id: row.id, tagId, targetType: target.type, targetId: target.id }
  }

  addMany(tagIds: string[], targets: TagTarget[]): TagAssignment[] {
    const uniqueTargets = dedupeTargets(targets)
    const added: TagAssignment[] = []
    this.db.transaction(() => {
      for (const target of uniqueTargets) {
        for (const tagId of [...new Set(tagIds)]) {
          const row = this.assign(tagId, target)
          if (row.created) added.push(row)
        }
      }
    })
    return added
  }

  removeMany(tagIds: string[], targets: TagTarget[]): TagAssignment[] {
    const removed: TagAssignment[] = []
    this.db.transaction(() => {
      for (const target of dedupeTargets(targets)) {
        for (const tagId of [...new Set(tagIds)]) {
          const row = this.unassign(tagId, target)
          if (row) removed.push(row)
        }
      }
    })
    return removed
  }

  /**
   * Replaces the direct tags on each target. Inherited original-file tags are left alone.
   * One-offs on those targets are part of the direct set and are removed with it.
   */
  replaceDirect(
    tagIds: string[],
    targets: TagTarget[]
  ): {
    before: TagAssignment[]
    after: TagAssignment[]
  } {
    const uniqueTargets = dedupeTargets(targets)
    const ids = [...new Set(tagIds)]
    for (const tagId of ids) {
      const tag = this.require(tagId)
      if (!tag.reusable || tag.deleted) throw new Error('Replace can only apply reusable tags.')
    }
    let before: TagAssignment[] = []
    let after: TagAssignment[] = []
    this.db.transaction(() => {
      before = uniqueTargets.flatMap((target) => this.directAssignments(target))
      for (const target of uniqueTargets) {
        this.db.run(sql`
          DELETE FROM taggings WHERE target_type = ${target.type} AND target_id = ${target.id}
        `)
        this.db.run(sql`
          DELETE FROM tags
          WHERE reusable = 0 AND deleted_at IS NULL
            AND owner_type = ${target.type} AND owner_id = ${target.id}
        `)
        for (const tagId of ids) this.assign(tagId, target)
      }
      after = uniqueTargets.flatMap((target) => this.directAssignments(target))
    })
    return { before, after }
  }

  revertAdd(ids: string[]): void {
    if (ids.length === 0) return
    this.db.transaction(() => {
      const found = this.idsIn(ids)
      if (found.length !== new Set(ids).size) throw new Error(TAG_UNDO_REFUSED)
      this.deleteIds(ids)
    })
  }

  revertRemove(rows: TagAssignment[]): void {
    if (rows.length === 0) return
    this.db.transaction(() => {
      for (const row of rows) {
        const current = this.db.get<{ id: string }>(sql`
          SELECT id FROM taggings
          WHERE tag_id = ${row.tagId} AND target_type = ${row.targetType} AND target_id = ${row.targetId}
        `)
        if (current) throw new Error(TAG_UNDO_REFUSED)
        const tag = this.db.get<{ id: string }>(sql`
          SELECT id FROM tags WHERE id = ${row.tagId} AND deleted_at IS NULL AND reusable = 1
        `)
        if (!tag) throw new Error(TAG_UNDO_REFUSED)
        this.db.run(sql`
          INSERT INTO taggings (id, tag_id, target_type, target_id, created_at)
          VALUES (${row.id}, ${row.tagId}, ${row.targetType}, ${row.targetId}, ${Date.now()})
        `)
      }
    })
  }

  /** Puts the previous direct set back only when the current set is still exactly `expectedIds`. */
  revertReplace(targets: TagTarget[], expectedIds: string[], restore: TagAssignment[]): void {
    const uniqueTargets = dedupeTargets(targets)
    this.db.transaction(() => {
      const current = uniqueTargets.flatMap((target) => this.directAssignments(target))
      if (
        !sameIds(
          current.map((row) => row.id),
          expectedIds
        )
      )
        throw new Error(TAG_UNDO_REFUSED)
      for (const target of uniqueTargets) {
        this.db.run(sql`
          DELETE FROM taggings WHERE target_type = ${target.type} AND target_id = ${target.id}
        `)
        this.db.run(sql`
          DELETE FROM tags
          WHERE reusable = 0 AND deleted_at IS NULL
            AND owner_type = ${target.type} AND owner_id = ${target.id}
        `)
      }
      for (const row of restore) this.restoreAssignment(row)
    })
  }

  rename(id: string, name: string): TagRecord {
    const tag = this.require(id)
    if (!tag.reusable || tag.deleted)
      throw new Error('Only a reusable tag in the library can be renamed.')
    const parts = tagNameParts(name)
    const taken = this.liveReusable(parts.normalized)
    if (taken && taken.id !== id) {
      throw new Error(
        taken.archived_at
          ? 'That name is reserved by an archived tag until it is permanently deleted.'
          : 'A tag with that name already exists.'
      )
    }
    this.db.run(sql`
      UPDATE tags SET name = ${parts.name}, normalized_name = ${parts.normalized}, updated_at = ${Date.now()}
      WHERE id = ${id}
    `)
    return this.require(id)
  }

  recolor(id: string, color: string | null): TagRecord {
    const tag = this.require(id)
    if (tag.deleted) throw new Error('That tag is in the trash.')
    const paint = tagColor(color)
    this.db.run(sql`UPDATE tags SET color = ${paint}, updated_at = ${Date.now()} WHERE id = ${id}`)
    return this.require(id)
  }

  archive(id: string): TagRecord {
    const tag = this.require(id)
    if (!tag.reusable || tag.deleted) throw new Error('Only a reusable tag can be archived.')
    this.db.run(sql`
      UPDATE tags SET archived_at = ${Date.now()}, updated_at = ${Date.now()} WHERE id = ${id}
    `)
    return this.require(id)
  }

  unarchive(id: string): TagRecord {
    const tag = this.require(id)
    if (!tag.reusable || tag.deleted) throw new Error('Only a reusable tag can be unarchived.')
    this.db.run(
      sql`UPDATE tags SET archived_at = NULL, updated_at = ${Date.now()} WHERE id = ${id}`
    )
    return this.require(id)
  }

  trash(id: string): { tag: TagRecord; assignments: number } {
    const tag = this.require(id)
    if (tag.deleted) throw new Error('That tag is already in the trash.')
    const assignments = tag.assignmentCount
    this.db.run(
      sql`UPDATE tags SET deleted_at = ${Date.now()}, updated_at = ${Date.now()} WHERE id = ${id}`
    )
    return { tag: this.require(id), assignments }
  }

  /**
   * Restores a trashed tag. If its name is now used, nothing is written and the caller
   * must choose a new name or cancel.
   */
  restore(id: string, name?: string): RestoreTagResult {
    const tag = this.require(id)
    if (!tag.deleted) throw new Error('That tag is not in the trash.')
    const parts = name == null ? tagNameParts(tag.name) : tagNameParts(name)
    if (tag.reusable) {
      const taken = this.liveReusable(parts.normalized)
      if (taken) return { status: 'name-taken', suggestedName: this.suggestRestoreName(tag.name) }
      this.db.run(sql`
        UPDATE tags
        SET name = ${parts.name}, normalized_name = ${parts.normalized}, deleted_at = NULL, updated_at = ${Date.now()}
        WHERE id = ${id}
      `)
    } else {
      this.db.run(
        sql`UPDATE tags SET deleted_at = NULL, updated_at = ${Date.now()} WHERE id = ${id}`
      )
    }
    return { status: 'restored', tag: this.require(id) }
  }

  /** Removes the tag and its assignments. Other tags are untouched. */
  purge(id: string): { assignments: number } {
    const tag = this.require(id)
    const assignments = tag.assignmentCount
    this.db.transaction(() => {
      this.db.run(sql`DELETE FROM taggings WHERE tag_id = ${id}`)
      this.db.run(sql`DELETE FROM tags WHERE id = ${id}`)
    })
    return { assignments }
  }

  /**
   * Moves every assignment from one reusable tag onto another, then deletes the source.
   * Refuses if either tag is in the trash.
   */
  merge(sourceId: string, destinationId: string): { moved: number; destination: TagRecord } {
    if (sourceId === destinationId) throw new Error('Choose a different tag to merge into.')
    const source = this.require(sourceId)
    const destination = this.require(destinationId)
    if (!source.reusable || !destination.reusable)
      throw new Error('Only reusable tags can be merged.')
    if (source.deleted || destination.deleted)
      throw new Error('Tags in the trash cannot be merged.')
    this.db.transaction(() => {
      const rows = this.db.all<{ id: string; target_type: string; target_id: string }>(sql`
        SELECT id, target_type, target_id FROM taggings WHERE tag_id = ${sourceId}
      `)
      for (const row of rows) {
        const clash = this.db.get<{ id: string }>(sql`
          SELECT id FROM taggings
          WHERE tag_id = ${destinationId} AND target_type = ${row.target_type} AND target_id = ${row.target_id}
        `)
        if (clash) this.db.run(sql`DELETE FROM taggings WHERE id = ${row.id}`)
        else this.db.run(sql`UPDATE taggings SET tag_id = ${destinationId} WHERE id = ${row.id}`)
      }
      this.db.run(sql`DELETE FROM tags WHERE id = ${sourceId}`)
    })
    return { moved: source.assignmentCount, destination: this.require(destinationId) }
  }

  /**
   * Turns a one-off into a reusable tag, or reports a name collision without changing anything.
   * Pass `useExisting` or `restoreTrashed` only after the user confirms that choice.
   */
  promote(
    id: string,
    choice?: { useExisting?: boolean; restoreTrashed?: boolean }
  ): PromoteTagResult {
    const tag = this.require(id)
    if (tag.reusable || !tag.ownerType || !tag.ownerId)
      throw new Error('That tag is already reusable.')
    const parts = tagNameParts(tag.name)
    const live = this.liveReusable(parts.normalized)
    const trashed = this.db.get<TagRow>(sql`
      SELECT ${this.tagColumns} FROM tags t
      WHERE t.reusable = 1 AND t.deleted_at IS NOT NULL AND t.normalized_name = ${parts.normalized}
      LIMIT 1
    `)
    if (live && !choice?.useExisting) return { status: 'use-existing', existing: toRecord(live) }
    if (!live && trashed && !choice?.restoreTrashed) {
      return { status: 'trashed-exists', existing: toRecord(trashed) }
    }
    let reusableId = live?.id
    this.db.transaction(() => {
      if (!reusableId && trashed && choice?.restoreTrashed) {
        this.db.run(sql`
          UPDATE tags SET deleted_at = NULL, updated_at = ${Date.now()} WHERE id = ${trashed.id}
        `)
        reusableId = trashed.id
      }
      if (!reusableId) {
        reusableId = randomUUID()
        const now = Date.now()
        this.db.run(sql`
          INSERT INTO tags (
            id, name, normalized_name, color, reusable, owner_type, owner_id, archived_at,
            created_at, updated_at, deleted_at
          ) VALUES (
            ${reusableId}, ${parts.name}, ${parts.normalized}, ${tag.color}, 1, NULL, NULL, NULL,
            ${now}, ${now}, NULL
          )
        `)
      }
      this.assign(reusableId, { type: tag.ownerType!, id: tag.ownerId! })
      this.db.run(sql`DELETE FROM tags WHERE id = ${id}`)
    })
    return { status: 'promoted', tag: this.require(reusableId!) }
  }

  list(options?: { query?: string; includeArchived?: boolean; trash?: boolean }): TagRecord[] {
    const query = options?.query?.trim() ?? ''
    const needle = query ? `%${query.replace(/[\\%_]/g, '')}%` : null
    const rows = this.db.all<TagRow>(sql`
      SELECT ${this.tagColumns} FROM tags t
      WHERE t.reusable = 1
        AND ${options?.trash ? sql`t.deleted_at IS NOT NULL` : sql`t.deleted_at IS NULL`}
        AND ${options?.includeArchived || options?.trash ? sql`1` : sql`t.archived_at IS NULL`}
        AND ${needle ? sql`t.name LIKE ${needle}` : sql`1`}
      ORDER BY t.name COLLATE NOCASE, t.id
    `)
    return rows.map(toRecord)
  }

  /** How many of the targets carry each direct tag. Inherited original-file tags are not included. */
  directSummary(
    targets: TagTarget[]
  ): { id: string; name: string; color: string | null; present: number; total: number }[] {
    const unique = dedupeTargets(targets)
    if (unique.length === 0) return []
    const counts = new Map<string, { name: string; color: string | null; present: number }>()
    for (const target of unique) {
      for (const pill of this.pillsFor(target.type, target.id, null, false)) {
        const current = counts.get(pill.id) ?? { name: pill.name, color: pill.color, present: 0 }
        current.present += 1
        counts.set(pill.id, current)
      }
    }
    return [...counts.entries()]
      .map(([id, row]) => ({ id, ...row, total: unique.length }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en'))
  }

  listOneOffs(): TagRecord[] {
    return this.db
      .all<TagRow>(
        sql`
        SELECT ${this.tagColumns} FROM tags t
        WHERE t.reusable = 0 AND t.deleted_at IS NULL
        ORDER BY t.name COLLATE NOCASE, t.id
      `
      )
      .map(toRecord)
  }

  setVisibility(boardId: string, visibility: TagVisibility): void {
    if (!['hidden', 'hover', 'always'].includes(visibility)) {
      throw new Error('Choose hidden, hover, or always visible.')
    }
    const board = this.db.get(sql`SELECT id FROM boards WHERE id = ${boardId}`)
    if (!board) throw new Error('That board no longer exists.')
    this.db.run(sql`
      UPDATE boards SET tag_visibility = ${visibility}, updated_at = ${Date.now()} WHERE id = ${boardId}
    `)
  }

  /** Effective pills for each canvas object, and the board's own tags. */
  decorateBoard(detail: BoardDetail): BoardDetail {
    const objects = detail.objects.map((object) => ({
      ...object,
      tags: this.pillsForObject(object)
    }))
    return {
      ...detail,
      objects,
      tags: this.pillsFor('board', detail.id, null, false)
    }
  }

  decorateLibrary(details: LibraryDetails): LibraryDetails {
    return {
      ...details,
      tags: this.pillsFor('entry', details.entry.id, details.entry.assetId, true)
    }
  }

  pillsFor(
    type: TagTargetType,
    id: string,
    assetId: string | null,
    inheritsAsset: boolean
  ): TagPill[] {
    const direct = this.pillRows(type, id, 'direct')
    const inherited = inheritsAsset && assetId ? this.pillRows('asset', assetId, 'asset') : []
    const seen = new Set(direct.map((pill) => pill.id))
    return [...direct, ...inherited.filter((pill) => !seen.has(pill.id))]
  }

  private pillsForObject(object: CanvasObject): TagPill[] {
    const inherits = !!object.assetId && object.type !== 'text' && object.type !== 'board'
    return this.pillsFor('object', object.id, object.assetId, inherits)
  }

  private pillRows(type: TagTargetType, id: string, source: 'direct' | 'asset'): TagPill[] {
    const assigned = this.db.all<{
      id: string
      name: string
      color: string | null
      assignment_id: string
    }>(sql`
      SELECT t.id, t.name, t.color, g.id AS assignment_id
      FROM taggings g JOIN tags t ON t.id = g.tag_id
      WHERE g.target_type = ${type} AND g.target_id = ${id} AND t.deleted_at IS NULL
      ORDER BY t.name COLLATE NOCASE
    `)
    const oneOffs = this.db.all<{ id: string; name: string; color: string | null }>(sql`
      SELECT id, name, color FROM tags
      WHERE reusable = 0 AND deleted_at IS NULL AND owner_type = ${type} AND owner_id = ${id}
      ORDER BY name COLLATE NOCASE
    `)
    return [
      ...assigned.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        source,
        oneOff: false,
        assignmentId: row.assignment_id
      })),
      ...oneOffs.map((row) => ({
        id: row.id,
        name: row.name,
        color: row.color,
        source,
        oneOff: true,
        assignmentId: row.id
      }))
    ]
  }

  private directAssignments(target: TagTarget): TagAssignment[] {
    const assigned = this.db.all<{ id: string; tag_id: string }>(sql`
      SELECT id, tag_id FROM taggings
      WHERE target_type = ${target.type} AND target_id = ${target.id}
    `)
    const oneOffs = this.db.all<{ id: string; name: string; color: string | null }>(sql`
      SELECT id, name, color FROM tags
      WHERE reusable = 0 AND deleted_at IS NULL
        AND owner_type = ${target.type} AND owner_id = ${target.id}
    `)
    return [
      ...assigned.map((row) => ({
        id: row.id,
        tagId: row.tag_id,
        targetType: target.type,
        targetId: target.id
      })),
      ...oneOffs.map((row) => ({
        id: row.id,
        tagId: row.id,
        targetType: target.type,
        targetId: target.id,
        oneOff: { name: row.name, color: row.color }
      }))
    ]
  }

  private restoreAssignment(row: TagAssignment): void {
    if (row.oneOff) {
      const parts = tagNameParts(row.oneOff.name)
      const now = Date.now()
      this.db.run(sql`
        INSERT INTO tags (
          id, name, normalized_name, color, reusable, owner_type, owner_id, archived_at,
          created_at, updated_at, deleted_at
        ) VALUES (
          ${row.id}, ${parts.name}, ${parts.normalized}, ${tagColor(row.oneOff.color)}, 0,
          ${row.targetType}, ${row.targetId}, NULL, ${now}, ${now}, NULL
        )
      `)
      return
    }
    this.db.run(sql`
      INSERT INTO taggings (id, tag_id, target_type, target_id, created_at)
      VALUES (${row.id}, ${row.tagId}, ${row.targetType}, ${row.targetId}, ${Date.now()})
    `)
  }

  private requireTarget(type: TagTargetType, id: string): void {
    const row =
      type === 'asset'
        ? this.db.get(sql`SELECT id FROM assets WHERE id = ${id}`)
        : type === 'entry'
          ? this.db.get(sql`SELECT id FROM library_entries WHERE id = ${id}`)
          : type === 'board'
            ? this.db.get(sql`SELECT id FROM boards WHERE id = ${id}`)
            : this.db.get(sql`SELECT id FROM board_objects WHERE id = ${id}`)
    if (!row) throw new Error('That item no longer exists.')
    if (!['asset', 'entry', 'object', 'board'].includes(type)) {
      throw new Error('That item cannot be tagged.')
    }
  }

  private liveReusable(normalized: string): TagRow | undefined {
    return this.db.get<TagRow>(sql`
      SELECT ${this.tagColumns} FROM tags t
      WHERE t.reusable = 1 AND t.deleted_at IS NULL AND t.normalized_name = ${normalized}
    `)
  }

  private suggestRestoreName(name: string): string {
    const base = `${name} (restored)`
    let candidate = base
    let n = 2
    while (this.liveReusable(tagNameParts(candidate).normalized)) {
      candidate = `${base} ${n}`
      n += 1
    }
    return candidate
  }

  private require(id: string): TagRecord {
    const row = this.db.get<TagRow>(sql`SELECT ${this.tagColumns} FROM tags t WHERE t.id = ${id}`)
    if (!row) throw new Error('That tag no longer exists.')
    return toRecord(row)
  }

  private idsIn(ids: string[]): { id: string }[] {
    return this.db.all<{ id: string }>(sql`
      SELECT id FROM taggings WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    `)
  }

  private deleteIds(ids: string[]): void {
    this.db.run(sql`
      DELETE FROM taggings WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    `)
  }

  private readonly tagColumns = sql`
    t.id, t.name, t.color, t.reusable, t.owner_type, t.owner_id, t.archived_at, t.deleted_at,
    (
      SELECT count(*) FROM taggings g WHERE g.tag_id = t.id
    ) + CASE WHEN t.reusable = 0 AND t.deleted_at IS NULL THEN 1 ELSE 0 END AS assignment_count
  `
}

function toRecord(row: TagRow): TagRecord {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    reusable: row.reusable !== 0,
    archived: row.archived_at != null,
    deleted: row.deleted_at != null,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    assignmentCount: row.assignment_count
  }
}

function dedupeTargets(targets: TagTarget[]): TagTarget[] {
  return [...new Map(targets.map((target) => [`${target.type}:${target.id}`, target])).values()]
}

function sameIds(left: string[], right: string[]): boolean {
  const a = [...left].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((id, index) => id === b[index])
}
