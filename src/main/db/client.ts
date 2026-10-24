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
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('busy_timeout = 5000')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder })
    return { sqlite, db }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
