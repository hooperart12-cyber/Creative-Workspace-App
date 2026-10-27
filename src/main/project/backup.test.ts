import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyRetention,
  chooseKept,
  createRecoveryPoint,
  DEFAULT_RETENTION,
  deleteRecoveryPoint,
  dueForAutomatic,
  listManifests,
  verifyPoint,
  type RecoveryManifest
} from './backup'
import { assessDraft, takeDrafts, writeDraft } from './journal'
import { exportProjectZip, importProjectZip } from './projectZip'
import { Project } from './project'
import { restoreProject } from './restore'
import Database from 'better-sqlite3'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-backup-'))
  project = Project.create(dir, 'Backup', migrations)
})
afterEach(() => {
  try {
    project?.close()
  } catch {
    // A test may already have closed the project.
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 40)
    }
  }
})

const vault = () => join(dir, 'vault')
const file = (name: string, contents: string) => {
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

async function point(
  kind: 'baseline' | 'hourly' | 'manual' | 'premigration' = 'baseline',
  now?: number
) {
  return createRecoveryPoint({
    sqlite: project.connection,
    projectPath: project.path,
    projectId: project.id,
    projectName: project.summary().name,
    vaultRoot: vault(),
    kind,
    now
  })
}

describe('change revision', () => {
  it('increases when a stored file is removed', async () => {
    const before = project.changeRevision()
    const imported = await project.assets.importFiles([file('a.txt', 'alpha')])
    expect(project.changeRevision()).toBeGreaterThan(before ?? 0)
    project.connection
      .prepare('DELETE FROM library_entries WHERE asset_id = ?')
      .run(imported.imported[0].id)
    project.connection.prepare('DELETE FROM assets WHERE id = ?').run(imported.imported[0].id)
    expect(project.changeRevision()).toBeGreaterThan(before ?? 0)
    const afterDelete = project.changeRevision()
    expect(afterDelete).not.toBe(before)
  })
})

describe('recovery points', () => {
  it('stores a file once and can restore it after the live copy is gone', async () => {
    const imported = await project.assets.importFiles([file('page.txt', 'keep-me')])
    const asset = imported.imported[0]
    const first = await point('baseline', 1_000)
    const second = await point('hourly', 2_000)
    expect(second.assets).toEqual(first.assets)
    const blob = join(vault(), 'blobs', asset.sha256)
    expect(existsSync(blob)).toBe(true)
    expect(statSync(blob).size).toBe(asset.bytes)

    const entryId = imported.entryIds[0]
    project.library.trash([entryId])
    const purged = project.library.purge({ entries: [entryId], folders: [], objects: [] })
    expect(purged.removedFiles).toEqual([{ sha256: asset.sha256, ext: asset.ext }])
    await project.assets.deleteStoredFiles(asset.sha256, asset.ext)
    expect(existsSync(project.assets.originalPath(asset.sha256, asset.ext))).toBe(false)
    expect(existsSync(blob)).toBe(true)

    const restored = await restoreProject({
      vaultRoot: vault(),
      manifest: first,
      parentDir: dir,
      name: 'Restored',
      migrationsFolder: migrations
    })
    expect(restored.projectId).not.toBe(project.id)
    const copy = await Project.open(restored.path, migrations)
    const text = project.connection
    expect(copy.assets.originalPath(asset.sha256, asset.ext)).not.toBe('')
    const { readFileSync } = await import('node:fs')
    expect(readFileSync(copy.assets.originalPath(asset.sha256, asset.ext), 'utf8')).toBe('keep-me')
    expect(existsSync(project.assets.originalPath(asset.sha256, asset.ext))).toBe(false)
    copy.close()
    void text
  })

  it('does not keep a point when copying a file fails', async () => {
    await project.assets.importFiles([file('a.txt', 'alpha')])
    await expect(
      createRecoveryPoint({
        sqlite: project.connection,
        projectPath: project.path,
        projectId: project.id,
        projectName: 'Backup',
        vaultRoot: vault(),
        kind: 'hourly',
        copy: async () => {
          const error = new Error('disk full') as NodeJS.ErrnoException
          error.code = 'ENOSPC'
          throw error
        }
      })
    ).rejects.toThrow(/disk full/)
    expect(await listManifests(vault())).toEqual([])
    expect(existsSync(join(vault(), 'staging'))).toBe(false)
  })

  it('rejects a recovery point when a reused blob is the wrong size', async () => {
    await project.assets.importFiles([file('a.txt', 'alpha')])
    const first = await point()
    writeFileSync(join(vault(), 'blobs', first.assets[0].sha256), 'nope')
    await expect(point('hourly')).rejects.toThrow(/wrong size/)
    expect(await listManifests(vault())).toHaveLength(1)
  })

  it('checks every blob before restore and reports a bad checksum', async () => {
    await project.assets.importFiles([file('a.txt', 'alpha')])
    const made = await point()
    const full = await verifyPoint(vault(), made.id, 'checksum')
    expect(full.ok).toBe(true)
    writeFileSync(join(vault(), 'blobs', made.assets[0].sha256), 'alphb')
    const again = await verifyPoint(vault(), made.id, 'checksum')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.errors.join(' ')).toMatch(/checksum/)
  })

  it('keeps protected points and drops extra automatic ones without removing a shared blob', async () => {
    await project.assets.importFiles([file('a.txt', 'alpha')])
    const hour = 60 * 60 * 1000
    const points = []
    for (let index = 0; index < 14; index++) points.push(await point('hourly', index * hour))
    const manual = await point('manual', 14 * hour)
    const premigration = await point('premigration', 15 * hour)
    const removed = await applyRetention(
      vault(),
      { ...DEFAULT_RETENTION, daily: 0, weekly: 0, monthly: 0 },
      20 * hour
    )
    const left = await listManifests(vault())
    expect(left.some((item) => item.id === manual.id)).toBe(true)
    expect(left.some((item) => item.id === premigration.id)).toBe(true)
    expect(left.filter((item) => item.kind === 'hourly').length).toBe(12)
    expect(removed.length).toBe(2)
    expect(existsSync(join(vault(), 'blobs', points[0].assets[0].sha256))).toBe(true)
    await deleteRecoveryPoint(vault(), manual.id)
    expect(existsSync(join(vault(), 'blobs', points[0].assets[0].sha256))).toBe(true)
  })

  it('refuses to migrate an older project when the recovery point cannot be written', async () => {
    project.close()
    const oldMigrations = join(dir, 'migrations-0003')
    const { cpSync, readFileSync } = await import('node:fs')
    cpSync(migrations, oldMigrations, { recursive: true })
    const journalPath = join(oldMigrations, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter(
      (entry) => entry.tag !== '0004_reliability' && entry.tag !== '0005_tags'
    )
    writeFileSync(journalPath, JSON.stringify(journal))
    const legacy = Project.create(dir, 'Legacy', oldMigrations)
    const legacyPath = legacy.path
    legacy.close()
    writeFileSync(join(dir, 'blocked'), 'not a folder')
    await expect(
      Project.open(legacyPath, migrations, { vaultFor: () => join(dir, 'blocked', 'vault') })
    ).rejects.toThrow()
    const sqlite = new Database(join(legacyPath, 'project.db'), { readonly: true })
    const table = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE name = 'project_state'")
      .get()
    sqlite.close()
    expect(table).toBeUndefined()
    project = await Project.open(legacyPath, migrations, { vaultFor: () => join(dir, 'vault') })
    expect(project.changeRevision()).toBe(0)
    const saved = await listManifests(join(dir, 'vault'))
    expect(saved.some((item) => item.kind === 'premigration' && item.protected)).toBe(true)
  })
})

describe('backup schedule', () => {
  it('waits an hour and skips a project that has not changed', () => {
    expect(dueForAutomatic({ now: 0, revision: 3, lastAutomatic: null })).toBe(true)
    expect(
      dueForAutomatic({
        now: 10,
        revision: 3,
        lastAutomatic: { createdAt: 0, changeRevision: 3 }
      })
    ).toBe(false)
    expect(
      dueForAutomatic({
        now: 60 * 60 * 1000,
        revision: 3,
        lastAutomatic: { createdAt: 0, changeRevision: 3 }
      })
    ).toBe(false)
    expect(
      dueForAutomatic({
        now: 60 * 60 * 1000,
        revision: 4,
        lastAutomatic: { createdAt: 0, changeRevision: 3 }
      })
    ).toBe(true)
  })
})

describe('retention selection', () => {
  it('lets one point satisfy only the categories that still need it', () => {
    const manifests = [0, 1, 2].map(
      (index) =>
        ({
          formatVersion: 1,
          id: `p${index}`,
          projectId: 'p',
          projectName: 'P',
          createdAt: Date.UTC(2026, 0, 10 + index),
          kind: 'hourly',
          protected: false,
          changeRevision: index,
          assets: [],
          database: { sha256: 'a', bytes: 1 }
        }) satisfies RecoveryManifest
    )
    const kept = chooseKept(
      manifests,
      { hourly: 1, daily: 7, weekly: 4, monthly: 3 },
      Date.UTC(2026, 0, 12)
    )
    expect(kept.has('p2')).toBe(true)
    expect(kept.has('p1')).toBe(true)
    expect(kept.has('p0')).toBe(true)
  })
})

describe('project zip', () => {
  it('round-trips a project without the backup vault', async () => {
    await project.assets.importFiles([file('chapter.txt', 'chapter')])
    const destination = join(dir, 'export.zip')
    await exportProjectZip({
      sqlite: project.connection,
      projectPath: project.path,
      destination
    })
    const imported = await importProjectZip({
      zipPath: destination,
      parentDir: dir,
      name: 'Imported',
      migrationsFolder: migrations
    })
    const copy = await Project.open(imported, migrations)
    expect(copy.id).not.toBe(project.id)
    expect(copy.library.list({ folderId: null, scope: 'project' }).total).toBe(1)
    copy.close()
  })
})

describe('recovery journal', () => {
  it('keeps a draft that differs from a newer saved note', () => {
    const content = { schemaVersion: 1 as const, doc: { type: 'doc', content: [] } }
    writeDraft(project.path, {
      objectId: 'note-1',
      baseRevision: 1,
      content,
      plainText: 'draft words',
      writtenAt: 1
    })
    const pending = takeDrafts(project.path, () => ({
      revision: 4,
      contentJson: JSON.stringify({
        schemaVersion: 1,
        doc: { type: 'doc', content: [{ type: 'paragraph' }] }
      })
    }))
    expect(pending).toHaveLength(1)
    expect(pending[0]?.assessment.kind).toBe('conflict')
    expect(
      assessDraft(pending[0].draft, { revision: 1, contentJson: JSON.stringify(content) }).kind
    ).toBe('redundant')
    const hashed = createHash('sha256').update('draft words').digest('hex')
    expect(hashed).toHaveLength(64)
  })
})
