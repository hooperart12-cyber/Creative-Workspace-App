import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assets, boardObjects } from '../db/schema'
import {
  IMAGE_GAP,
  initialImageSize,
  layoutImages,
  MAX_INITIAL_IMAGE_SIZE,
  MIN_OBJECT_SIZE,
  proportionalSize
} from './objects'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-objects-'))
  project = Project.create(dir, 'Art', migrations)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const objectsOn = (boardId: string) => project.boards.get(boardId).objects
const titled = (boardId: string) => objectsOn(boardId).map((o) => o.board?.title ?? o.type)

/** A plain (non-board) object, standing in for the images/notes that arrive in M3. */
function addNote(boardId: string, x: number, y: number, zIndex = 0): string {
  const id = randomUUID()
  project.db
    .insert(boardObjects)
    .values({ id, boardId, type: 'note', x, y, width: 100, height: 50, zIndex })
    .run()
  return id
}

describe('ObjectRepository.update', () => {
  it('applies several patches at once', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const b = project.boards.create(main, 'B')
    const group = randomUUID()
    project.objects.update([
      { id: a.objectId, x: 10, y: 20, width: 300, locked: true, groupId: group },
      { id: b.objectId, rotation: 15, zIndex: 9, groupId: group }
    ])
    const [ca, cb] = objectsOn(main)
    expect(ca).toMatchObject({ x: 10, y: 20, width: 300, locked: true, groupId: group })
    expect(cb).toMatchObject({ rotation: 15, zIndex: 9, groupId: group })
  })

  it('enforces a minimum size', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    project.objects.update([{ id: a.objectId, width: 1, height: -50 }])
    expect(objectsOn(project.mainBoardId)[0]).toMatchObject({
      width: MIN_OBJECT_SIZE,
      height: MIN_OBJECT_SIZE
    })
  })

  it('rolls back everything if one object is missing', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    expect(() =>
      project.objects.update([
        { id: a.objectId, x: 999 },
        { id: 'missing', x: 1 }
      ])
    ).toThrow(/not found/)
    expect(objectsOn(project.mainBoardId)[0].x).toBe(0)
  })
})

describe('ObjectRepository.delete / restore', () => {
  it('trashes plain objects and board cards (with their boards), and restores them', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    project.boards.create(a.id, 'Inner')
    const note = addNote(main, 0, 500)

    project.objects.delete([a.objectId, note])
    expect(objectsOn(main)).toHaveLength(0)
    expect(project.boards.list().map((b) => b.title)).toEqual(['Art'])

    project.objects.restore([a.objectId, note])
    expect(titled(main).sort()).toEqual(['A', 'note'])
    expect(titled(a.id)).toEqual(['Inner'])
  })
})

describe('ObjectRepository.moveToBoard', () => {
  it('nests board cards into another board, keeping their relative layout', () => {
    const main = project.mainBoardId
    const target = project.boards.create(main, 'Target', { x: 0, y: 0 })
    const a = project.boards.create(main, 'A', { x: 400, y: 100 })
    const b = project.boards.create(main, 'B', { x: 700, y: 160 })

    project.objects.moveToBoard([a.objectId, b.objectId], target.id, { x: 20, y: 30 })
    expect(titled(main)).toEqual(['Target'])
    const moved = objectsOn(target.id)
    expect(moved.map((o) => [o.board!.title, o.x, o.y])).toEqual([
      ['A', 20, 30],
      ['B', 320, 90]
    ])
    expect(project.boards.get(a.id).breadcrumb.map((c) => c.title)).toEqual(['Art', 'Target', 'A'])
  })

  it('moves plain objects and places them below existing content by default', () => {
    const main = project.mainBoardId
    const target = project.boards.create(main, 'Target')
    project.boards.create(target.id, 'Existing', { x: 0, y: 0 })
    const note = addNote(main, 900, 900)

    project.objects.moveToBoard([note], target.id)
    const moved = objectsOn(target.id).find((o) => o.id === note)!
    expect(moved).toMatchObject({ boardId: target.id, x: 0, y: 160 + 40 })
  })

  it('refuses to nest a board inside itself and changes nothing', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const note = addNote(main, 0, 0)
    expect(() => project.objects.moveToBoard([note, a.objectId], a.id)).toThrow(/inside itself/)
    expect(titled(main).sort()).toEqual(['A', 'note'])
  })
})

/** Imports a generated PNG of the given size and returns its asset id. */
async function addAsset(width: number, height: number, seed = 0): Promise<string> {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: { r: seed, g: 10, b: 20, alpha: 0.5 } }
  })
    .png()
    .toBuffer()
  return (await project.assets.importBytes(`img${seed}.png`, new Uint8Array(bytes))).id
}

