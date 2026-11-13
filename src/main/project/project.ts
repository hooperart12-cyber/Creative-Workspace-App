import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { count, eq, isNull } from 'drizzle-orm'
import type Database from 'better-sqlite3'
import type { ProjectSummary } from '@shared/types'
import {
  migrateDatabase,
  openDatabase,
  openRawDatabase,
  wrapDatabase,
  type ProjectDb
} from '../db/client'
import { assets, boards, projectMeta } from '../db/schema'
import { AssetRepository } from './assets'
import { createRecoveryPoint } from './backup'
import { BoardRepository } from './boards'
import { FolderRepository } from './folders'
import { LibraryRepository } from './library'
import { NoteRepository } from './notes'
import { ObjectRepository } from './objects'
import { pendingMigrationTags, readChangeRevision, readProjectIdentity } from './schemaInfo'
import { CollectionRepository } from './collections'
import { RelationRepository } from './relations'
import { SearchRepository } from './search'
import { StackRepository } from './stacks'
import { TagRepository } from './tags'

export const PROJECT_EXTENSION = '.cwproj'
export const PROJECT_DB_FILE = 'project.db'
/** Sub-folders of every project (see ADR-005). */
export const PROJECT_SUBDIRS = ['assets', 'thumbs', 'backups'] as const

/**
 * An open project: a `.cwproj` folder on disk plus its SQLite connection.
 * This module must not import `electron`, so it can be unit-tested.
 */
export class Project {
  /** The project's UUID (also used in asset URLs). */
  readonly id: string
  readonly mainBoardId: string
  readonly boards: BoardRepository
  readonly folders: FolderRepository
  readonly library: LibraryRepository
  readonly objects: ObjectRepository
  readonly notes: NoteRepository
  readonly assets: AssetRepository
  readonly search: SearchRepository
  readonly tags: TagRepository
  readonly stacks: StackRepository
  readonly relations: RelationRepository
  readonly collections: CollectionRepository

  private constructor(
    readonly path: string,
    private readonly sqlite: Database.Database,
    readonly db: ProjectDb
  ) {
    const meta = db
      .select({ id: projectMeta.id, mainBoardId: projectMeta.mainBoardId })
      .from(projectMeta)
      .get()
    if (!meta) throw new Error(`Project database is missing its metadata: ${path}`)
    this.id = meta.id
    this.mainBoardId = meta.mainBoardId
    this.boards = new BoardRepository(db, meta.mainBoardId)
    this.folders = new FolderRepository(db)
    this.library = new LibraryRepository(db)
    this.objects = new ObjectRepository(db, this.boards)
    this.notes = new NoteRepository(db, this.boards)
    this.assets = new AssetRepository(db, path)
    this.search = new SearchRepository(db)
    this.tags = new TagRepository(db)
    this.stacks = new StackRepository(db, this.boards)
    this.relations = new RelationRepository(db, this.boards)
    this.collections = new CollectionRepository(db)
    this.stacks.normalizeDisplayed()
  }

  /** The open connection, for snapshots and recovery points. */
  get connection(): Database.Database {
    return this.sqlite
  }

  changeRevision(): number | null {
    return readChangeRevision(this.sqlite)
  }

