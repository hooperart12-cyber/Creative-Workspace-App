import { randomUUID } from 'node:crypto'
import { and, eq, isNull } from 'drizzle-orm'
import type { ProjectDb } from '../db/client'
import { folders, libraryEntries } from '../db/schema'

/** Inserts a library entry. The stored original is not copied. */
export function insertEntry(
  db: ProjectDb,
  input: { assetId: string; name: string; folderId: string | null }
): string {
  if (input.folderId) {
    const folder = db
      .select({ id: folders.id })
      .from(folders)
      .where(and(eq(folders.id, input.folderId), isNull(folders.deletedAt)))
      .get()
    if (!folder) throw new Error('That folder is not in the library.')
  }
  const id = randomUUID()
  const now = new Date()
  const name = input.name.trim() || 'File'
  db.insert(libraryEntries)
    .values({
      id,
      assetId: input.assetId,
      folderId: input.folderId,
      name,
      createdAt: now,
      updatedAt: now
    })
    .run()
  return id
}

/** Returns an active entry for this original, creating one only when every entry is gone or trashed. */
export function ensureActiveEntry(
  db: ProjectDb,
  input: { assetId: string; name: string; folderId: string | null }
): string {
  const existing = db
    .select({ id: libraryEntries.id })
    .from(libraryEntries)
    .where(and(eq(libraryEntries.assetId, input.assetId), isNull(libraryEntries.deletedAt)))
    .get()
  if (existing) return existing.id
  return insertEntry(db, input)
}
