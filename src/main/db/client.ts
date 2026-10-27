import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema'

export type ProjectDb = BetterSQLite3Database<typeof schema>

export interface OpenedDatabase {
  sqlite: Database.Database
  db: ProjectDb
}

/** Opens a database without migrating it. Used so a recovery point can be taken first. */
export function openRawDatabase(file: string): Database.Database {
  const sqlite = new Database(file)
  // WAL keeps the database consistent if the app crashes mid-write (ADR-009).
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  return sqlite
}

/** Brings an open database up to the shipped schema. */
export function migrateDatabase(sqlite: Database.Database, migrationsFolder: string): void {
  // Drizzle runs every migration inside one transaction, and SQLite cannot change
  // foreign_keys inside a transaction. Rebuilding a referenced table needs them off
  // only while migrating.
  sqlite.pragma('foreign_keys = OFF')
  try {
    migrate(drizzle(sqlite, { schema }), { migrationsFolder })
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
}

export function wrapDatabase(sqlite: Database.Database): ProjectDb {
  return drizzle(sqlite, { schema })
}

/** Opens (or creates) a project database and brings its schema up to date. */
export function openDatabase(file: string, migrationsFolder: string): OpenedDatabase {
  const sqlite = openRawDatabase(file)
  try {
    migrateDatabase(sqlite, migrationsFolder)
    return { sqlite, db: wrapDatabase(sqlite) }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