  static create(parentDir: string, name: string, migrationsFolder: string): Project {
    const cleanName = sanitizeProjectName(name)
    if (!existsSync(parentDir) || !statSync(parentDir).isDirectory()) {
      throw new Error(`Folder does not exist: ${parentDir}`)
    }
    const path = join(parentDir, cleanName + PROJECT_EXTENSION)
    if (existsSync(path)) {
      throw new Error(`A project named "${cleanName}" already exists in this folder.`)
    }

    mkdirSync(path)
    for (const dir of PROJECT_SUBDIRS) mkdirSync(join(path, dir))

    const { sqlite, db } = openDatabase(join(path, PROJECT_DB_FILE), migrationsFolder)
    const now = Date.now()
    const mainBoardId = randomUUID()
    // Named columns only. Later columns have defaults, and an older database opened by a
    // migration test does not have them yet.
    sqlite
      .prepare(`INSERT INTO boards (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
      .run(mainBoardId, cleanName, now, now)
    sqlite
      .prepare(
        `INSERT INTO project_meta (id, name, main_board_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
      )
      .run(randomUUID(), cleanName, mainBoardId, now, now)
    return new Project(path, sqlite, db)
  }

  static async open(
    path: string,
    migrationsFolder: string,
    options?: { vaultFor?: (projectId: string) => string }
  ): Promise<Project> {
    const dbFile = join(path, PROJECT_DB_FILE)
    if (!existsSync(dbFile)) {
      throw new Error(`Not a Creative Workspace project (missing ${PROJECT_DB_FILE}): ${path}`)
    }
    // Recreate any missing sub-folders, e.g. if a sync tool skipped empty folders.
    for (const dir of PROJECT_SUBDIRS) mkdirSync(join(path, dir), { recursive: true })

    const sqlite = openRawDatabase(dbFile)
    try {
      const sessionFile = join(path, 'recovery', 'session')
      if (existsSync(sessionFile)) {
        const check = sqlite.prepare('PRAGMA integrity_check').get() as { integrity_check: string }
        if (check.integrity_check !== 'ok') {
          throw new Error(
            'This project’s database did not pass its integrity check. Restore a recovery point. The project was not changed.'
          )
        }
      }
      const pending = pendingMigrationTags(sqlite, migrationsFolder)
      if (pending.length) {
        const identity = readProjectIdentity(sqlite)
        const vaultRoot = options?.vaultFor?.(identity.id)
        if (!vaultRoot) {
          throw new Error(
            'This project needs a recovery point before its data can be updated, and no backup location is available.'
          )
        }
        await createRecoveryPoint({
          sqlite,
          projectPath: path,
          projectId: identity.id,
          projectName: identity.name,
          vaultRoot,
          kind: 'premigration'
        })
      }
      migrateDatabase(sqlite, migrationsFolder)
      mkdirSync(join(path, 'recovery'), { recursive: true })
      writeFileSync(join(path, 'recovery', 'session'), String(Date.now()))
      return new Project(path, sqlite, wrapDatabase(sqlite))
    } catch (error) {
      sqlite.close()
      throw error
    }
  }

  summary(): ProjectSummary {
    const meta = this.db.select().from(projectMeta).get()
    if (!meta) throw new Error(`Project database is missing its metadata: ${this.path}`)
    const boardCount = this.db
      .select({ n: count() })
      .from(boards)
      .where(isNull(boards.deletedAt))
      .get()!.n
    const assetCount = this.db
      .select({ n: count() })
      .from(assets)
      .where(isNull(assets.deletedAt))
      .get()!.n
    return {
      id: meta.id,
      name: meta.name,
      path: this.path,
      mainBoardId: meta.mainBoardId,
      boardCount,
      assetCount,
      createdAt: meta.createdAt.getTime(),
      updatedAt: meta.updatedAt.getTime()
    }
  }

  /**
   * Renames the project in its metadata; the main board's title follows it.
   * The folder on disk keeps its name.
   */
  rename(name: string): ProjectSummary {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Project name cannot be empty.')
    const meta = this.db.select({ id: projectMeta.id }).from(projectMeta).get()!
    const now = new Date()
    this.db.transaction((tx) => {
      tx.update(projectMeta)
        .set({ name: trimmed, updatedAt: now })
        .where(eq(projectMeta.id, meta.id))
        .run()
      tx.update(boards)
        .set({ title: trimmed, updatedAt: now })
        .where(eq(boards.id, this.mainBoardId))
        .run()
    })
    return this.summary()
  }

  close(): void {
    rmSync(join(this.path, 'recovery', 'session'), { force: true })
    if (this.sqlite.open) this.sqlite.close()
  }

  get folderName(): string {
    return basename(this.path)
  }
}

/** Makes a project name safe to use as a folder name on Windows and macOS. */
export function sanitizeProjectName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/[. ]+$/, '')
    .trim()
  if (!cleaned) throw new Error('Please enter a project name.')
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(cleaned)) {
    throw new Error(`"${cleaned}" is a reserved name on Windows. Please choose another.`)
  }
  return cleaned
}
