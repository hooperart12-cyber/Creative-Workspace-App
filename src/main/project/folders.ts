import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { FolderListItem } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { deletionTime } from './boards'
import { folders } from '../db/schema'

export const DEFAULT_FOLDER_NAME = 'New folder'

/** Library folders (§8, ADR-011). They exist only in the database; files on disk never move. */
export class FolderRepository {
  constructor(private readonly db: ProjectDb) {}

  list(): FolderListItem[] {
    return this.db
      .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
      .from(folders)
      .where(isNull(folders.deletedAt))
      .orderBy(asc(folders.name))
      .all()
  }

  create(parentId: string | null, name?: string): FolderListItem {
    if (parentId) this.require(parentId)
    const id = randomUUID()
    const cleanName = name?.trim() || DEFAULT_FOLDER_NAME
    const now = new Date()
    this.db
      .insert(folders)
      .values({ id, parentId, name: cleanName, createdAt: now, updatedAt: now })
      .run()
    return { id, name: cleanName, parentId }
  }

  rename(id: string, name: string): void {
    this.require(id)
    const clean = name.trim()
    if (!clean) throw new Error('Folder name cannot be empty.')
    this.db
      .update(folders)
      .set({ name: clean, updatedAt: new Date() })
      .where(eq(folders.id, id))
      .run()
  }

  /** Moves a folder under another folder, or to the library root when `newParentId` is null. */
  move(id: string, newParentId: string | null): void {
    this.require(id)
    if (newParentId) {
      this.require(newParentId)
      if (newParentId === id || this.isDescendant(newParentId, id)) {
        throw new Error('A folder cannot be moved inside itself.')
      }
    }
    this.db
      .update(folders)
      .set({ parentId: newParentId, updatedAt: new Date() })
      .where(eq(folders.id, id))
      .run()
  }

  /** Moves a folder and its sub-folders to the trash (soft delete). */
  delete(id: string): { deletedFolderIds: string[] } {
    this.require(id)
    const ids = [id, ...this.descendantIds(id)]
    const now = deletionTime()
    this.db
      .update(folders)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(folders.id, ids))
      .run()
    return { deletedFolderIds: ids }
  }

  private find(id: string) {
    return this.db
      .select({ id: folders.id, parentId: folders.parentId })
      .from(folders)
      .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
      .get()
  }

  private require(id: string) {
    const folder = this.find(id)
    if (!folder) throw new Error('Folder not found. It may have been deleted.')
    return folder
  }

  private isDescendant(id: string, ancestorId: string): boolean {
    let cursor = this.find(id)?.parentId ?? null
    while (cursor) {
      if (cursor === ancestorId) return true
      cursor = this.find(cursor)?.parentId ?? null
    }
    return false
  }

  private descendantIds(id: string): string[] {
    const result: string[] = []
    let frontier = [id]
    while (frontier.length) {
      const children = this.db
        .select({ id: folders.id })
        .from(folders)
        .where(and(inArray(folders.parentId, frontier), isNull(folders.deletedAt)))
        .all()
        .map((row) => row.id)
      result.push(...children)
      frontier = children
    }
    return result
  }
}
