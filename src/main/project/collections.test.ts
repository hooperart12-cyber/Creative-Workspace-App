import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { BUILTIN_TEMPLATES, MANGA_TEMPLATE } from '@shared/collections'
import { COLLECTION_CONFLICT } from './collections'
import { assets, collections, pageStageStates } from '../db/schema'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-m9-'))
  project = Project.create(dir, 'Collections', migrations)
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

describe('page collections', () => {
  it('keeps the collection when one of two canvas cards is deleted', () => {
    const parent = project.collections.createFolder(null, 'Chapters')
    const nested = project.collections.createFolder(parent.id, 'Volume 1')
    const created = project.collections.create({
      title: 'Chapter 1',
      folderId: nested.id,
      templateId: BUILTIN_TEMPLATES.manga,
      placeholderCount: 2
    })
    const first = project.collections.createAppearance(project.mainBoardId, created.id)
    const second = project.collections.createAppearance(project.mainBoardId, created.id)
    project.objects.delete([first.id])
    const board = project.boards.get(project.mainBoardId)
    expect(
      board.objects.filter((object) => object.type === 'collection').map((object) => object.id)
    ).toEqual([second.id])
    expect(project.collections.pages(created.id)).toHaveLength(2)
    project.collections.renameFolder(nested.id, 'Book 1')
    project.collections.moveFolder(nested.id, null)
    expect(project.collections.pages(created.id)[0]?.id).toBe(created.pageIds[0])
  })

  it('does not rewrite a collection when its template changes later', () => {
    const created = project.collections.create({
      title: 'Pilot',
      templateId: BUILTIN_TEMPLATES.manga
    })
    expect(project.collections.stages(created.id).map((stage) => stage.name)).toEqual(
      MANGA_TEMPLATE.stages.map((stage) => stage.name)
    )
    project.collections.updateTemplate(BUILTIN_TEMPLATES.manga, {
      ...MANGA_TEMPLATE,
      stages: [{ name: 'Only pencils' }]
    })
    expect(project.collections.stages(created.id).map((stage) => stage.name)).toContain('Inks')
    const later = project.collections.create({
      title: 'After',
      templateId: BUILTIN_TEMPLATES.manga
    })
    expect(project.collections.stages(later.id).map((stage) => stage.name)).toEqual([
      'Only pencils'
    ])
  })

  it('inserts placeholders with stable ids and removes them in one undo', () => {
    const created = project.collections.create({ title: 'Pages' })
    const inserted = project.collections.insertPages({
      collectionId: created.id,
      count: 40,
      title: 'Panel',
      notes: 'Keep this',
      role: 'story'
    })
    expect(inserted.pageIds).toHaveLength(40)
    expect(new Set(inserted.pageIds).size).toBe(40)
    const pages = project.collections.pages(created.id)
    expect(pages[0]).toMatchObject({ title: 'Panel', notes: 'Keep this', number: 1 })
    expect(pages[39]?.number).toBe(40)
    project.collections.undoPages(inserted.pageIds)
    expect(project.collections.pages(created.id)).toHaveLength(0)
  })

  it('keeps page ids when the sequence changes and when a page moves', () => {
    const left = project.collections.create({ title: 'Left', placeholderCount: 3 })
    const right = project.collections.create({ title: 'Right', placeholderCount: 0 })
    const [first, second, third] = left.pageIds
    project.collections.reorder(left.id, [third!], first!)
    const reordered = project.collections.pages(left.id)
    expect(reordered.map((page) => page.id)).toEqual([third, first, second])
    expect(reordered.map((page) => page.number)).toEqual([1, 2, 3])
    project.collections.movePages([first!], right.id, null)
    expect(project.collections.pages(right.id).map((page) => page.id)).toEqual([first])
    expect(project.collections.pages(left.id).map((page) => page.id)).toEqual([third, second])
  })

  it('remaps a copied page link and leaves an outside link and comments behind', () => {
    const source = project.collections.create({ title: 'Source', placeholderCount: 2 })
    const other = project.collections.create({ title: 'Other' })
    const [a, b] = source.pageIds
    project.collections.addLink(a!, {
      kind: 'page',
      collectionId: source.id,
      pageId: b!,
      title: 'Next'
    })
    project.collections.addLink(a!, {
      kind: 'collection',
      collectionId: other.id,
      title: 'Outside'
    })
    project.collections.addComment(a!, 'Note on the original')
    const copied = project.collections.copyPages([a!, b!], source.id, null)
    const copyA = copied.idMap.get(a!)!
    const links = project.collections.links(copyA)
    const internal = links.find((link) => link.destination?.kind === 'page')
    const external = links.find((link) => link.destination?.kind === 'collection')
    expect(internal?.destination).toMatchObject({
      kind: 'page',
      pageId: copied.idMap.get(b!),
      collectionId: source.id
    })
    expect(external?.destination).toMatchObject({ kind: 'collection', collectionId: other.id })
    expect(project.collections.comments(copyA)).toEqual([])
    expect(project.collections.comments(a!)).toHaveLength(1)
    expect(
      project.collections.links(a!).find((link) => link.destination?.kind === 'page')?.destination
    ).toMatchObject({
      pageId: b
    })
  })

  it('shows a version without completing the page, and an older project still opens', async () => {
    const assetId = randomUUID()
    const now = new Date()
    project.db
      .insert(assets)
      .values({
        id: assetId,
        sha256: 'a'.repeat(64),
        originalName: 'page.png',
        mime: 'image/png',
        ext: 'png',
        bytes: 4,
        createdAt: now,
        updatedAt: now
      })
      .run()
    const created = project.collections.create({ title: 'Art', placeholderCount: 1 })
    const pageId = created.pageIds[0]!
    const version = project.collections.addVersion(pageId, { assetId, name: 'Final' })
    const saved = project.collections.setDisplayed(pageId, version.id, 0)
    expect(project.collections.pages(created.id)[0]).toMatchObject({
      displayedVersionId: version.id,
      overallStatus: 'not_started',
      revision: saved.revision
    })

    project.close()
    const oldMigrations = join(dir, 'before-m9')
    cpSync(migrations, oldMigrations, { recursive: true })
    const journalPath = join(oldMigrations, 'meta', '_journal.json')
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] }
    journal.entries = journal.entries.filter((entry) => entry.tag !== '0008_page_collections')
    writeFileSync(journalPath, JSON.stringify(journal))
    const legacy = Project.create(dir, 'Legacy', oldMigrations)
    const note = legacy.notes.create({ boardId: legacy.mainBoardId, at: { x: 10, y: 10 } })
    const tag = legacy.tags.createReusable('Hero')
    legacy.tags.assign(tag.id, { type: 'object', id: note.id })
    legacy.close()
    const current = await Project.open(join(dir, 'Legacy.cwproj'), migrations, {
      vaultFor: () => join(dir, 'vault')
    })
    try {
      expect(
        current.boards.get(current.mainBoardId).objects.some((object) => object.id === note.id)
      ).toBe(true)
      const again = current.collections.create({ title: 'After migration', placeholderCount: 1 })
      current.tags.assign(tag.id, { type: 'page', id: again.pageIds[0]! })
    } finally {
      current.close()
    }
  })

  it('refuses a stale page write and keeps the saved note', () => {
    const created = project.collections.create({ title: 'Race', placeholderCount: 1 })
    const page = project.collections.pages(created.id)[0]!
    project.collections.updatePage(page.id, page.revision, { notes: 'saved' })
    expect(() =>
      project.collections.updatePage(page.id, page.revision, { notes: 'stale' })
    ).toThrow(COLLECTION_CONFLICT)
    expect(project.collections.pages(created.id)[0]?.notes).toBe('saved')
  })

  it('stores the reader position only when a reader session records it', () => {
    const created = project.collections.create({ title: 'Read', placeholderCount: 1 })
    const pageId = created.pageIds[0]!
    const before = project.db.select().from(collections).where(eq(collections.id, created.id)).get()
    expect(before?.readerPageId).toBeNull()
    project.collections.touchReader(created.id, {
      pageId,
      layout: 'spread',
      zoom: 1.5,
      x: 12,
      y: -4
    })
    const after = project.db.select().from(collections).where(eq(collections.id, created.id)).get()
    expect(after).toMatchObject({
      readerPageId: pageId,
      readerLayout: 'spread',
      readerZoom: 1.5,
      readerX: 12,
      readerY: -4
    })
  })

  it('trashes a locked pair together and restores the same page ids', () => {
    const created = project.collections.create({ title: 'Pair', placeholderCount: 3 })
    const [first, second, third] = created.pageIds
    project.collections.lockSpread(first!, second!)
    const trashed = project.collections.trashPages([first!])
    expect(trashed.pageIds).toEqual([first, second])
    expect(project.collections.pages(created.id).map((page) => page.id)).toEqual([third])
    project.collections.restorePages([first!])
    expect(project.collections.pages(created.id).map((page) => page.id)).toEqual([
      third,
      first,
      second
    ])
    project.collections.trash(created.id)
    expect(project.collections.list().some((item) => item.id === created.id)).toBe(false)
    project.collections.restore(created.id)
    expect(project.collections.pages(created.id)).toHaveLength(3)
  })

  it('duplicates a full collection and a structure-only copy without comments', () => {
    const assetId = randomUUID()
    const now = new Date()
    project.db
      .insert(assets)
      .values({
        id: assetId,
        sha256: 'b'.repeat(64),
        originalName: 'ink.png',
        mime: 'image/png',
        ext: 'png',
        bytes: 4,
        createdAt: now,
        updatedAt: now
      })
      .run()
    const source = project.collections.create({
      title: 'Chapter',
      templateId: BUILTIN_TEMPLATES.manga,
      placeholderCount: 2
    })
    const [a, b] = source.pageIds
    const version = project.collections.addVersion(a!, { assetId, name: 'Inks' })
    project.collections.setDisplayed(a!, version.id, 0)
    project.collections.updatePage(a!, 1, { notes: 'Keep', overallStatus: 'in_progress' })
    const stageId = project.collections.stages(source.id)[0]!.id
    project.collections.setStage(a!, stageId, 'done', 'finished inks')
    project.collections.addLink(a!, {
      kind: 'page',
      collectionId: source.id,
      pageId: b!,
      title: 'Next'
    })
    project.collections.addComment(a!, 'Stay here')
    project.collections.updateSettings(source.id, { direction: 'rtl', numberStart: 3 })

    const full = project.collections.duplicate(source.id, 'full')
    expect(full.pageIds).not.toEqual(source.pageIds)
    const copied = project.collections.pages(full.id)[0]!
    expect(copied).toMatchObject({ notes: 'Keep', overallStatus: 'in_progress', number: 3 })
    expect(copied.displayedVersionId).toBeTruthy()
    expect(project.collections.links(copied.id)[0]?.destination).toMatchObject({
      kind: 'page',
      pageId: full.pageIds[1],
      collectionId: full.id
    })
    expect(project.collections.comments(copied.id)).toEqual([])
    expect(project.collections.comments(a!)).toHaveLength(1)
    const copiedStage = project.db
      .select()
      .from(pageStageStates)
      .where(eq(pageStageStates.pageId, copied.id))
      .get()
    expect(copiedStage).toMatchObject({ state: 'done', note: 'finished inks' })
    expect(copiedStage?.stageId).not.toBe(stageId)
    project.collections.removeVersion(version.id)
    expect(project.collections.pages(source.id)[0]?.displayedVersionId).toBeNull()
    expect(project.db.select().from(assets).where(eq(assets.id, assetId)).get()?.id).toBe(assetId)

    const structure = project.collections.duplicate(source.id, 'structure')
    const slot = project.collections.pages(structure.id)[0]!
    expect(slot).toMatchObject({
      notes: 'Keep',
      overallStatus: 'not_started',
      displayedVersionId: null,
      number: 3
    })
    expect(project.collections.links(slot.id)).toEqual([])
    const asset = project.db.select().from(assets).where(eq(assets.id, assetId)).get()
    expect(asset?.deletedAt ?? null).toBeNull()
  })

  it('keeps a contents entry on the same page after a reorder, and marks it missing in the trash', () => {
    const created = project.collections.create({ title: 'Contents', placeholderCount: 2 })
    const [first, second] = created.pageIds
    const entry = project.collections.addNav(created.id, second!, 'toc', 'Fight')
    project.collections.reorder(created.id, [second!], first!)
    expect(project.collections.nav(created.id)).toEqual([
      { id: entry.id, pageId: second, kind: 'toc', title: 'Fight', available: true }
    ])
    project.collections.trashPages([second!])
    expect(project.collections.nav(created.id)[0]).toMatchObject({
      pageId: second,
      available: false
    })
  })
})
