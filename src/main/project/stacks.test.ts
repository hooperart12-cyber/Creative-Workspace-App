import { existsSync } from 'node:fs'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adaptiveFrame } from '@shared/stacks'
import { rotatedCenter } from '@shared/geometry'
import { assets, boardObjects, stackSlides, taggings } from '../db/schema'
import { eq } from 'drizzle-orm'
import { Project } from './project'
import { STACK_UNDO_REFUSED } from './stacks'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-stacks-'))
  project = Project.create(dir, 'Stacks', migrations)
})
afterEach(() => {
  project?.close()
  rmSync(dir, { recursive: true, force: true })
})

async function addAsset(width: number, height: number, seed: number): Promise<string> {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: { r: seed, g: 40, b: 80, alpha: 1 } }
  })
    .png()
    .toBuffer()
  return (await project.assets.importBytes(`img${seed}.png`, new Uint8Array(bytes))).id
}

function stackOnBoard() {
  return project.stacks
    .attach(project.boards.get(project.mainBoardId))
    .objects.find((object) => object.type === 'stack')
}

describe('image stacks', () => {
  it('combines left to right, keeps the files, and restores the cards on undo', async () => {
    const left = await addAsset(80, 40, 1)
    const right = await addAsset(80, 40, 2)
    const [a, b] = project.objects.createImages({
      boardId: project.mainBoardId,
      assetIds: [left, right],
      center: { x: 0, y: 0 }
    })
    project.objects.update([
      { id: a, x: 10, y: 20 },
      { id: b, x: 200, y: 20 }
    ])
    const created = project.stacks.createFromObjects([b, a], 'combine')
    const stack = stackOnBoard()
    expect(stack?.id).toBe(created.stackId)
    expect(stack?.data.layoutCaptured).toBe(true)
    expect(stack?.slides?.map((slide) => slide.assetId)).toEqual([left, right])
    expect(
      project.boards.get(project.mainBoardId).objects.filter((object) => object.type === 'image')
    ).toHaveLength(0)
    const hidden = project.db
      .select()
      .from(boardObjects)
      .where(eq(boardObjects.type, 'image'))
      .all()
    expect(hidden.every((row) => row.deletedAt)).toBe(true)
    expect(project.db.select().from(assets).all()).toHaveLength(2)
    project.stacks.undo(created.undo)
    expect(stackOnBoard()).toBeUndefined()
    expect(
      project.boards.get(project.mainBoardId).objects.filter((object) => object.type === 'image')
    ).toHaveLength(2)
  })

  it('copies a stack without removing the cards or the saved layout', async () => {
    const left = await addAsset(40, 40, 1)
    const right = await addAsset(40, 40, 2)
    const ids = project.objects.createImages({
      boardId: project.mainBoardId,
      assetIds: [left, right],
      center: { x: 0, y: 0 }
    })
    const created = project.stacks.createFromObjects(ids, 'copy')
    expect(
      project.boards.get(project.mainBoardId).objects.filter((object) => object.type === 'image')
    ).toHaveLength(2)
    expect(stackOnBoard()?.data.layoutCaptured).toBe(false)
    expect(() => project.stacks.unstack(created.stackId, 'restore', created.revision)).toThrow(
      /no saved layout/
    )
  })

  it('keeps a one-image stack and an empty placeholder', async () => {
    const assetId = await addAsset(30, 30, 1)
    const placed = project.stacks.createFromAssets(project.mainBoardId, [assetId], { x: 50, y: 50 })
    const slideId = stackOnBoard()?.slides?.[0].id
    expect(slideId).toBeTruthy()
    project.stacks.remove(placed.stackId, slideId!, placed.revision)
    const empty = stackOnBoard()
    expect(empty?.type).toBe('stack')
    expect(empty?.slides).toEqual([])
    const fresh = project.stacks.createEmpty(project.mainBoardId, { x: 400, y: 10 })
    expect(
      project.boards
        .get(project.mainBoardId)
        .objects.filter((object) => object.id === fresh.stackId)
    ).toHaveLength(1)
  })

  it('does not change the cover when slides are reordered', async () => {
    const first = await addAsset(20, 20, 1)
    const second = await addAsset(20, 20, 2)
    const created = project.stacks.createFromAssets(project.mainBoardId, [first, second], {
      x: 0,
      y: 0
    })
    const slides = stackOnBoard()!.slides!
    const cover = project.stacks.setCover(created.stackId, slides[1].id, created.revision)
    const reordered = project.stacks.reorder(
      created.stackId,
      [slides[1].id, slides[0].id],
      cover.revision
    )
    expect(stackOnBoard()?.data.coverSlideId).toBe(slides[1].id)
    expect(stackOnBoard()?.slides?.map((slide) => slide.id)).toEqual([slides[1].id, slides[0].id])
    project.stacks.setDisplayed(created.stackId, slides[1].id, slides[0].id)
    project.stacks.undo(reordered.undo)
    expect(stackOnBoard()?.data.displayedSlideId).toBe(slides[1].id)
    expect(stackOnBoard()?.data.coverSlideId).toBe(slides[1].id)
  })

  it('refuses a stale stack edit and a display change that lost the race', async () => {
    const assetId = await addAsset(20, 20, 1)
    const other = await addAsset(20, 20, 2)
    const created = project.stacks.createFromAssets(project.mainBoardId, [assetId, other], {
      x: 0,
      y: 0
    })
    const slides = stackOnBoard()!.slides!
    expect(() =>
      project.stacks.updateSettings(created.stackId, { name: 'Late' }, created.revision + 4)
    ).toThrow(STACK_UNDO_REFUSED)
    project.stacks.setDisplayed(created.stackId, slides[1].id, slides[0].id)
    expect(() => project.stacks.setDisplayed(created.stackId, slides[0].id, slides[0].id)).toThrow(
      STACK_UNDO_REFUSED
    )
  })

  it('keeps an adaptive stack centered when the shown crop changes', async () => {
    const wide = await addAsset(200, 100, 1)
    const created = project.stacks.createFromAssets(project.mainBoardId, [wide], { x: 100, y: 80 })
    const before = stackOnBoard()!
    const adaptive = project.stacks.updateSettings(
      created.stackId,
      { sizing: 'adaptive' },
      created.revision
    )
    const slide = stackOnBoard()!.slides![0]
    project.stacks.setSlideCrop(
      created.stackId,
      slide.id,
      { x: 0, y: 0, width: 100, height: 100 },
      adaptive.revision
    )
    const after = stackOnBoard()!
    expect(rotatedCenter(after)).toEqual(rotatedCenter(before))
    expect(after.width).not.toBe(before.width)
  })

  it('crops one appearance and leaves the file and the other card alone', async () => {
    const assetId = await addAsset(100, 80, 1)
    const [first, second] = project.objects.createImages({
      boardId: project.mainBoardId,
      assetIds: [assetId, assetId],
      center: { x: 0, y: 0 }
    })
    const row = project.db.select().from(boardObjects).where(eq(boardObjects.id, first)).get()!
    const cropped = project.stacks.setImageCrop(
      first,
      { x: 10, y: 10, width: 40, height: 20 },
      row.revision
    )
    const cards = project.boards.get(project.mainBoardId).objects
    const changed = cards.find((object) => object.id === first)!
    const untouched = cards.find((object) => object.id === second)!
    expect(changed.data.crop).toEqual({ x: 10, y: 10, width: 40, height: 20 })
    expect(changed.width).toBe(row.width)
    expect(untouched.data.crop).toBeUndefined()
    const stored = project.db.select().from(assets).where(eq(assets.id, assetId)).get()!
    expect(stored.width).toBe(100)
    expect(existsSync(project.assets.originalPath(stored.sha256, stored.ext))).toBe(true)
    project.stacks.undoImageCrop(cropped.undo)
    expect(
      project.boards.get(project.mainBoardId).objects.find((object) => object.id === first)?.data
        .crop
    ).toBeNull()
  })

  it('keeps the slide crop when separating here and the earlier card crop when restoring layout', async () => {
    const assetId = await addAsset(100, 100, 3)
    const [card] = project.objects.createImages({
      boardId: project.mainBoardId,
      assetIds: [assetId],
      center: { x: 0, y: 0 }
    })
    const extra = await addAsset(40, 40, 4)
    const [other] = project.objects.createImages({
      boardId: project.mainBoardId,
      assetIds: [extra],
      center: { x: 300, y: 0 }
    })
    const row = project.db.select().from(boardObjects).where(eq(boardObjects.id, card)).get()!
    project.stacks.setImageCrop(card, { x: 0, y: 0, width: 50, height: 50 }, row.revision)
    const created = project.stacks.createFromObjects([card, other], 'combine')
    const slide = stackOnBoard()!.slides!.find((item) => item.assetId === assetId)!
    project.stacks.setSlideCrop(
      created.stackId,
      slide.id,
      { x: 10, y: 10, width: 20, height: 30 },
      created.revision
    )
    const separated = project.stacks.unstack(created.stackId, 'separate', created.revision + 1)
    const withCrop = project.boards
      .get(project.mainBoardId)
      .objects.find((object) => object.assetId === assetId)
    expect(withCrop?.data.crop).toEqual({ x: 10, y: 10, width: 20, height: 30 })
    project.stacks.undo(separated.undo)
    const restored = project.stacks.unstack(created.stackId, 'restore', created.revision + 1)
    const revived = project.boards
      .get(project.mainBoardId)
      .objects.find((object) => object.id === card)
    expect(revived?.data.crop).toEqual({ x: 0, y: 0, width: 50, height: 50 })
    expect(restored.undo.op).toBe('content')
  })

  it('matches a slide through its own tag and the parent stack, not a sibling', async () => {
    const first = await addAsset(16, 16, 1)
    const second = await addAsset(16, 16, 2)
    const created = project.stacks.createFromAssets(project.mainBoardId, [first, second], {
      x: 0,
      y: 0
    })
    const slides = stackOnBoard()!.slides!
    const opu = project.tags.createReusable('OPU')
    const approved = project.tags.createReusable('Approved')
    const draft = project.tags.createReusable('Draft')
    project.tags.assign(opu.id, { type: 'object', id: created.stackId })
    project.tags.assign(approved.id, { type: 'slide', id: slides[0].id })
    project.tags.assign(draft.id, { type: 'slide', id: slides[1].id })
    const both = project.search.searchPage({
      tags: { included: [opu.id, approved.id], mode: 'all', excluded: [] },
      tagMatch: 'effective',
      filter: 'image'
    })
    expect(both.hits.some((hit) => hit.kind === 'slide' && hit.slideId === slides[0].id)).toBe(true)
    expect(both.hits.some((hit) => hit.slideId === slides[1].id)).toBe(false)
    const siblings = project.search.searchPage({
      tags: { included: [draft.id, approved.id], mode: 'all', excluded: [] },
      tagMatch: 'effective',
      filter: 'image'
    })
    expect(siblings.hits.filter((hit) => hit.kind === 'slide')).toHaveLength(0)
    const direct = project.search.searchPage({
      tags: { included: [opu.id, approved.id], mode: 'all', excluded: [] },
      tagMatch: 'direct',
      filter: 'image'
    })
    expect(direct.hits.some((hit) => hit.kind === 'slide')).toBe(false)
  })

  it('names the parent stack on a slide hit when the stack itself did not match', async () => {
    const first = await addAsset(16, 16, 1)
    const second = await addAsset(16, 16, 2)
    const created = project.stacks.createFromAssets(project.mainBoardId, [first, second], {
      x: 0,
      y: 0
    })
    project.stacks.updateSettings(created.stackId, { name: 'Heroes' }, created.revision)
    const slideId = stackOnBoard()!.slides![0].id
    const approved = project.tags.createReusable('Approved')
    project.tags.assign(approved.id, { type: 'slide', id: slideId })
    const page = project.search.searchPage({
      tags: { included: [approved.id], mode: 'all', excluded: [] },
      tagMatch: 'direct',
      filter: 'image'
    })
    const slide = page.hits.find((hit) => hit.kind === 'slide')
    expect(slide?.slideId).toBe(slideId)
    expect(slide?.stackTitle).toBe('Heroes')
    expect(page.hits.some((hit) => hit.kind === 'stack')).toBe(false)
  })

  it('keeps a file that only a stack slide still uses', async () => {
    const assetId = await addAsset(12, 12, 9)
    project.stacks.createFromAssets(project.mainBoardId, [assetId], { x: 0, y: 0 })
    const entry = project.library.list({ folderId: null, scope: 'project' }).entries[0]
    const stored = project.db.select().from(assets).where(eq(assets.id, assetId)).get()!
    project.library.trash([entry.id])
    project.library.purge({ entries: [entry.id], folders: [], objects: [] })
    expect(
      project.db.select().from(assets).where(eq(assets.id, assetId)).get()?.deletedAt
    ).toBeNull()
    expect(existsSync(project.assets.originalPath(stored.sha256, stored.ext))).toBe(true)
    expect(project.db.select().from(stackSlides).all()).toHaveLength(1)
  })

  it('returns to the cover when the project opens with remember-last off', async () => {
    const first = await addAsset(10, 10, 1)
    const second = await addAsset(10, 10, 2)
    const created = project.stacks.createFromAssets(project.mainBoardId, [first, second], {
      x: 0,
      y: 0
    })
    const slides = stackOnBoard()!.slides!
    project.stacks.setDisplayed(created.stackId, slides[1].id, slides[0].id)
    const path = project.path
    project.close()
    project = await Project.open(path, migrations)
    const reopened = stackOnBoard()
    expect(reopened?.data.displayedSlideId).toBe(reopened?.data.coverSlideId)
    expect(reopened?.data.coverSlideId).toBe(slides[0].id)
  })

  it('copies stack and slide tags onto a duplicated stack', async () => {
    const assetId = await addAsset(10, 10, 1)
    const created = project.stacks.createFromAssets(project.mainBoardId, [assetId], { x: 0, y: 0 })
    const slideId = stackOnBoard()!.slides![0].id
    const stackTag = project.tags.createReusable('Group')
    const slideTag = project.tags.createReusable('Frame')
    project.tags.assign(stackTag.id, { type: 'object', id: created.stackId })
    project.tags.assign(slideTag.id, { type: 'slide', id: slideId })
    const board = project.boards.create(project.mainBoardId, 'Other')
    const [copyId] = project.objects.copyTo([created.stackId], board.id, { x: 10, y: 10 })
    const copied = project.stacks.attach(project.boards.get(board.id)).objects[0]
    expect(copied.type).toBe('stack')
    const stackTags = project.db.select().from(taggings).where(eq(taggings.targetId, copyId)).all()
    const slideTags = project.db
      .select()
      .from(taggings)
      .where(eq(taggings.targetId, copied.slides![0].id))
      .all()
    expect(stackTags.map((row) => row.tagId)).toEqual([stackTag.id])
    expect(slideTags.map((row) => row.tagId)).toEqual([slideTag.id])
    expect(copied.data.layoutCaptured).toBe(false)
  })
})

describe('adaptiveFrame', () => {
  it('keeps the rotated center and the previous scale', () => {
    const object = { x: 40, y: 20, width: 200, height: 100, rotation: 30 }
    const next = adaptiveFrame(object, 200, 100, 100, 24)
    const before = rotatedCenter(object)
    const after = rotatedCenter({ ...object, ...next })
    expect(Math.abs(after.x - before.x)).toBeLessThan(0.02)
    expect(Math.abs(after.y - before.y)).toBeLessThan(0.02)
    expect(next.width).toBe(100)
    expect(next.height).toBe(100)
  })
})