describe('image sizing helpers', () => {
  it('places images at pixel size, scaled down so the longest side fits the maximum', () => {
    expect(initialImageSize(300, 200)).toEqual({ width: 300, height: 200 })
    expect(initialImageSize(4000, 1000)).toEqual({ width: MAX_INITIAL_IMAGE_SIZE, height: 200 })
    expect(initialImageSize(1000, 3000)).toEqual({ width: 266.67, height: 800 })
    // Tiny images grow to the minimum size, keeping their shape.
    expect(initialImageSize(8, 4)).toEqual({ width: MIN_OBJECT_SIZE, height: MIN_OBJECT_SIZE / 2 })
  })

  it('keeps the ratio from a width or a height, with a proportional minimum', () => {
    expect(proportionalSize(2, { width: 500, height: 999 })).toEqual({ width: 500, height: 250 })
    expect(proportionalSize(2, { height: 100 })).toEqual({ width: 200, height: 100 })
    // A thin banner can be shorter than the minimum on one side; it isn't squashed.
    expect(proportionalSize(10, { width: 100 })).toEqual({ width: 100, height: 10 })
    expect(proportionalSize(0.5, { width: 1 })).toEqual({ width: 12, height: 24 })
    expect(proportionalSize(2, { width: -40 })).toEqual({ width: 24, height: 12 })
  })

  it('lays several images out in rows', () => {
    const layout = layoutImages([
      { width: 100, height: 50 },
      { width: 200, height: 80 },
      { width: 100, height: 100 }
    ])
    expect(layout.positions).toEqual([
      { x: 0, y: 0 },
      { x: 100 + IMAGE_GAP, y: 0 },
      { x: 0, y: 80 + IMAGE_GAP }
    ])
    expect(layout).toMatchObject({ width: 300 + IMAGE_GAP, height: 180 + IMAGE_GAP })
  })
})

describe('ObjectRepository.createImages', () => {
  it('places images centred on a point, above existing objects, linked to their assets', async () => {
    const main = project.mainBoardId
    project.boards.create(main, 'Existing')
    const wide = await addAsset(1600, 800, 1)
    const small = await addAsset(100, 60, 2)
    const ids = project.objects.createImages({
      boardId: main,
      assetIds: [wide, small],
      center: { x: 0, y: 0 }
    })
    const placed = objectsOn(main).filter((o) => o.type === 'image')
    expect(placed.map((o) => o.id)).toEqual(ids)
    const [a, b] = placed
    expect(a).toMatchObject({ assetId: wide, width: 800, height: 400, rotation: 0 })
    expect(b).toMatchObject({ assetId: small, width: 100, height: 60, x: a.x + 800 + IMAGE_GAP })
    expect(a.asset).toMatchObject({ id: wide, width: 1600, height: 800, hasAlpha: true })
    // The pair is centred on the point.
    expect(a.x + (800 + IMAGE_GAP + 100) / 2).toBeCloseTo(0, 0)
    expect(a.y + 200).toBeCloseTo(0, 0)
    const card = objectsOn(main).find((o) => o.type === 'board')!
    expect(Math.min(a.zIndex, b.zIndex)).toBeGreaterThan(card.zIndex)
  })

  it('can shift right so new images don’t cover existing content', async () => {
    const main = project.mainBoardId
    project.boards.create(main, 'Existing', { x: -100, y: -100 })
    const id = await addAsset(100, 100)
    const [placed] = project.objects.createImages({
      boardId: main,
      assetIds: [id],
      center: { x: 0, y: 0 },
      avoidOverlap: true
    })
    const image = objectsOn(main).find((o) => o.id === placed)!
    expect(image.x).toBeGreaterThanOrEqual(100)
  })

  it('refuses unknown assets and leaves the board unchanged', () => {
    expect(() =>
      project.objects.createImages({
        boardId: project.mainBoardId,
        assetIds: ['missing'],
        center: { x: 0, y: 0 }
      })
    ).toThrow(/Only images/)
    expect(objectsOn(project.mainBoardId)).toEqual([])
  })
})

describe('images keep their proportions', () => {
  it('derives the height from the width (or the reverse) whatever the patch says', async () => {
    const main = project.mainBoardId
    const [id] = project.objects.createImages({
      boardId: main,
      assetIds: [await addAsset(400, 200)],
      center: { x: 0, y: 0 }
    })
    project.objects.update([{ id, width: 300, height: 999 }])
    expect(objectsOn(main)[0]).toMatchObject({ width: 300, height: 150 })
    project.objects.update([{ id, height: 50 }])
    expect(objectsOn(main)[0]).toMatchObject({ width: 100, height: 50 })
    // Rotation and position changes leave the size alone.
    project.objects.update([{ id, rotation: 30, x: 5 }])
    expect(objectsOn(main)[0]).toMatchObject({ width: 100, height: 50, rotation: 30, x: 5 })
    // No upper limit on size.
    project.objects.update([{ id, width: 20000 }])
    expect(objectsOn(main)[0]).toMatchObject({ width: 20000, height: 10000 })
  })

  it('scales instead of squashing when shrunk below the minimum', async () => {
    const main = project.mainBoardId
    const [id] = project.objects.createImages({
      boardId: main,
      assetIds: [await addAsset(1000, 100)],
      center: { x: 0, y: 0 }
    })
    project.objects.update([{ id, width: 1, height: 1 }])
    expect(objectsOn(main)[0]).toMatchObject({ width: MIN_OBJECT_SIZE, height: 2.4 })
  })

  it('still sizes board cards freely', async () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    project.objects.update([{ id: a.objectId, width: 400, height: 100 }])
    expect(objectsOn(project.mainBoardId)[0]).toMatchObject({ width: 400, height: 100 })
  })
})

