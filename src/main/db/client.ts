import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type ProjectDb = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  sqlite: Database.Database
  db: ProjectDb
}

/** Opens (or creates) a project database and brings its schema up to date. */
export function openDatabase(file: string, migrationsFolder: string): OpenedDatabase {
  const sqlite = new Database(file)
  try {
    // WAL keeps the database consistent if the app crashes mid-write (ADR-009).
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('busy_timeout = 5000')
    // Drizzle runs every migration inside one transaction, and SQLite cannot change
    // foreign_keys inside a transaction. Dropping assets.folder_id rebuilds that table,
    // which other tables reference, so constraints are off only while migrating.
    sqlite.pragma('foreign_keys = OFF')
    const db = drizzle(sqlite, { schema })
    try {
      migrate(db, { migrationsFolder })
    } finally {
      sqlite.pragma('foreign_keys = ON')
    }
    return { sqlite, db }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
