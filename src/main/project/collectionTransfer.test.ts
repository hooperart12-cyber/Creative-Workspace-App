import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { assets } from '../db/schema'
import { extractComicEntries, listComicArchive } from './comicArchive'
import { exportCollectionPackage, importCollectionPackage } from './collectionPackage'
import { writeCollectionExport } from './collectionPictures'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-m9-export-'))
  project = Project.create(dir, 'Export', migrations)
})

afterEach(() => {
  try {
    project?.close()
  } catch {
    // The project may already be closed.
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // Windows can keep the database locked briefly.
    }
  }
})

describe('collection export', () => {
  it('writes a pdf and a numbered sequence without changing the asset file', async () => {
    const created = project.collections.create({
      title: 'Pages',
      placeholderCount: 2,
      direction: 'rtl'
    })
    const png = await sharp({
      create: { width: 8, height: 4, channels: 3, background: 'red' }
    })
      .png()
      .toBuffer()
    const source = join(dir, 'art.png')
    writeFileSync(source, png)
    const asset = await project.assets.importFile(source)
    const version = project.collections.addVersion(created.pageIds[0]!, {
      assetId: asset.id,
      name: 'Art'
    })
    project.collections.setDisplayed(created.pageIds[0]!, version.id, 0)
    project.collections.setCrop(version.id, { x: 0, y: 0, w: 4, h: 4 })
    project.collections.setSpan(created.pageIds[1]!, 2)
    const stored = project.assets.originalPath(asset.sha256, asset.ext)
    const before = createHash('sha256').update(readFileSync(stored)).digest('hex')
    const pdf = join(dir, 'chapter.pdf')
    const picture = await writeCollectionExport({
      project,
      collectionId: created.id,
      destination: pdf,
      format: 'pdf',
      spread: 'page',
      omitUnavailable: false
    })
    expect(picture.files).toEqual([pdf])
    expect(picture.warnings.map((warning) => warning.pageId)).toContain(created.pageIds[1])
    const bytes = readFileSync(pdf)
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.includes(Buffer.from('/Count 2'))).toBe(true)
    expect(createHash('sha256').update(readFileSync(stored)).digest('hex')).toBe(before)
    const folder = join(dir, 'sequence')
    const images = await writeCollectionExport({
      project,
      collectionId: created.id,
      destination: folder,
      format: 'png',
      spread: 'page',
      omitUnavailable: true
    })
    expect(images.warnings.map((warning) => warning.pageId)).toContain(created.pageIds[1])
    const written = images.files.filter((file) => file.endsWith('.png'))
    expect(written).toHaveLength(1)
    const meta = await sharp(written[0]!).metadata()
    expect(meta.width).toBe(4)
    expect(meta.height).toBe(4)
    expect(project.collections.pages(created.id).map((page) => page.id)).toEqual(created.pageIds)
    writeFileSync(stored, Buffer.from('not an image'))
    const broken = await writeCollectionExport({
      project,
      collectionId: created.id,
      destination: join(dir, 'broken.pdf'),
      format: 'pdf',
      spread: 'page',
      omitUnavailable: false
    })
    expect(broken.warnings.some((warning) => warning.message.includes('could not be read'))).toBe(
      true
    )
    expect(project.collections.pages(created.id)[0]?.id).toBe(created.pageIds[0])
  })

  it('puts a locked pair on one spread page', async () => {
    const created = project.collections.create({ title: 'Spread', placeholderCount: 2 })
    const png = await sharp({
      create: { width: 8, height: 4, channels: 3, background: 'blue' }
    })
      .png()
      .toBuffer()
    const left = join(dir, 'left.png')
    const right = join(dir, 'right.png')
    writeFileSync(left, png)
    writeFileSync(right, png)
    const first = await project.assets.importFile(left)
    const second = await project.assets.importFile(right)
    const [a, b] = created.pageIds
    const leftVersion = project.collections.addVersion(a!, { assetId: first.id, name: 'L' })
    const rightVersion = project.collections.addVersion(b!, { assetId: second.id, name: 'R' })
    project.collections.setDisplayed(a!, leftVersion.id, 0)
    project.collections.setDisplayed(b!, rightVersion.id, 0)
    project.collections.lockSpread(a!, b!)
    const folder = join(dir, 'spread')
    const images = await writeCollectionExport({
      project,
      collectionId: created.id,
      destination: folder,
      format: 'png',
      spread: 'spread',
      omitUnavailable: false
    })
    const file = images.files.find((item) => item.endsWith('.png'))!
    const meta = await sharp(file).metadata()
    expect(meta.width).toBe(8 + 16 + 8)
    expect(meta.height).toBe(4)
    expect(images.files.filter((item) => item.endsWith('.png'))).toHaveLength(1)
  })

  it('imports a package as a new collection and leaves an outside link unresolved', async () => {
    const created = project.collections.create({
      title: 'Chapter',
      placeholderCount: 2,
      direction: 'rtl',
      firstPageSide: 'right'
    })
    const other = project.collections.create({ title: 'Outside', placeholderCount: 1 })
    const next = project.collections.create({ title: 'Next', placeholderCount: 0 })
    const [first, second] = created.pageIds
    project.collections.updatePage(first!, 0, { role: 'cover', notes: 'keep me' })
    project.collections.lockSpread(first!, second!)
    const stage = project.collections.stages(created.id)[0]!
    project.collections.setStage(first!, stage.id, 'done', 'inked')
    const tag = project.tags.createReusable('Inks')
    project.tags.assign(tag.id, { type: 'page', id: first! })
    project.collections.addLink(first!, {
      kind: 'page',
      collectionId: created.id,
      pageId: second!
    })
    project.collections.addLink(first!, {
      kind: 'page',
      collectionId: other.id,
      pageId: other.pageIds[0]!
    })
    project.collections.addComment(first!, 'not in the package')
    project.collections.updateSettings(created.id, {
      nextCollectionId: next.id,
      description: 'A chapter'
    })
    project.collections.touchReader(created.id, {
      pageId: first!,
      layout: 'spread',
      zoom: 3,
      x: 4,
      y: 5
    })
    const png = await sharp({
      create: { width: 6, height: 6, channels: 3, background: 'green' }
    })
      .png()
      .toBuffer()
    writeFileSync(join(dir, 'page.png'), png)
    const asset = await project.assets.importFile(join(dir, 'page.png'))
    const version = project.collections.addVersion(second!, { assetId: asset.id, name: 'Final' })
    project.collections.setDisplayed(second!, version.id, 0)
    project.collections.setCrop(version.id, { x: 1, y: 1, w: 2, h: 2 })
    const assetCount = project.db.select().from(assets).all().length
    const destination = join(dir, 'chapter.cwcollection.zip')
    await exportCollectionPackage({
      project,
      collectionId: created.id,
      destination,
      includeComments: false
    })
    const names = await listComicArchive(destination)
    const extracted = await extractComicEntries(destination, names, join(dir, 'unpacked'))
    const manifest = readFileSync(extracted.get('manifest.json')!, 'utf8')
    expect(manifest).not.toMatch(/readerZoom|readerPageId/)
    expect(manifest).not.toMatch(/not in the package/)
    const imported = await importCollectionPackage(project, destination)
    expect(imported.collectionId).not.toBe(created.id)
    expect(imported.unresolved.some((item) => item.includes('outside'))).toBe(true)
    expect(project.db.select().from(assets).all()).toHaveLength(assetCount)
    const copy = project.collections.detail(imported.collectionId)
    expect(copy.pages.map((page) => page.id)).not.toEqual(created.pageIds)
    expect(copy.direction).toBe('rtl')
    expect(copy.pages[0]).toMatchObject({ role: 'cover', notes: 'keep me' })
    expect(copy.pages[0]?.spreadId).toBe(copy.pages[1]?.spreadId)
    expect(copy.pages[0]?.spreadId).not.toBe(project.collections.pages(created.id)[0]?.spreadId)
    expect(copy.stageStates.find((state) => state.pageId === copy.pages[0]?.id)).toMatchObject({
      state: 'done',
      note: 'inked'
    })
    expect(
      project.tags.pillsFor('page', copy.pages[0]!.id, null, false).map((item) => item.name)
    ).toEqual(['Inks'])
    const links = project.collections.links(copy.pages[0]!.id).map((link) => link.destination)
    expect(links).toContainEqual({
      kind: 'page',
      collectionId: imported.collectionId,
      pageId: copy.pages[1]!.id
    })
    expect(links).toContainEqual({
      kind: 'page',
      collectionId: other.id,
      pageId: other.pageIds[0]
    })
    expect(project.collections.comments(copy.pages[0]!.id)).toEqual([])
    expect(project.collections.reader(imported.collectionId).resume).toMatchObject({
      pageId: null,
      zoom: 1
    })
    expect(project.collections.reader(imported.collectionId).nextCollectionId).toBe(next.id)
    expect(project.collections.versions(copy.pages[1]!.id)[0]?.crop).toEqual({
      x: 1,
      y: 1,
      w: 2,
      h: 2
    })
    const again = await importCollectionPackage(project, destination)
    expect(again.collectionId).not.toBe(imported.collectionId)
    expect(project.collections.pages(created.id).map((page) => page.id)).toEqual([first, second])
  })

  it('rejects an unsafe package without creating a collection', async () => {
    const before = project.collections.list().map((item) => item.id)
    const path = join(dir, 'bad.zip')
    writeFileSync(path, zipWithNames(['manifest.json', '../secret.png']))
    await expect(importCollectionPackage(project, path)).rejects.toThrow(
      /unsafe path|invalid relative path/
    )
    expect(project.collections.list().map((item) => item.id)).toEqual(before)
  })
})

function zipWithNames(names: string[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const name of names) {
    const fileName = Buffer.from(name, 'utf8')
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(fileName.length, 26)
    locals.push(Buffer.concat([local, fileName]))
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(fileName.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(Buffer.concat([central, fileName]))
    offset += 30 + fileName.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(names.length, 8)
  eocd.writeUInt16LE(names.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}
