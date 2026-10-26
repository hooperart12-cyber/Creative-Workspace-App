import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

interface JournalEntry {
  tag: string
  when: number
}

/** Migrations in the shipped journal that this database has not applied yet. */
export function pendingMigrationTags(
  sqlite: Database.Database,
  migrationsFolder: string
): string[] {
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as {
    entries: JournalEntry[]
  }
  const table = sqlite
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
    )
    .get()
  let last = -1
  if (table) {
    const row = sqlite
      .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
      .get() as { created_at: number } | undefined
    if (row) last = Number(row.created_at)
  }
  return journal.entries.filter((entry) => entry.when > last).map((entry) => entry.tag)
}

export function readProjectIdentity(sqlite: Database.Database): { id: string; name: string } {
  const row = sqlite.prepare('SELECT id, name FROM project_meta LIMIT 1').get() as
    { id: string; name: string } | undefined
  if (!row) throw new Error('Project database is missing its metadata.')
  return row
}

/** Null when this database was created before the change counter existed. */
export function readChangeRevision(sqlite: Database.Database): number | null {
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'project_state'")
    .get()
  if (!table) return null
  const row = sqlite
    .prepare('SELECT change_revision AS revision FROM project_state WHERE id = 1')
    .get() as { revision: number } | undefined
  return row ? Number(row.revision) : null
}
