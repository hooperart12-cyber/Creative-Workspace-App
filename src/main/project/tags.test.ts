import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { migrateDatabase, openRawDatabase } from '../db/client'
import { buildPdf } from './buildPdf'
import { Project, PROJECT_DB_FILE, PROJECT_EXTENSION, PROJECT_SUBDIRS } from './project'
import { TAG_UNDO_REFUSED } from './tags'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-tags-'))
  project = Project.create(dir, 'Tags', migrations)
})
afterEach(() => {
  try {
    project?.close()
  } catch {
    // A migration test may have closed it.
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // Windows can keep the database file locked for a moment after close.
    }
  }
})

describe('tag migration', () => {
  it('keeps an M5 tag and assignment, and refuses a row it cannot represent', async () => {
    project.close()
    const oldMigrations = join(dir, 'm5')
    cpSync(migrations, oldMigrations, { recursive: true })
    const journalPath = join(oldMigrations, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as {
      entries: { tag: string }[]
    }
    journal.entries = journal.entries.filter((entry) => entry.tag !== '0005_tags')
    writeFileSync(journalPath, JSON.stringify(journal))

    const now = Date.now()
    const kept = createLegacyProject(dir, 'Kept', oldMigrations)
    kept.sqlite
      .prepare(
        `INSERT INTO tags (id, name, color, reusable, created_at, updated_at, deleted_at)
         VALUES (?, ?, NULL, 1, ?, ?, NULL)`
      )
      .run('tag-kept', '  Hero  ', now, now)
    kept.sqlite
      .prepare(
        `INSERT INTO taggings (tag_id, target_type, target_id, created_at) VALUES (?, 'board', ?, ?)`
      )
      .run('tag-kept', kept.mainBoardId, now)
    kept.sqlite.close()

    const blocked = createLegacyProject(dir, 'Blocked', oldMigrations)
    blocked.sqlite
      .prepare(
        `INSERT INTO tags (id, name, color, reusable, created_at, updated_at, deleted_at)
         VALUES (?, ?, NULL, 1, ?, ?, NULL)`
      )
      .run('tag-bad', 'Page', now, now)
    blocked.sqlite
      .prepare(
        `INSERT INTO taggings (tag_id, target_type, target_id, created_at) VALUES (?, 'page', ?, ?)`
      )
      .run('tag-bad', 'page-1', now)
    const blockedPath = blocked.path
    const blockedFile = join(blocked.path, PROJECT_DB_FILE)
    blocked.sqlite.close()

    const vault = join(dir, 'vault')
    mkdirSync(vault)
    const opened = await Project.open(kept.path, migrations, { vaultFor: () => vault })
    const tag = opened.connection
      .prepare('SELECT name, normalized_name FROM tags WHERE id = ?')
      .get('tag-kept') as {
      name: string
      normalized_name: string
    }
    expect(tag).toEqual({ name: 'Hero', normalized_name: 'hero' })
    const assignment = opened.connection
      .prepare('SELECT target_type, target_id FROM taggings WHERE tag_id = ?')
      .get('tag-kept') as { target_type: string; target_id: string }
    expect(assignment).toEqual({ target_type: 'board', target_id: opened.mainBoardId })
    opened.close()

    await expect(Project.open(blockedPath, migrations, { vaultFor: () => vault })).rejects.toThrow()
    const sqlite = new Database(blockedFile)
    const surviving = sqlite.prepare('SELECT target_type FROM taggings').get() as {
      target_type: string
    }
    expect(surviving.target_type).toBe('page')
    sqlite.close()
  })
})

describe('tags', () => {
  it('keeps asset, entry, appearance, and board-card tags independent', async () => {
    const path = join(dir, 'card.txt')
    writeFileSync(path, 'card')
    const imported = await project.assets.importFiles([path])
    const assetId = imported.imported[0].id
    const first = project.library.list({ folderId: null, scope: 'project' }).entries[0]
    const extra = await project.assets.importFiles([path], { duplicates: 'entry', folderId: null })
    const secondId = extra.entryIds[0]
    const [objectId] = project.objects.createFromAssets({
      boardId: project.mainBoardId,
      assetIds: [assetId],
      center: { x: 10, y: 10 }
    })
    const nested = project.boards.create(project.mainBoardId, 'Nested')
    const assetTag = project.tags.createReusable('Hero')
    const entryTag = project.tags.createReusable('Cover')
    const appearanceTag = project.tags.createReusable('Draft')
    const cardTag = project.tags.createReusable('Portal')
    const boardTag = project.tags.createReusable('Chapter')
    project.tags.assign(assetTag.id, { type: 'asset', id: assetId })
    project.tags.assign(entryTag.id, { type: 'entry', id: first.id })
    project.tags.assign(appearanceTag.id, { type: 'object', id: objectId })
    project.tags.assign(cardTag.id, { type: 'object', id: nested.objectId })
    project.tags.assign(boardTag.id, { type: 'board', id: nested.id })

    const detail = project.tags.decorateBoard(project.boards.get(project.mainBoardId))
    const image = detail.objects.find((object) => object.id === objectId)
    const card = detail.objects.find((object) => object.id === nested.objectId)
    expect(image?.tags?.map((tag) => tag.name).sort()).toEqual(['Draft', 'Hero'])
    expect(card?.tags?.map((tag) => tag.name)).toEqual(['Portal'])
    expect(
      project.tags.decorateBoard(project.boards.get(nested.id)).tags?.map((tag) => tag.name)
    ).toEqual(['Chapter'])
    const entry = project.library.details(first.id)
    expect(
      project.tags
        .decorateLibrary(entry)
        .tags?.map((tag) => tag.name)
        .sort()
    ).toEqual(['Cover', 'Hero'])
    const other = project.tags.decorateLibrary(project.library.details(secondId))
    expect(other.tags?.map((tag) => tag.name)).toEqual(['Hero'])
    expect(project.tags.assign(assetTag.id, { type: 'asset', id: assetId }).created).toBe(false)
    expect(() => project.tags.createReusable('hero')).toThrow(/already exists/)
    expect(() => project.tags.assign(assetTag.id, { type: 'object', id: 'missing' })).toThrow(
      /no longer exists/
    )
  })

  it('refuses an undo that would reverse another window’s newer assignment', () => {
    const tag = project.tags.createReusable('Mood')
    const target = { type: 'board' as const, id: project.mainBoardId }
    const added = project.tags.assign(tag.id, target)
    const removed = project.tags.unassign(tag.id, target)
    const again = project.tags.assign(tag.id, target)
    expect(() => project.tags.revertAdd([added.id])).toThrow(TAG_UNDO_REFUSED)
    expect(project.tags.list()[0].assignmentCount).toBe(1)
    expect(() => project.tags.revertRemove([removed!])).toThrow(TAG_UNDO_REFUSED)
    project.tags.revertAdd([again.id])
    expect(project.tags.list()[0].assignmentCount).toBe(0)
  })

  it('refuses a replace undo after another window changes the direct tags', () => {
    const alpha = project.tags.createReusable('Alpha')
    const beta = project.tags.createReusable('Beta')
    const gamma = project.tags.createReusable('Gamma')
    const target = { type: 'board' as const, id: project.mainBoardId }
    const replaced = project.tags.replaceDirect([alpha.id], [target])
    project.tags.assign(beta.id, target)
    expect(() =>
      project.tags.revertReplace(
        [target],
        replaced.after.map((row) => row.id),
        replaced.before
      )
    ).toThrow(TAG_UNDO_REFUSED)
    expect(
      project.tags
        .decorateBoard(project.boards.get(project.mainBoardId))
        .tags?.map((tag) => tag.name)
        .sort()
    ).toEqual(['Alpha', 'Beta'])
    const second = project.tags.replaceDirect([gamma.id], [target, target])
    project.tags.revertReplace(
      [target],
      second.after.map((row) => row.id),
      second.before
    )
    expect(
      project.tags
        .decorateBoard(project.boards.get(project.mainBoardId))
        .tags?.map((tag) => tag.name)
        .sort()
    ).toEqual(['Alpha', 'Beta'])
  })

  it('reserves an archived name and restores a trashed tag only with an explicit new name', () => {
    const tag = project.tags.createReusable('Forest')
    project.tags.archive(tag.id)
    expect(() => project.tags.createReusable('forest')).toThrow(/archived/)
    project.tags.unarchive(tag.id)
    const trashed = project.tags.trash(tag.id)
    expect(trashed.assignments).toBe(0)
    project.tags.createReusable('Forest')
    const blocked = project.tags.restore(tag.id)
    expect(blocked).toMatchObject({ status: 'name-taken', suggestedName: 'Forest (restored)' })
    expect(project.tags.list({ trash: true })).toHaveLength(1)
    const restored = project.tags.restore(tag.id, 'Forest (restored)')
    expect(restored.status).toBe('restored')
    project.tags.purge(tag.id)
    expect(project.tags.list({ includeArchived: true, trash: true })).toHaveLength(0)
    expect(project.tags.list().map((item) => item.name)).toEqual(['Forest'])
  })

  it('promotes a one-off without silently reviving a trashed tag', () => {
    const reusable = project.tags.createReusable('Shared')
    project.tags.trash(reusable.id)
    const oneOff = project.tags.createOneOff('Shared', { type: 'board', id: project.mainBoardId })
    const asked = project.tags.promote(oneOff.id)
    expect(asked.status).toBe('trashed-exists')
    expect(project.tags.listOneOffs()).toHaveLength(1)
    const promoted = project.tags.promote(oneOff.id, { restoreTrashed: true })
    expect(promoted.status).toBe('promoted')
    expect(project.tags.listOneOffs()).toHaveLength(0)
    expect(project.tags.decorateBoard(project.boards.get(project.mainBoardId)).tags?.[0].name).toBe(
      'Shared'
    )
  })

  it('removes assignments and a sole one-off when an item is permanently deleted', async () => {
    const path = join(dir, 'note.txt')
    writeFileSync(path, 'hello')
    await project.assets.importFiles([path])
    const entry = project.library.list({ folderId: null, scope: 'project' }).entries[0]
    const reusable = project.tags.createReusable('Keep')
    project.objects.createFromAssets({
      boardId: project.mainBoardId,
      assetIds: [entry.assetId],
      center: { x: 30, y: 30 }
    })
    project.tags.assign(reusable.id, { type: 'asset', id: entry.assetId })
    project.tags.assign(reusable.id, { type: 'entry', id: entry.id })
    project.tags.createOneOff('Once', { type: 'entry', id: entry.id })
    const other = project.tags.createReusable('Elsewhere')
    project.tags.assign(other.id, { type: 'board', id: project.mainBoardId })
    project.library.trash([entry.id])
    const stillThere = project.connection
      .prepare(`SELECT count(*) AS n FROM taggings WHERE target_type = 'entry' AND target_id = ?`)
      .get(entry.id) as { n: number }
    expect(stillThere.n).toBe(1)
    project.library.purge({ entries: [entry.id], folders: [], objects: [] })
    expect(
      project.tags
        .list()
        .map((tag) => tag.name)
        .sort()
    ).toEqual(['Elsewhere', 'Keep'])
    expect(project.tags.list().find((tag) => tag.name === 'Keep')?.assignmentCount).toBe(1)
    expect(project.tags.listOneOffs()).toHaveLength(0)
  })

  it('does not inherit a linked board’s tags onto its card', () => {
    const nested = project.boards.create(project.mainBoardId, 'Inside')
    const boardTag = project.tags.createReusable('Inside tag')
    project.tags.assign(boardTag.id, { type: 'board', id: nested.id })
    const card = project.tags
      .decorateBoard(project.boards.get(project.mainBoardId))
      .objects.find((object) => object.id === nested.objectId)
    expect(card?.tags).toEqual([])
  })

  it('searches the same PDF on two boards by the appearance that owns the tag', async () => {
    const path = join(dir, 'chapter.pdf')
    writeFileSync(path, buildPdf(['alpha beacon', 'second page']))
    const imported = await project.assets.importFiles([path])
    const assetId = imported.imported[0].id
    const left = project.boards.create(project.mainBoardId, 'Left')
    const right = project.boards.create(project.mainBoardId, 'Right')
    const [leftObject] = project.objects.createFromAssets({
      boardId: left.id,
      assetIds: [assetId],
      center: { x: 20, y: 20 }
    })
    const [rightObject] = project.objects.createFromAssets({
      boardId: right.id,
      assetIds: [assetId],
      center: { x: 20, y: 20 }
    })
    const alpha = project.tags.createReusable('Alpha')
    const beta = project.tags.createReusable('Beta')
    project.tags.assign(alpha.id, { type: 'object', id: leftObject })
    project.tags.assign(beta.id, { type: 'object', id: rightObject })
    project.search.addPdfPage(assetId, 1, 'alpha beacon', 'chapter.pdf')
    const tagged = project.search.searchPage({
      text: 'beacon',
      filter: 'pdf',
      tags: { included: [alpha.id], mode: 'all', excluded: [] },
      tagMatch: 'direct'
    })
    expect(tagged.hits.map((hit) => hit.objectId)).toEqual([leftObject])
    expect(tagged.hits[0].page).toBe(1)
    expect(tagged.hits.some((hit) => hit.objectId === rightObject)).toBe(false)
    const tagOnly = project.search.searchPage({
      tags: { included: [alpha.id], mode: 'all', excluded: [] },
      tagMatch: 'direct',
      filter: 'pdf'
    })
    expect(tagOnly.hits).toHaveLength(1)
    expect(tagOnly.hits[0].kind).not.toBe('pdf-page')
    expect(tagOnly.hits[0].objectId).toBe(leftObject)
  })

  it('applies tag filters before pagination and keeps a direct asset hit', () => {
    const tag = project.tags.createReusable('Batch')
    const plain = project.notes.create({
      boardId: project.mainBoardId,
      at: { x: 0, y: 0 },
      content: {
        schemaVersion: 1,
        doc: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain note' }] }]
        }
      }
    })
    const ids: string[] = []
    for (let index = 0; index < 60; index++) {
      const note = project.notes.create({
        boardId: project.mainBoardId,
        at: { x: index, y: 0 },
        content: {
          schemaVersion: 1,
          doc: {
            type: 'doc',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: `batch note ${index}` }] }
            ]
          }
        }
      })
      project.tags.assign(tag.id, { type: 'object', id: note.id })
      ids.push(note.id)
    }
    const request = {
      tags: { included: [tag.id], mode: 'all' as const, excluded: [] },
      tagMatch: 'direct' as const,
      limit: 50
    }
    const first = project.search.searchPage(request)
    expect(first.hits).toHaveLength(50)
    expect(first.hits.some((hit) => hit.sourceId === plain.id)).toBe(false)
    const second = project.search.searchPage({ ...request, cursor: first.nextCursor })
    expect(second.hits).toHaveLength(10)
    expect(new Set([...first.hits, ...second.hits].map((hit) => hit.sourceId)).size).toBe(60)

    const path = join(dir, 'direct.txt')
    writeFileSync(path, 'direct')
    return project.assets.importFiles([path]).then(async (imported) => {
      const assetId = imported.imported[0].id
      const entry = project.library
        .list({ folderId: null, scope: 'project' })
        .entries.find((item) => item.assetId === assetId)!
      const assetTag = project.tags.createReusable('Original')
      const entryTag = project.tags.createReusable('EntryOnly')
      project.tags.assign(assetTag.id, { type: 'asset', id: assetId })
      project.tags.assign(entryTag.id, { type: 'entry', id: entry.id })
      const direct = project.search.searchPage({
        tags: { included: [assetTag.id], mode: 'all', excluded: [] },
        tagMatch: 'direct'
      })
      expect(direct.hits.map((hit) => hit.kind)).toEqual(['asset'])
      const effective = project.search.searchPage({
        tags: { included: [assetTag.id], mode: 'all', excluded: [] },
        tagMatch: 'effective'
      })
      expect(effective.hits.map((hit) => hit.kind).sort()).toEqual(['asset', 'entry'])
      const entryOnly = project.search.searchPage({
        tags: { included: [entryTag.id], mode: 'all', excluded: [] },
        tagMatch: 'direct'
      })
      expect(entryOnly.hits.map((hit) => hit.sourceId)).toEqual([entry.id])
    })
  })
})

function createLegacyProject(
  parent: string,
  name: string,
  migrationsFolder: string
): { path: string; sqlite: Database.Database; mainBoardId: string } {
  const path = join(parent, name + PROJECT_EXTENSION)
  mkdirSync(path)
  for (const folder of PROJECT_SUBDIRS) mkdirSync(join(path, folder))
  const sqlite = openRawDatabase(join(path, PROJECT_DB_FILE))
  migrateDatabase(sqlite, migrationsFolder)
  const mainBoardId = randomUUID()
  const now = Date.now()
  sqlite
    .prepare(`INSERT INTO boards (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(mainBoardId, name, now, now)
  sqlite
    .prepare(
      `INSERT INTO project_meta (id, name, main_board_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    .run(randomUUID(), name, mainBoardId, now, now)
  return { path, sqlite, mainBoardId }
}
