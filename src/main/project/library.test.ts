import { createHash, randomUUID } from 'node:crypto'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assets, boardObjects, libraryEntries } from '../db/schema'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-library-'))
  project = Project.create(dir, 'Library', migrations)
})
afterEach(() => {
  try {
    project?.close()
  } catch {
    // The migration test closes the first project itself.
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

const query = { folderId: null as string | null, scope: 'folder' as const, direct: true }

function writeFile(name: string, contents: string): string {
  const path = join(dir, name)
  writeFileSync(path, contents)
  return path
}

describe('library entries', () => {
  it('stores one original and one entry, and does not put the file on a board', async () => {
    const path = writeFile('notes.txt', 'hello library')
    const result = await project.assets.importFiles([path], { duplicates: 'skip' })
    expect(result.imported).toHaveLength(1)
    expect(result.entryIds).toHaveLength(1)
    expect(project.db.select().from(assets).all()).toHaveLength(1)
    expect(project.library.list({ ...query, scope: 'project' }).total).toBe(1)
    expect(project.db.select().from(boardObjects).all()).toHaveLength(0)
    const stored = project.assets.originalPath(result.imported[0].sha256, result.imported[0].ext)
    expect(readFileSync(stored, 'utf8')).toBe('hello library')
    expect(readFileSync(path, 'utf8')).toBe('hello library')
  })

  it('skips a duplicate or adds another entry without copying the file', async () => {
    const path = writeFile('a.txt', 'same-bytes')
    const copy = writeFile('b.txt', 'same-bytes')
    const first = await project.assets.importFiles([path], { duplicates: 'skip' })
    const skipped = await project.assets.importFiles([copy], { duplicates: 'skip' })
    expect(skipped.imported).toHaveLength(0)
    expect(skipped.skipped[0]?.reason).toBe('Already in the library.')
    expect(skipped.entryIds).toEqual([])
    const extra = await project.assets.importFiles([copy], { duplicates: 'entry', folderId: null })
    expect(extra.entryIds).toHaveLength(1)
    expect(extra.imported[0].id).toBe(first.imported[0].id)
    expect(project.db.select().from(assets).all()).toHaveLength(1)
    const page = project.library.list({ ...query, scope: 'project' })
    expect(page.total).toBe(2)
    expect(new Set(page.entries.map((entry) => entry.name))).toEqual(new Set(['a.txt', 'b.txt']))
  })

  it('stores a second original when the name matches and the bytes do not', async () => {
    await project.assets.importFiles([writeFile('note.txt', 'one')], { duplicates: 'skip' })
    await project.assets.importFiles([writeFile('note.txt', 'two')], { duplicates: 'skip' })
    expect(project.db.select().from(assets).all()).toHaveLength(2)
    expect(project.library.list({ ...query, scope: 'project' }).entries.map((e) => e.name)).toEqual(
      ['note.txt', 'note.txt']
    )
  })

  it('renames and moves an entry without moving the file or board appearances', async () => {
    const imported = await project.assets.importFile(writeFile('shot.png.txt', 'not-an-image'))
    const folder = project.folders.create(null, 'Refs')
    const entry = project.library.list(query).entries[0]
    const objectId = project.objects.createFromAssets({
      boardId: project.mainBoardId,
      assetIds: [imported.id],
      center: { x: 10, y: 10 }
    })[0]
    const previous = project.library.rename(entry.id, 'Hero')
    expect(previous).toBe(entry.name)
    project.library.move([entry.id], folder.id)
    const moved = project.library.details(entry.id).entry
    expect(moved.name).toBe('Hero')
    expect(moved.folderPath).toBe('Refs')
    expect(project.assets.get(imported.id).originalName).toBe(imported.originalName)
    const object = project.objects.read(objectId)
    expect(object?.assetId).toBe(imported.id)
    expect(project.library.details(entry.id).appearances).toEqual([
      expect.objectContaining({ objectId, boardId: project.mainBoardId })
    ])
  })

  it('searches this folder and the whole library without dropping the query', () => {
    const refs = project.folders.create(null, 'Refs')
    const nested = project.folders.create(refs.id, 'Poses')
    project.db
      .insert(libraryEntries)
      .values({
        id: 'e1',
        assetId: seedAsset('aaa'),
        folderId: nested.id,
        name: 'pose-study.txt'
      })
      .run()
    project.db
      .insert(libraryEntries)
      .values({
        id: 'e2',
        assetId: seedAsset('bbb'),
        folderId: null,
        name: 'other-pose.txt'
      })
      .run()
    const inFolder = project.library.list({
      folderId: refs.id,
      scope: 'folder',
      query: 'pose',
      direct: false
    })
    expect(inFolder.ids).toEqual(['e1'])
    const everywhere = project.library.list({
      folderId: refs.id,
      scope: 'project',
      query: 'pose'
    })
    expect(everywhere.ids.sort()).toEqual(['e1', 'e2'])
    expect(
      project.library.list({ ...query, unfiled: true, query: 'pose', scope: 'project' }).ids
    ).toEqual(['e2'])
  })

  it('trashes a folder tree and restores it, including when the parent is gone', () => {
    const parent = project.folders.create(null, 'Parent')
    const child = project.folders.create(parent.id, 'Child')
    project.db
      .insert(libraryEntries)
      .values({
        id: 'inside',
        assetId: seedAsset('ccc'),
        folderId: child.id,
        name: 'inside.txt'
      })
      .run()
    expect(project.folders.delete(parent.id).deletedFolderIds).toHaveLength(2)
    expect(project.library.list({ ...query, scope: 'project' }).total).toBe(0)
    expect(project.library.trashList('entry').map((item) => item.id)).toEqual(['inside'])
    const restored = project.library.restoreFolders([parent.id])
    expect(restored.restoredFolderIds.sort()).toEqual([child.id, parent.id].sort())
    expect(restored.restoredEntryIds).toEqual(['inside'])
    project.folders.delete(parent.id)
    const needs = project.library.restoreFolders([child.id])
    expect(needs.needsDestination).toEqual([child.id])
    const placed = project.library.restoreFolders([child.id], null)
    expect(placed.restoredFolderIds).toContain(child.id)
    expect(project.folders.list().find((folder) => folder.id === child.id)?.parentId).toBeNull()
  })

  it('deletes a folder without its files and suffixes a clashing name only when asked', () => {
    const parent = project.folders.create(null, 'Parent')
    const child = project.folders.create(parent.id, 'Notes')
    project.folders.create(null, 'Notes')
    project.db
      .insert(libraryEntries)
      .values({
        id: 'keep',
        assetId: seedAsset('ddd'),
        folderId: parent.id,
        name: 'keep.txt'
      })
      .run()
    expect(() => project.library.dissolveFolder(parent.id, false)).toThrow(/Notes/)
    const renamed = project.library.dissolveFolder(parent.id, true)
    expect(renamed.renamed.some((line) => line.includes('Notes'))).toBe(true)
    expect(project.folders.list().some((folder) => folder.id === parent.id)).toBe(false)
    expect(project.library.list({ ...query, scope: 'project' }).entries.map((e) => e.id)).toEqual([
      'keep'
    ])
    expect(project.folders.list().some((folder) => folder.id === child.id)).toBe(true)
  })

  it('refuses to remove a file that a board or a trashed entry still uses', async () => {
    const path = writeFile('kept.txt', 'stay')
    const imported = await project.assets.importFile(path)
    const entry = project.library.list(query).entries[0]
    const objectId = project.objects.createFromAssets({
      boardId: project.mainBoardId,
      assetIds: [imported.id],
      center: { x: 0, y: 0 }
    })[0]
    project.library.trash([entry.id])
    const blocked = project.library.purge({ entries: [entry.id], folders: [], objects: [] })
    expect(blocked.filesDeleted).toBe(0)
    expect(blocked.filesKept[0]?.reason).toMatch(/board/i)
    expect(existsSync(project.assets.originalPath(imported.sha256, imported.ext))).toBe(true)
    project.objects.delete([objectId])
    const second = await project.assets.importFiles([path], { duplicates: 'entry' })
    project.library.trash(second.entryIds)
    const still = project.library.purge({ entries: second.entryIds, folders: [], objects: [] })
    expect(still.filesDeleted).toBe(0)
    expect(still.filesKept[0]?.reason).toMatch(/Trash/)
    const gone = project.library.purge({ entries: [], folders: [], objects: [objectId] })
    expect(gone.removedFiles).toEqual([{ sha256: imported.sha256, ext: imported.ext }])
    expect(project.db.select().from(assets).all()).toHaveLength(0)
  })

  it('counts each stored file once when several entries share it', async () => {
    const path = writeFile('once.txt', '12345')
    await project.assets.importFiles([path], { duplicates: 'entry' })
    await project.assets.importFiles([path], { duplicates: 'entry' })
    const report = project.library.storage(0)
    expect(report.originalCount).toBe(1)
    expect(report.entryCount).toBe(2)
    expect(report.originalBytes).toBe(5)
  })

  it('imports a folder, keeps empty directories, and skips links', async () => {
    const root = join(dir, 'drop')
    mkdirSync(join(root, 'nested', 'empty'), { recursive: true })
    writeFileSync(join(root, 'nested', 'a.txt'), 'a')
    writeFileSync(join(root, 'b.txt'), 'b')
    const result = await project.assets.importTree(root, {
      structure: 'preserve',
      duplicates: 'skip',
      folderId: null
    })
    expect(result.imported).toHaveLength(2)
    const names = project.folders
      .list()
      .map((folder) => folder.name)
      .sort()
    expect(names).toEqual(['empty', 'nested'])
    const flat = await project.assets.importTree(root, {
      structure: 'flatten',
      duplicates: 'skip',
      folderId: null
    })
    expect(flat.skipped.map((item) => item.reason)).toContain('Already in the library.')
    expect(project.db.select().from(boardObjects).all()).toHaveLength(0)
  })
})

describe('library migration from M3C', () => {
  it('keeps asset ids, hashes, previews and board references', async () => {
    project.close()
    const oldMigrations = join(dir, 'migrations-0002')
    cpSync(migrations, oldMigrations, { recursive: true })
    const journalPath = join(oldMigrations, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[]
    }
    journal.entries = journal.entries.filter((entry) =>
      ['0000_init', '0001_note_revision', '0002_pdf_page_count'].includes(entry.tag)
    )
    writeFileSync(journalPath, JSON.stringify(journal))
    const legacy = Project.create(dir, 'Legacy', oldMigrations)
    const folder = legacy.folders.create(null, 'Old')
    const assetId = randomUUID()
    const previewId = randomUUID()
    const sha = createHash('sha256').update('original-bytes').digest('hex')
    const previewBody = 'preview-bytes'
    const previewSha = createHash('sha256').update(previewBody).digest('hex')
    const file = join(legacy.path, 'assets', sha.slice(0, 2))
    mkdirSync(file, { recursive: true })
    writeFileSync(join(file, `${sha}.txt`), 'original-bytes')
    const previewFile = join(legacy.path, 'assets', previewSha.slice(0, 2))
    mkdirSync(previewFile, { recursive: true })
    writeFileSync(join(previewFile, `${previewSha}.png`), previewBody)
    const now = Date.now()
    legacy.db.run(sql`
      insert into assets (id, sha256, original_name, mime, ext, bytes, folder_id, created_at, updated_at, deleted_at)
      values (${assetId}, ${sha}, 'scan.txt', 'text/plain', 'txt', 14, ${folder.id}, ${now}, ${now}, ${now})
    `)
    legacy.db.run(sql`
      insert into assets (id, sha256, original_name, mime, ext, bytes, width, height, created_at, updated_at)
      values (${previewId}, ${previewSha}, 'cover.png', 'image/png', 'png', ${previewBody.length}, 8, 8, ${now}, ${now})
    `)
    legacy.db.run(sql`update assets set preview_asset_id = ${previewId} where id = ${assetId}`)
    legacy.db.run(sql`
      insert into board_objects (id, board_id, type, asset_id, data)
      values (${randomUUID()}, ${legacy.mainBoardId}, 'file', ${assetId}, '{}')
    `)
    legacy.db.run(
      sql`update boards set cover_asset_id = ${previewId} where id = ${legacy.mainBoardId}`
    )
    const legacyPath = legacy.path
    legacy.close()

    project = await Project.open(legacyPath, migrations, {
      vaultFor: () => join(dir, 'premigration-vault')
    })
    const asset = project.db.select().from(assets).where(eq(assets.id, assetId)).get()
    expect(asset?.sha256).toBe(sha)
    expect(asset?.previewAssetId).toBe(previewId)
    expect(asset?.deletedAt).toBeNull()
    const fields = project.db.all<{ name: string }>(
      sql`select name from pragma_table_info('assets')`
    )
    expect(fields.map((field) => field.name)).not.toContain('folder_id')
    const entry = project.db
      .select()
      .from(libraryEntries)
      .where(eq(libraryEntries.assetId, assetId))
      .get()
    expect(entry?.folderId).toBe(folder.id)
    expect(entry?.name).toBe('scan.txt')
    expect(entry?.deletedAt).not.toBeNull()
    expect(project.db.select().from(libraryEntries).all()).toHaveLength(2)
    expect(
      project.boards.get(project.mainBoardId).objects.some((object) => object.assetId === assetId)
    ).toBe(true)
    expect(existsSync(join(project.path, 'assets', sha.slice(0, 2), `${sha}.txt`))).toBe(true)
  })
})

function seedAsset(label: string): string {
  const id = `asset-${label}`
  project.db
    .insert(assets)
    .values({
      id,
      sha256: createHash('sha256').update(label).digest('hex'),
      originalName: `${label}.txt`,
      mime: 'text/plain',
      ext: 'txt',
      bytes: label.length
    })
    .run()
  return id
}