describe('images share their asset when copied', () => {
  it('copies, duplicates boards and trashes images without touching the library', async () => {
    const main = project.mainBoardId
    const assetId = await addAsset(200, 100)
    const inner = project.boards.create(main, 'Inner')
    const [image] = project.objects.createImages({
      boardId: inner.id,
      assetIds: [assetId],
      center: { x: 0, y: 0 }
    })
    project.objects.update([{ id: image, rotation: 45, width: 100 }])

    // Copy the image itself, and deep-copy the board it's on.
    const [copy] = project.objects.copyTo([image], main, { x: 500, y: 0 })
    project.objects.copyTo([inner.objectId], main, { x: 0, y: 500 })

    const all = project.db.select().from(boardObjects).all()
    const images = all.filter((o) => o.type === 'image')
    expect(images).toHaveLength(3)
    expect(new Set(images.map((o) => o.assetId))).toEqual(new Set([assetId]))
    expect(images.every((o) => o.rotation === 45 && o.width === 100 && o.height === 50)).toBe(true)
    expect(project.db.select().from(assets).all()).toHaveLength(1)

    // Removing an image from a board never deletes the library file.
    project.objects.delete([copy, image])
    expect(project.db.select().from(assets).get()?.deletedAt).toBeNull()
  })
})

describe('ObjectRepository.copyTo', () => {
  it('copies objects at a new position, deep-copying boards, with fresh groups', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A', { x: 100, y: 100 })
    project.boards.create(a.id, 'Inner')
    const note = addNote(main, 300, 150)
    const group = randomUUID()
    project.objects.update([
      { id: a.objectId, groupId: group },
      { id: note, groupId: group }
    ])

    const [copyA, copyNote] = project.objects.copyTo([a.objectId, note], main, { x: 120, y: 120 })
    const all = objectsOn(main)
    const cA = all.find((o) => o.id === copyA)!
    const cNote = all.find((o) => o.id === copyNote)!
    expect(cA).toMatchObject({ x: 120, y: 120 })
    expect(cNote).toMatchObject({ x: 320, y: 170, type: 'note' })
    expect(cA.groupId).toBe(cNote.groupId)
    expect(cA.groupId).not.toBe(group)
    expect(cA.linkedBoardId).not.toBe(a.id)
    expect(titled(cA.linkedBoardId!)).toEqual(['Inner'])
    // Copies sit above the originals.
    expect(Math.min(cA.zIndex, cNote.zIndex)).toBeGreaterThan(
      Math.max(...all.filter((o) => o.id !== copyA && o.id !== copyNote).map((o) => o.zIndex))
    )
  })
})

describe('PDFs and generic files', () => {
  it('locks a PDF card to the page and lets a file card change shape without copying the file', async () => {
    const { buildPdf } = await import('./buildPdf')
    const main = project.mainBoardId
    const pdfPath = join(dir, 'a.pdf')
    writeFileSync(pdfPath, buildPdf(['Hello']))
    writeFileSync(join(dir, 'note.txt'), 'hello')
    const imported = await project.assets.importFiles([pdfPath, join(dir, 'note.txt')])
    project.objects.createFromAssets({
      boardId: main,
      assetIds: imported.imported.map((asset) => asset.id),
      center: { x: 200, y: 200 }
    })
    const placed = objectsOn(main)
    const pdf = placed.find((o) => o.type === 'document')!
    const file = placed.find((o) => o.type === 'file')!
    expect(pdf.asset).toMatchObject({ pageCount: 1, width: 300, height: 400 })
    expect(pdf.width / pdf.height).toBeCloseTo(300 / 400, 2)
    project.objects.update([{ id: pdf.id, width: 150 }])
    const resized = objectsOn(main).find((o) => o.id === pdf.id)!
    expect(resized.width).toBe(150)
    expect(resized.height).toBeCloseTo(200, 1)
    project.objects.update([{ id: file.id, width: 300, height: 180 }])
    expect(objectsOn(main).find((o) => o.id === file.id)).toMatchObject({ width: 300, height: 180 })
    project.objects.setFileAppearance(file.id, 'preview')
    expect(objectsOn(main).find((o) => o.id === file.id)?.data).toMatchObject({
      appearance: 'preview'
    })
    const [copy] = project.objects.copyTo([file.id], main, { x: 10, y: 10 })
    expect(objectsOn(main).find((o) => o.id === copy)?.assetId).toBe(file.assetId)
  })
})
