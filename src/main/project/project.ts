import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'
import { count, eq, isNull } from 'drizzle-orm'
import type Database from 'better-sqlite3'
import type { ProjectSummary } from '@shared/types'
import { openDatabase, type ProjectDb } from '../db/client'
import { assets, boards, projectMeta } from '../db/schema'

export const PROJECT_EXTENSION = '.cwproj'
export const PROJECT_DB_FILE = 'project.db'
/** Sub-folders of every project (see ADR-005). */
export const PROJECT_SUBDIRS = ['assets', 'thumbs', 'backups'] as const

/**
 * An open project: a `.cwproj` folder on disk plus its SQLite connection.
 * This module must not import `electron`, so it can be unit-tested.
 */
export class Project {
  private constructor(
    readonly path: string,
    private readonly sqlite: Database.Database,
    readonly db: ProjectDb
  ) {}

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
    const now = new Date()
    const mainBoardId = randomUUID()
    db.transaction((tx) => {
      tx.insert(boards)
        .values({ id: mainBoardId, title: cleanName, createdAt: now, updatedAt: now })
        .run()
      tx.insert(projectMeta)
        .values({ id: randomUUID(), name: cleanName, mainBoardId, createdAt: now, updatedAt: now })
        .run()
    })
    return new Project(path, sqlite, db)
  }

  static open(path: string, migrationsFolder: string): Project {
    const dbFile = join(path, PROJECT_DB_FILE)
    if (!existsSync(dbFile)) {
      throw new Error(`Not a Creative Workspace project (missing ${PROJECT_DB_FILE}): ${path}`)
    }
    // Recreate any missing sub-folders, e.g. if a sync tool skipped empty folders.
    for (const dir of PROJECT_SUBDIRS) mkdirSync(join(path, dir), { recursive: true })

    const { sqlite, db } = openDatabase(dbFile, migrationsFolder)
    const project = new Project(path, sqlite, db)
    try {
      project.summary()
    } catch (error) {
      project.close()
      throw error
    }
    return project
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

  /** Renames the project in its metadata. The folder on disk keeps its name. */
  rename(name: string): ProjectSummary {
    const trimmed = name.trim()
    if (!trimmed) throw new Error('Project name cannot be empty.')
    const meta = this.db.select({ id: projectMeta.id }).from(projectMeta).get()!
    this.db
      .update(projectMeta)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(eq(projectMeta.id, meta.id))
      .run()
    return this.summary()
  }

  close(): void {
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
