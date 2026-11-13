import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { randomUUID } from 'node:crypto'
import { planStagedImport } from '@shared/collectionImport'
import { BUILTIN_TEMPLATES, MANGA_TEMPLATE } from '@shared/collections'
import { COLLECTION_CONFLICT } from './collections'
import { assets, collections, pageStageStates, pageVersions } from '../db/schema'
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
  it('assigns a tag when placeholders are created and can remove it in one undo', () => {
    const tag = project.tags.createReusable('Inks')
    const created = project.collections.create({ title: 'Tagged', placeholderCount: 0 })
    const inserted = project.collections.insertPages({
      collectionId: created.id,
      count: 2,
      title: 'Rough',
      notes: 'panel',
      tagIds: [tag.id]
    })
    expect(project.collections.pageTags(inserted.pageIds)).toHaveLength(2)
    expect(project.collections.pages(created.id)[0]).toMatchObject({
      title: 'Rough',
      notes: 'panel',
      overallStatus: 'not_started'
    })
    const added = project.collections.applyBulk(
      inserted.pageIds,
      { kind: 'remove-tag', tagId: tag.id },
      false
    )
    expect(project.collections.pageTags(inserted.pageIds)).toHaveLength(0)
    expect(project.collections.pages(created.id)[0]?.notes).toBe('panel')
    project.collections.undoBulk(added.undo)
    expect(project.collections.pageTags(inserted.pageIds)).toHaveLength(2)
  })

  it('updates one stage without changing status, notes, or the asset', () => {
    const created = project.collections.create({
      title: 'Stages',
      templateId: BUILTIN_TEMPLATES.manga,
      placeholderCount: 1
    })
    const pageId = created.pageIds[0]!
    project.collections.updatePage(pageId, 0, { notes: 'stay' })
    const stage = project.collections.stages(created.id)[0]!
    const bulk = project.collections.applyBulk(
      [pageId],
      { kind: 'set-stage', stageId: stage.id, state: 'done' },
      false
    )
    const page = project.collections.pages(created.id)[0]!
    expect(page.notes).toBe('stay')
    expect(page.overallStatus).toBe('not_started')
    expect(project.collections.detail(created.id).stageStates[0]).toMatchObject({
      stageId: stage.id,
      state: 'done'
    })
    project.collections.undoBulk(bulk.undo)
    expect(project.collections.detail(created.id).stageStates).toHaveLength(0)
  })

  it('keeps the version id and the first file when artwork is relinked', async () => {
    const created = project.collections.create({ title: 'Art', placeholderCount: 1 })
    const pageId = created.pageIds[0]!
    project.collections.updatePage(pageId, 0, { notes: 'caption' })
    const wide = join(dir, 'wide.png')
    const small = join(dir, 'small.png')
    writeFileSync(
      wide,
      await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } })
        .png()
        .toBuffer()
    )
    writeFileSync(
      small,
      await sharp({ create: { width: 2, height: 2, channels: 3, background: 'blue' } })
        .png()
        .toBuffer()
    )
    const first = await project.assets.importFile(wide)
    const second = await project.assets.importFile(small)
    const version = project.collections.addVersion(pageId, {
      assetId: first.id,
      name: 'wide.png',
      sourceSlideId: '11111111-1111-4111-8111-111111111111'
    })
    const page = project.collections.pages(created.id)[0]!
    project.collections.setDisplayed(pageId, version.id, page.revision)
    project.collections.setCrop(version.id, { x: 0, y: 0, w: 6, h: 4 })
    const before = createHash('sha256')
      .update(readFileSync(project.assets.originalPath(first.sha256, first.ext)))
      .digest('hex')
    const folder = join(dir, 'match')
    mkdirSync(folder)
    writeFileSync(join(folder, 'wide.png'), readFileSync(wide))
    const preview = project.collections.previewFolderMatch(created.id, [
      { name: 'wide.png', filePath: join(folder, 'wide.png') },
      { name: 'other.png', filePath: join(folder, 'other.png') }
    ])
    expect(preview).toEqual([
      { versionId: version.id, filePath: join(folder, 'wide.png'), fileName: 'wide.png' }
    ])
    expect(project.collections.versions(pageId)[0]?.assetId).toBe(first.id)
    const relinked = project.collections.relinkVersion(version.id, second.id)
    expect(relinked.cropCleared).toBe(true)
    expect(project.collections.versions(pageId)[0]).toMatchObject({
      id: version.id,
      assetId: second.id,
      crop: null
    })
    expect(
      project.db.select().from(pageVersions).where(eq(pageVersions.id, version.id)).get()
        ?.sourceSlideId
    ).toBe('11111111-1111-4111-8111-111111111111')
    expect(project.collections.pages(created.id)[0]?.notes).toBe('caption')
    expect(
      createHash('sha256')
        .update(readFileSync(project.assets.originalPath(first.sha256, first.ext)))
        .digest('hex')
    ).toBe(before)
    project.db.update(assets).set({ width: 0, height: 0 }).where(eq(assets.id, second.id)).run()
    expect(project.collections.pages(created.id)[0]?.artwork).toBe('damaged')
  })

  it('imports a slide through the same staging plan and keeps the slide id', async () => {
    const png = join(dir, 'slide.png')
    writeFileSync(
      png,
      await sharp({ create: { width: 4, height: 4, channels: 3, background: 'green' } })
        .png()
        .toBuffer()
    )
    const asset = await project.assets.importFile(png)
    project.stacks.createFromAssets(project.mainBoardId, [asset.id], { x: 10, y: 10 })
    const board = project.boards.get(project.mainBoardId)
    const staged = project.collections.stageBoardArtwork(board.objects)
    expect(staged[0]).toMatchObject({ assetId: asset.id, accepted: true })
    expect(staged[0]?.sourceSlideId).toBeTruthy()
    const created = project.collections.create({ title: 'From slide', placeholderCount: 0 })
    const plan = planStagedImport({
      entries: staged,
      placeholders: [],
      mode: 'append',
      applyVersionGroups: false
    })
    project.collections.commitImport(
      created.id,
      null,
      plan.actions.map((action) => ({
        kind: 'page' as const,
        assets: action.names.map((name) => {
          const source = staged.find((item) => item.name === name)!
          return {
            assetId: source.assetId!,
            name,
            sourceSlideId: source.sourceSlideId
          }
        })
      }))
    )
    const page = project.collections.pages(created.id)[0]!
    expect(page.artwork).toBe('ready')
    expect(project.collections.versions(page.id)[0]?.assetId).toBe(asset.id)
    expect(
      project.db.select().from(pageVersions).where(eq(pageVersions.pageId, page.id)).get()
        ?.sourceSlideId
    ).toBe(staged[0]?.sourceSlideId)
  })

  it('trashes a folder without deleting the collection inside it', () => {
    const folder = project.collections.createFolder(null, 'Volume')
    const child = project.collections.createFolder(folder.id, 'Nested')
    const created = project.collections.create({
      title: 'Chapter',
      folderId: folder.id,
      placeholderCount: 1
    })
    expect(() => project.collections.trashFolder(folder.id)).toThrow(/inside/)
    project.collections.trashFolder(child.id)
    project.collections.trashFolder(folder.id)
    const hidden = project.collections.outline()
    expect(hidden.folders.map((item) => item.id)).not.toContain(folder.id)
    expect(project.collections.trashedFolders().map((item) => item.id)).toContain(folder.id)
    expect(hidden.collections[0]).toMatchObject({ id: created.id, folderId: folder.id })
    expect(project.collections.detail(created.id).pages).toHaveLength(1)
    project.collections.restoreFolder(folder.id)
    expect(project.collections.outline().folders.map((item) => item.id)).toContain(folder.id)
  })

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
    expect(project.collections.reader(created.id).resume.pageId).toBeNull()
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
    const opened = project.collections.reader(created.id)
    expect(opened.resume.pageId).toBe(pageId)
    expect(opened.nextCollectionId).toBeNull()
    project.collections.updateSettings(created.id, { nextCollectionId: null })
    const bookmark = project.collections.addNav(created.id, pageId, 'bookmark', 'Here')
    expect(
      project.collections.nav(created.id).find((item) => item.id === bookmark.id)
    ).toMatchObject({
      pageId,
      kind: 'bookmark',
      available: true
    })
    expect(project.collections.reader(created.id).resume).not.toHaveProperty('background')
    const next = project.collections.create({ title: 'Chapter 2' })
    project.collections.updateSettings(created.id, { nextCollectionId: next.id })
    expect(project.collections.reader(created.id)).toMatchObject({
      nextCollectionId: next.id,
      nextTitle: 'Chapter 2'
    })
    project.collections.trash(next.id)
    expect(project.collections.reader(created.id).nextCollectionId).toBeNull()
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

  it('reorders inside a folder, saves a template without rewriting the collection, and keeps two card appearances apart', () => {
    const folder = project.collections.createFolder(null, 'Book')
    const first = project.collections.create({
      title: 'One',
      folderId: folder.id,
      placeholderCount: 1
    })
    const second = project.collections.create({ title: 'Two', folderId: folder.id })
    project.collections.reorderSibling('collection', second.id, first.id)
    expect(
      project.collections
        .outline()
        .collections.filter((item) => item.folderId === folder.id)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((item) => item.id)
    ).toEqual([second.id, first.id])
    const saved = project.collections.saveTemplate('My pages', first.id)
    project.collections.updateTemplate(saved.id, {
      direction: 'ltr',
      firstPageSide: 'right',
      stages: [{ name: 'Only pencils' }]
    })
    expect(project.collections.stages(first.id).map((stage) => stage.name)).toEqual(['Work'])
    expect(project.collections.pages(first.id)[0]?.id).toBe(first.pageIds[0])
    const cardA = project.collections.createAppearance(project.mainBoardId, first.id)
    const cardB = project.collections.createAppearance(project.mainBoardId, first.id)
    project.collections.setAppearance(cardA.id, { display: 'cover', openWith: 'planner' })
    const board = project.collections.attach(project.boards.get(project.mainBoardId).objects)
    const cover = board.find((object) => object.id === cardA.id)
    const compact = board.find((object) => object.id === cardB.id)
    expect(cover?.data.display).toBe('cover')
    expect(compact?.data.display).toBe('compact')
    expect(cover?.collection).toMatchObject({ id: first.id, title: 'One', pageCount: 1 })
    expect(compact?.collection?.id).toBe(first.id)
    project.collections.setSpan(first.pageIds[0]!, 2)
    expect(project.collections.pages(first.id)[0]).toMatchObject({ id: first.pageIds[0], span: 2 })
  })

  it('fills a placeholder, refuses an unconfirmed note replace, and keeps the asset bytes', () => {
    const assetId = randomUUID()
    const now = new Date()
    project.db
      .insert(assets)
      .values({
        id: assetId,
        sha256: 'b'.repeat(64),
        originalName: 'Page 2.png',
        mime: 'image/png',
        ext: 'png',
        bytes: 8,
        createdAt: now,
        updatedAt: now
      })
      .run()
    const created = project.collections.create({ title: 'Book', placeholderCount: 2 })
    const [first, second] = created.pageIds
    project.collections.updatePage(first!, 0, { notes: 'keep me', overallStatus: 'in_progress' })
    const filled = project.collections.commitImport(created.id, null, [
      { kind: 'fill', pageId: first!, assets: [{ assetId, name: 'Page 2.png' }] }
    ])
    expect(project.collections.pages(created.id)[0]).toMatchObject({
      id: first,
      notes: 'keep me',
      overallStatus: 'in_progress',
      artwork: 'ready',
      displayedName: 'Page 2'
    })
    const added = project.collections.commitImport(created.id, null, [
      {
        kind: 'page',
        assets: [
          { assetId, name: 'Page 10.png' },
          { assetId, name: 'Page 10 inks.png' }
        ]
      }
    ])
    const imported = project.collections
      .pages(created.id)
      .find((page) => page.id === added.created[0])
    expect(imported).toMatchObject({
      title: 'Page 10',
      overallStatus: 'not_started',
      artwork: 'ready'
    })
    expect(project.collections.versions(imported!.id).map((version) => version.name)).toEqual([
      'Page 10',
      'Page 10 inks'
    ])
    const before = project.db.select().from(assets).where(eq(assets.id, assetId)).get()
    project.collections.setCrop(project.collections.versions(imported!.id)[0]!.id, {
      x: 1,
      y: 2,
      w: 3,
      h: 4
    })
    expect(project.db.select().from(assets).where(eq(assets.id, assetId)).get()).toEqual(before)
    project.collections.undoImport(filled)
    expect(project.collections.pages(created.id).find((page) => page.id === first)).toMatchObject({
      notes: 'keep me',
      displayedVersionId: null,
      artwork: 'blank'
    })
    expect(() =>
      project.collections.applyBulk([first!], { kind: 'replace-notes', text: 'gone' }, false)
    ).toThrow(/confirm/)
    expect(project.collections.pages(created.id).find((page) => page.id === first)?.notes).toBe(
      'keep me'
    )
    const bulk = project.collections.applyBulk(
      [first!, second!],
      { kind: 'status', status: 'done' },
      false
    )
    expect(bulk.changed).toEqual([first, second])
    expect(project.collections.pages(created.id).map((page) => page.notes)).toEqual([
      'keep me',
      '',
      ''
    ])
    project.collections.undoBulk(bulk.undo)
    expect(
      project.collections.pages(created.id).find((page) => page.id === first)?.overallStatus
    ).toBe('in_progress')
    project.collections.addComment(second!, 'check the gutter')
    const tag = project.tags.createReusable('Inks')
    project.tags.assign(tag.id, { type: 'page', id: second! })
    expect(project.collections.search(created.id, 'gutter').ids).toEqual([second])
    expect(project.collections.search(created.id, 'tag:inks').ids).toEqual([second])
    expect(project.collections.search(created.id, 'page').ids).toEqual([imported!.id])
    project.db.update(assets).set({ deletedAt: new Date() }).where(eq(assets.id, assetId)).run()
    expect(
      project.collections.pages(created.id).find((page) => page.id === imported!.id)?.artwork
    ).toBe('missing')
    const link = project.relations.createLink(
      project.mainBoardId,
      { x: 40, y: 40 },
      {
        version: 1,
        title: 'Page',
        destination: { kind: 'page', collectionId: created.id, pageId: first, title: 'Page' }
      }
    )
    expect(project.collections.pages(created.id).some((page) => page.id === first)).toBe(true)
    expect(
      project.boards.get(project.mainBoardId).objects.some((object) => object.id === link.id)
    ).toBe(true)
    project.collections.rememberPlanner(created.id, { density: 'detailed', pageId: second })
    expect(project.collections.detail(created.id).gridDensity).toBe('detailed')
  })
})
