import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { cropAspect, cropOf, cropPixels, normalizeCrop, type ImageCrop } from '@shared/crop'
import {
  adaptiveFrame,
  EMPTY_STACK_SIZE,
  settingsData,
  stackSettings,
  type StackSettings
} from '@shared/stacks'
import type {
  BoardDetail,
  CommentShift,
  Point,
  StackContentSnapshot,
  StackResult,
  StackSlide,
  StackSlideSnapshot,
  StackUndo,
  TagAssignment
} from '@shared/types'
import type { ProjectDb } from '../db/client'
import { assets, boardObjects, stackSlides, taggings, tags } from '../db/schema'
import { toAssetInfo } from './assets'
import { deletionTime, type BoardRepository } from './boards'
import { invertCommentShifts, shiftComments } from './commentTransfer'
import { tagNameParts } from './tagNames'

export const STACK_UNDO_REFUSED =
  'This stack was changed in another window. This undo was not applied.'

const MIN_SIZE = 24
const MAX_INITIAL = 800
const GAP = 24

type ObjectRow = typeof boardObjects.$inferSelect
type SlideRow = typeof stackSlides.$inferSelect
type AssetRow = typeof assets.$inferSelect

interface ImageCard {
  row: ObjectRow
  asset: AssetRow
}

/**
 * Image stacks (§9) and appearance crops. The original file is never written.
 * Content edits name the revision they were based on and are refused when another
 * window has written since.
 */
export class StackRepository {
  constructor(
    private readonly db: ProjectDb,
    private readonly boards: BoardRepository
  ) {}

  /** On project open, stacks that do not remember the last slide return to their cover. */
  normalizeDisplayed(): void {
    this.db.run(sql`
      UPDATE board_objects
      SET data = json_set(data, '$.displayedSlideId', json_extract(data, '$.coverSlideId')),
          updated_at = ${Date.now()}
      WHERE type = 'stack' AND deleted_at IS NULL
        AND ifnull(json_extract(data, '$.rememberLast'), 0) = 0
        AND ifnull(json_extract(data, '$.displayedSlideId'), '')
          != ifnull(json_extract(data, '$.coverSlideId'), '')
    `)
  }

  attach(detail: BoardDetail): BoardDetail {
    const stackIds = detail.objects
      .filter((object) => object.type === 'stack')
      .map((object) => object.id)
    if (stackIds.length === 0) return detail
    const rows = this.db
      .select()
      .from(stackSlides)
      .where(inArray(stackSlides.stackId, stackIds))
      .orderBy(asc(stackSlides.position))
      .all()
    const assetIds = [...new Set(rows.map((row) => row.assetId))]
    const assetRows = assetIds.length
      ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
      : []
    const assetById = new Map(assetRows.map((row) => [row.id, row]))
    const byStack = new Map<string, StackSlide[]>()
    for (const row of rows) {
      const asset = assetById.get(row.assetId)
      const slide: StackSlide = {
        id: row.id,
        assetId: row.assetId,
        position: row.position,
        crop: cropFromRow(row),
        asset: asset && !asset.deletedAt ? toAssetInfo(asset) : undefined
      }
      const list = byStack.get(row.stackId) ?? []
      list.push(slide)
      byStack.set(row.stackId, list)
    }
    return {
      ...detail,
      objects: detail.objects.map((object) =>
        object.type === 'stack' ? { ...object, slides: byStack.get(object.id) ?? [] } : object
      )
    }
  }

  createEmpty(boardId: string, at: Point): StackResult {
    this.boards.require(boardId)
    const id = randomUUID()
    const now = new Date()
    this.db
      .insert(boardObjects)
      .values({
        id,
        boardId,
        type: 'stack',
        x: at.x,
        y: at.y,
        ...EMPTY_STACK_SIZE,
        zIndex: this.boards.topZ(boardId) + 1,
        revision: 1,
        data: settingsData(blankSettings()),
        createdAt: now,
        updatedAt: now
      })
      .run()
    return {
      stackId: id,
      revision: 1,
      createdIds: [],
      removedIds: [],
      undo: { op: 'create', stackId: id, revision: 1, removedIds: [] }
    }
  }

  createFromObjects(objectIds: string[], mode: 'combine' | 'copy'): StackResult {
    const cards = this.imageCards(objectIds)
    if (cards.length < 2) throw new Error('Select at least two images.')
    if (cards.some((card) => card.row.locked))
      throw new Error('Unlock the images before stacking them.')
    const boardIds = new Set(cards.map((card) => card.row.boardId))
    if (boardIds.size !== 1) throw new Error('Stack images from the same board.')
    const ordered = readingOrder(cards)
    return this.insertStack({
      boardId: ordered[0].row.boardId,
      slides: ordered.map((card) => ({
        asset: card.asset,
        crop: cropOf(card.row.data),
        source: card.row,
        tagsFrom: { type: 'object' as const, id: card.row.id }
      })),
      frame:
        mode === 'combine'
          ? frameOf(ordered[0].row)
          : {
              x: Math.max(...ordered.map((card) => card.row.x + card.row.width)) + GAP,
              y: ordered[0].row.y,
              width: ordered[0].row.width,
              height: ordered[0].row.height
            },
      layoutCaptured: mode === 'combine',
      removeIds: mode === 'combine' ? ordered.map((card) => card.row.id) : []
    })
  }

  createFromAssets(boardId: string, assetIds: string[], at: Point): StackResult {
    this.boards.require(boardId)
    const images = assetIds.map((id) => this.requireImage(id))
    if (images.length === 0) throw new Error('Choose an image.')
    const first = fitAsset(images[0])
    return this.insertStack({
      boardId,
      slides: images.map((asset) => ({ asset, crop: null, source: null, tagsFrom: null })),
      frame: { x: at.x - first.width / 2, y: at.y - first.height / 2, ...first },
      layoutCaptured: false,
      removeIds: []
    })
  }

  add(input: {
    stackId: string
    expectedRevision: number
    assetIds?: string[]
    objectIds?: string[]
    mode: 'move' | 'copy'
  }): StackResult {
    const row = this.requireStack(input.stackId)
    const before = this.capture(row)
    const existing = this.slideRows(row.id)
    const additions: SlideSeed[] = []
    for (const assetId of input.assetIds ?? []) {
      additions.push({
        asset: this.requireImage(assetId),
        crop: null,
        source: null,
        tagsFrom: null
      })
    }
    const cards = input.objectIds?.length ? this.imageCards(input.objectIds) : []
    if (cards.some((card) => card.row.locked)) throw new Error('Unlock the image before adding it.')
    for (const card of readingOrder(cards)) {
      additions.push({
        asset: card.asset,
        crop: cropOf(card.row.data),
        source: null,
        tagsFrom: { type: 'object', id: card.row.id }
      })
    }
    if (additions.length === 0) throw new Error('Choose an image to add.')
    const removeIds = input.mode === 'move' ? cards.map((card) => card.row.id) : []
    const settings = stackSettings(row.data)
    const wasEmpty = existing.length === 0
    if (wasEmpty) {
      settings.coverSlideId = null
      settings.displayedSlideId = null
    }
    const first = additions[0]
    const pixels = cropPixels(first.crop, first.asset.width!, first.asset.height!)
    return this.persist({
      row,
      expected: input.expectedRevision,
      settings,
      seeds: [...existing.map(rowToSeed), ...additions],
      assignNewIds: true,
      removeIds,
      createdIds: [],
      revivedIds: [],
      geometry:
        wasEmpty && settings.sizing === 'adaptive'
          ? adaptiveFrame(row, 0, pixels.width, pixels.height, MIN_SIZE)
          : null,
      before
    })
  }

  remove(stackId: string, slideId: string, expectedRevision: number): StackResult {
    const row = this.requireStack(stackId)
    const before = this.capture(row)
    const slides = this.slideRows(stackId).filter((slide) => slide.id !== slideId)
    if (slides.length === before.slides.length) throw new Error('That image is not in the stack.')
    const settings = withoutSlide(stackSettings(row.data), slideId, slides[0]?.id ?? null)
    return this.db.transaction(() => {
      const saved = this.persist({
        row,
        expected: expectedRevision,
        settings,
        seeds: slides.map(rowToSeed),
        assignNewIds: false,
        removeIds: [],
        createdIds: [],
        revivedIds: [],
        geometry: this.geometryAfter(row, settings, slides),
        before
      })
      const extra: CommentShift[] = [{ op: 'detach-slide', slideId }]
      shiftComments(this.db, extra)
      return attachCommentShifts(this.resultFrom(stackId, before, [], [], true), [
        ...shiftsOf(saved),
        ...extra
      ])
    })
  }

  extract(stackId: string, slideId: string, expectedRevision: number): StackResult {
    return this.db.transaction(() => {
      const row = this.requireStack(stackId)
      const slide = this.slideRows(stackId).find((item) => item.id === slideId)
      if (!slide) throw new Error('That image is not in the stack.')
      const asset = this.requireImage(slide.assetId)
      const before = this.capture(row)
      const crop = cropFromRow(slide)
      const aspect = cropAspect(crop, asset.width!, asset.height!)
      const size = fitWidth(aspect, row.width)
      const cardId = randomUUID()
      const now = new Date()
      const count = this.slideRows(stackId).length
      this.db
        .insert(boardObjects)
        .values({
          id: cardId,
          boardId: row.boardId,
          type: 'image',
          assetId: asset.id,
          x: row.x + GAP,
          y: row.y + row.height + GAP * Math.max(1, count),
          ...size,
          rotation: row.rotation,
          zIndex: this.boards.topZ(row.boardId) + 1,
          data: crop ? { crop } : {},
          createdAt: now,
          updatedAt: now
        })
        .run()
      this.copyTags('slide', slide.id, 'object', cardId)
      const remaining = this.slideRows(stackId).filter((item) => item.id !== slideId)
      const settings = withoutSlide(stackSettings(row.data), slideId, remaining[0]?.id ?? null)
      const saved = this.persist({
        row,
        expected: expectedRevision,
        settings,
        seeds: remaining.map(rowToSeed),
        assignNewIds: false,
        removeIds: [],
        createdIds: [cardId],
        revivedIds: [],
        geometry: this.geometryAfter(row, settings, remaining),
        before
      })
      const extra: CommentShift[] = [
        { op: 'slide-to-object', stackId: row.id, slideId, objectId: cardId }
      ]
      shiftComments(this.db, extra)
      return attachCommentShifts(this.resultFrom(stackId, before, [], [cardId], true), [
        ...shiftsOf(saved),
        ...extra
      ])
    })
  }

  reorder(stackId: string, slideIds: string[], expectedRevision: number): StackResult {
    const row = this.requireStack(stackId)
    const before = this.capture(row)
    const current = this.slideRows(stackId)
    if (
      slideIds.length !== current.length ||
      current.some((slide) => !slideIds.includes(slide.id))
    ) {
      throw new Error('The stack order is out of date.')
    }
    const byId = new Map(current.map((slide) => [slide.id, slide]))
    const settings = stackSettings(row.data)
    this.persist({
      row,
      expected: expectedRevision,
      settings,
      seeds: slideIds.map((id) => rowToSeed(byId.get(id)!)),
      assignNewIds: false,
      removeIds: [],
      createdIds: [],
      revivedIds: [],
      geometry: null,
      before
    })
    return this.resultFrom(stackId, before, [], [], false)
  }

  setCover(stackId: string, slideId: string, expectedRevision: number): StackResult {
    const row = this.requireStack(stackId)
    const before = this.capture(row)
    if (!before.slides.some((slide) => slide.id === slideId)) {
      throw new Error('That image is not in the stack.')
    }
    const settings = { ...stackSettings(row.data), coverSlideId: slideId }
    this.persist({
      row,
      expected: expectedRevision,
      settings,
      seeds: this.slideRows(stackId).map(rowToSeed),
      assignNewIds: false,
      removeIds: [],
      createdIds: [],
      revivedIds: [],
      geometry: null,
      before
    })
    return this.resultFrom(stackId, before, [], [], false)
  }

  /**
   * Changes the canvas image without bumping the content revision.
   * Refused when the canvas is no longer showing `expectedShown`.
   */
  setDisplayed(stackId: string, slideId: string | null, expectedShown: string | null): void {
    const row = this.requireStack(stackId)
    const settings = stackSettings(row.data)
    if (settings.displayedSlideId !== expectedShown) throw new Error(STACK_UNDO_REFUSED)
    const slides = this.slideRows(stackId)
    if (slideId && !slides.some((slide) => slide.id === slideId)) {
      throw new Error('That image is not in the stack.')
    }
    const next = { ...settings, displayedSlideId: slideId }
    const geometry = next.sizing === 'adaptive' ? this.geometryAfter(row, next, slides) : null
    const result = this.db
      .update(boardObjects)
      .set({
        data: settingsData(next),
        ...(geometry ?? {}),
        updatedAt: new Date()
      })
      .where(
        and(
          eq(boardObjects.id, stackId),
          eq(boardObjects.revision, row.revision),
          isNull(boardObjects.deletedAt)
        )
      )
      .run()
    if (result.changes !== 1) throw new Error(STACK_UNDO_REFUSED)
  }

  updateSettings(
    stackId: string,
    patch: { sizing?: StackSettings['sizing']; rememberLast?: boolean; name?: string | null },
    expectedRevision: number
  ): StackResult {
    const row = this.requireStack(stackId)
    const before = this.capture(row)
    const settings = stackSettings(row.data)
    if (patch.sizing) settings.sizing = patch.sizing
    if (patch.rememberLast != null) settings.rememberLast = patch.rememberLast
    if (patch.name !== undefined) settings.name = patch.name?.trim().slice(0, 80) || null
    const slides = this.slideRows(stackId)
    this.persist({
      row,
      expected: expectedRevision,
      settings,
      seeds: slides.map(rowToSeed),
      assignNewIds: false,
      removeIds: [],
      createdIds: [],
      revivedIds: [],
      geometry: patch.sizing ? this.geometryAfter(row, settings, slides) : null,
      before
    })
    return this.resultFrom(stackId, before, [], [], patch.sizing != null)
  }

  unstack(stackId: string, mode: 'separate' | 'restore', expectedRevision: number): StackResult {
    const row = this.requireStack(stackId)
    const before = this.capture(row)
    const slides = this.slideRows(stackId)
    const settings = stackSettings(row.data)
    if (mode === 'restore') {
      if (!settings.layoutCaptured) throw new Error('This stack has no saved layout to restore.')
      const shifts = commentShiftsForRestore(stackId, slides)
      this.db.transaction(() => {
        this.reviveLayouts(slides)
        shiftComments(this.db, shifts)
        this.markDeleted(row, expectedRevision)
      })
      return {
        stackId,
        revision: expectedRevision + 1,
        createdIds: [],
        removedIds: [],
        undo: {
          op: 'content',
          stackId,
          revision: expectedRevision + 1,
          before,
          removedIds: [],
          createdIds: [],
          applyGeometry: false,
          revivedIds: slides
            .map((slide) => slide.sourceObjectId)
            .filter((id): id is string => !!id),
          ...(shifts.length ? { commentShifts: shifts } : {})
        }
      }
    }
    const separated = this.db.transaction(() => {
      const ids: string[] = []
      const shifts: CommentShift[] = []
      slides.forEach((slide, index) => {
        const cardId = this.extractCard(row, slide, index)
        ids.push(cardId)
        shifts.push({ op: 'slide-to-object', stackId, slideId: slide.id, objectId: cardId })
      })
      shifts.push({ op: 'detach-stack', stackId })
      shiftComments(this.db, shifts)
      this.markDeleted(row, expectedRevision)
      return { ids, shifts }
    })
    const createdIds = separated.ids
    return {
      stackId,
      revision: expectedRevision + 1,
      createdIds,
      removedIds: [],
      undo: {
        op: 'content',
        stackId,
        revision: expectedRevision + 1,
        before,
        removedIds: [],
        createdIds,
        applyGeometry: false,
        revivedIds: [],
        commentShifts: separated.shifts
      }
    }
  }

  setSlideCrop(
    stackId: string,
    slideId: string,
    crop: ImageCrop | null,
    expectedRevision: number
  ): StackResult {
    const row = this.requireStack(stackId)
    const before = this.capture(row)
    const slides = this.slideRows(stackId)
    const slide = slides.find((item) => item.id === slideId)
    if (!slide) throw new Error('That image is not in the stack.')
    const asset = this.requireImage(slide.assetId)
    const nextCrop = normalizeCrop(crop, asset.width!, asset.height!)
    const seeds = slides.map((item) =>
      item.id === slideId ? { ...rowToSeed(item), crop: nextCrop } : rowToSeed(item)
    )
    const settings = stackSettings(row.data)
    const displayed = settings.displayedSlideId === slideId
    this.persist({
      row,
      expected: expectedRevision,
      settings,
      seeds,
      assignNewIds: false,
      removeIds: [],
      createdIds: [],
      revivedIds: [],
      geometry: displayed ? this.geometryAfter(row, settings, slides, slideId, nextCrop) : null,
      before
    })
    return this.resultFrom(stackId, before, [], [], displayed && settings.sizing === 'adaptive')
  }

  setImageCrop(objectId: string, crop: ImageCrop | null, expectedRevision: number): ImageCropUndo {
    const row = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.id, objectId), isNull(boardObjects.deletedAt)))
      .get()
    if (!row || row.type !== 'image' || !row.assetId)
      throw new Error('That image is no longer on the board.')
    const asset = this.requireImage(row.assetId)
    const next = normalizeCrop(crop, asset.width!, asset.height!)
    const aspect = cropAspect(next, asset.width!, asset.height!)
    const size = fitWidth(aspect, row.width)
    const result = this.db
      .update(boardObjects)
      .set({
        data: { ...row.data, crop: next },
        ...size,
        revision: expectedRevision + 1,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(boardObjects.id, objectId),
          eq(boardObjects.revision, expectedRevision),
          isNull(boardObjects.deletedAt)
        )
      )
      .run()
    if (result.changes !== 1) throw new Error(STACK_UNDO_REFUSED)
    return {
      revision: expectedRevision + 1,
      undo: {
        objectId,
        revision: expectedRevision + 1,
        crop: cropOf(row.data),
        width: row.width,
        height: row.height
      }
    }
  }

  undoImageCrop(undo: ImageCropUndo['undo']): void {
    const row = this.db.select().from(boardObjects).where(eq(boardObjects.id, undo.objectId)).get()
    if (!row || row.revision !== undo.revision) throw new Error(STACK_UNDO_REFUSED)
    const result = this.db
      .update(boardObjects)
      .set({
        data: { ...row.data, crop: undo.crop },
        width: undo.width,
        height: undo.height,
        revision: undo.revision - 1,
        updatedAt: new Date()
      })
      .where(and(eq(boardObjects.id, undo.objectId), eq(boardObjects.revision, undo.revision)))
      .run()
    if (result.changes !== 1) throw new Error(STACK_UNDO_REFUSED)
  }

  undo(packet: StackUndo): void {
    if (packet.op === 'display') {
      this.setDisplayed(packet.stackId, packet.previous, packet.shown)
      return
    }
    if (packet.op === 'create') {
      this.undoCreate(packet)
      return
    }
    this.undoContent(packet)
  }

  private undoCreate(packet: Extract<StackUndo, { op: 'create' }>): void {
    this.db.transaction(() => {
      const row = this.db
        .select()
        .from(boardObjects)
        .where(eq(boardObjects.id, packet.stackId))
        .get()
      if (!row || row.revision !== packet.revision) throw new Error(STACK_UNDO_REFUSED)
      if (packet.commentShifts?.length)
        shiftComments(this.db, invertCommentShifts(packet.commentShifts))
      this.db.delete(boardObjects).where(eq(boardObjects.id, packet.stackId)).run()
      this.restoreObjects(packet.removedIds)
    })
  }

  private undoContent(packet: Extract<StackUndo, { op: 'content' }>): void {
    this.db.transaction(() => {
      const row = this.db
        .select()
        .from(boardObjects)
        .where(eq(boardObjects.id, packet.stackId))
        .get()
      if (!row || row.revision !== packet.revision) throw new Error(STACK_UNDO_REFUSED)
      if (packet.commentShifts?.length)
        shiftComments(this.db, invertCommentShifts(packet.commentShifts))
      const live = stackSettings(row.data)
      const restored = packet.before.settings
      const displayedSlideId =
        live.displayedSlideId &&
        packet.before.slides.some((slide) => slide.id === live.displayedSlideId)
          ? live.displayedSlideId
          : restored.coverSlideId
      const result = this.db
        .update(boardObjects)
        .set({
          deletedAt: null,
          revision: packet.before.revision,
          data: settingsData({ ...restored, displayedSlideId }),
          ...(packet.applyGeometry ? packet.before.geometry : {}),
          updatedAt: new Date()
        })
        .where(and(eq(boardObjects.id, packet.stackId), eq(boardObjects.revision, packet.revision)))
        .run()
      if (result.changes !== 1) throw new Error(STACK_UNDO_REFUSED)
      this.writeSlides(packet.stackId, packet.before.slides.map(snapshotToSeed))
      for (const slide of packet.before.slides) this.replaceTags('slide', slide.id, slide.tags)
      const now = deletionTime()
      for (const id of [...packet.createdIds, ...(packet.revivedIds ?? [])]) {
        this.db
          .update(boardObjects)
          .set({ deletedAt: now, updatedAt: new Date() })
          .where(eq(boardObjects.id, id))
          .run()
      }
    })
  }

  private insertStack(input: {
    boardId: string
    slides: SlideSeed[]
    frame: { x: number; y: number; width: number; height: number }
    layoutCaptured: boolean
    removeIds: string[]
  }): StackResult {
    const id = randomUUID()
    const slideIds = input.slides.map(() => randomUUID())
    const shifts = commentShiftsForSlides(id, input.slides, slideIds, input.removeIds)
    const settings: StackSettings = {
      ...blankSettings(),
      coverSlideId: slideIds[0] ?? null,
      displayedSlideId: slideIds[0] ?? null,
      layoutCaptured: input.layoutCaptured
    }
    const now = new Date()
    this.db.transaction(() => {
      this.db
        .insert(boardObjects)
        .values({
          id,
          boardId: input.boardId,
          type: 'stack',
          ...input.frame,
          zIndex: this.boards.topZ(input.boardId) + 1,
          revision: 1,
          data: settingsData(settings),
          createdAt: now,
          updatedAt: now
        })
        .run()
      input.slides.forEach((seed, index) => {
        this.insertSlide(id, slideIds[index], seed, index)
        if (seed.tagsFrom)
          this.copyTags(seed.tagsFrom.type, seed.tagsFrom.id, 'slide', slideIds[index])
      })
      if (input.removeIds.length) {
        const deletedAt = deletionTime()
        this.db
          .update(boardObjects)
          .set({ deletedAt, updatedAt: now })
          .where(inArray(boardObjects.id, input.removeIds))
          .run()
      }
      shiftComments(this.db, shifts)
    })
    return {
      stackId: id,
      revision: 1,
      createdIds: [],
      removedIds: input.removeIds,
      undo: {
        op: 'create',
        stackId: id,
        revision: 1,
        removedIds: input.removeIds,
        ...(shifts.length ? { commentShifts: shifts } : {})
      }
    }
  }

  private persist(input: {
    row: ObjectRow
    expected: number
    settings: StackSettings
    seeds: SlideSeed[]
    assignNewIds: boolean
    removeIds: string[]
    createdIds: string[]
    revivedIds: string[]
    geometry: { x: number; y: number; width: number; height: number } | null
    before: StackContentSnapshot
  }): StackResult {
    const slideIds = input.seeds.map((seed) =>
      input.assignNewIds && !seed.existingId ? randomUUID() : seed.existingId!
    )
    const shifts = commentShiftsForSlides(input.row.id, input.seeds, slideIds, input.removeIds)
    const settings = { ...input.settings }
    if (!settings.coverSlideId) settings.coverSlideId = slideIds[0] ?? null
    if (!settings.displayedSlideId) settings.displayedSlideId = settings.coverSlideId
    this.db.transaction(() => {
      const result = this.db
        .update(boardObjects)
        .set({
          revision: input.expected + 1,
          data: settingsData(settings),
          ...(input.geometry ?? {}),
          updatedAt: new Date()
        })
        .where(
          and(
            eq(boardObjects.id, input.row.id),
            eq(boardObjects.revision, input.expected),
            isNull(boardObjects.deletedAt)
          )
        )
        .run()
      if (result.changes !== 1) throw new Error(STACK_UNDO_REFUSED)
      this.writeSlides(
        input.row.id,
        input.seeds.map((seed, index) => ({ ...seed, existingId: slideIds[index] }))
      )
      input.seeds.forEach((seed, index) => {
        if (!seed.existingId && seed.tagsFrom) {
          this.copyTags(seed.tagsFrom.type, seed.tagsFrom.id, 'slide', slideIds[index])
        }
      })
      if (input.removeIds.length) {
        const deletedAt = deletionTime()
        this.db
          .update(boardObjects)
          .set({ deletedAt, updatedAt: new Date() })
          .where(inArray(boardObjects.id, input.removeIds))
          .run()
      }
      shiftComments(this.db, shifts)
    })
    const geometryChanged = !!input.geometry
    return {
      stackId: input.row.id,
      revision: input.expected + 1,
      createdIds: input.createdIds,
      removedIds: input.removeIds,
      undo: {
        op: 'content',
        stackId: input.row.id,
        revision: input.expected + 1,
        before: input.before,
        removedIds: input.removeIds,
        createdIds: input.createdIds,
        applyGeometry: geometryChanged,
        revivedIds: input.revivedIds,
        ...(shifts.length ? { commentShifts: shifts } : {})
      }
    }
  }

  /** Re-reads the stack after persist so the undo packet matches what was written. */
  private resultFrom(
    stackId: string,
    before: StackContentSnapshot,
    removedIds: string[],
    createdIds: string[],
    geometryMayChange: boolean
  ): StackResult {
    const row = this.db.select().from(boardObjects).where(eq(boardObjects.id, stackId)).get()!
    const geometryChanged =
      geometryMayChange &&
      (row.x !== before.geometry.x ||
        row.y !== before.geometry.y ||
        row.width !== before.geometry.width ||
        row.height !== before.geometry.height)
    return {
      stackId,
      revision: row.revision,
      createdIds,
      removedIds,
      undo: {
        op: 'content',
        stackId,
        revision: row.revision,
        before,
        removedIds,
        createdIds,
        applyGeometry: geometryChanged,
        revivedIds: []
      }
    }
  }

  private writeSlides(stackId: string, seeds: SlideSeed[]): void {
    const current = this.slideRows(stackId)
    const keep = new Set(seeds.map((seed) => seed.existingId).filter((id): id is string => !!id))
    for (const row of current) {
      if (!keep.has(row.id)) this.db.delete(stackSlides).where(eq(stackSlides.id, row.id)).run()
    }
    const now = new Date()
    seeds.forEach((seed, index) => {
      const id = seed.existingId ?? randomUUID()
      const values = slideValues(stackId, id, seed, index, now)
      const found = current.some((row) => row.id === id)
      if (found) {
        this.db.update(stackSlides).set(values).where(eq(stackSlides.id, id)).run()
      } else {
        this.db
          .insert(stackSlides)
          .values({ ...values, id, createdAt: now })
          .run()
      }
    })
  }

  private insertSlide(stackId: string, id: string, seed: SlideSeed, index: number): void {
    const now = new Date()
    this.db
      .insert(stackSlides)
      .values({ ...slideValues(stackId, id, seed, index, now), id, createdAt: now })
      .run()
  }

  private markDeleted(row: ObjectRow, expected: number): void {
    const result = this.db
      .update(boardObjects)
      .set({ deletedAt: deletionTime(), revision: expected + 1, updatedAt: new Date() })
      .where(
        and(
          eq(boardObjects.id, row.id),
          eq(boardObjects.revision, expected),
          isNull(boardObjects.deletedAt)
        )
      )
      .run()
    if (result.changes !== 1) throw new Error(STACK_UNDO_REFUSED)
  }

  private reviveLayouts(slides: SlideRow[]): void {
    const now = new Date()
    for (const slide of slides) {
      if (
        slide.sourceObjectId == null ||
        slide.layoutX == null ||
        slide.layoutY == null ||
        slide.layoutWidth == null ||
        slide.layoutHeight == null
      ) {
        throw new Error('This stack has no saved layout to restore.')
      }
      const card = this.db
        .select()
        .from(boardObjects)
        .where(eq(boardObjects.id, slide.sourceObjectId))
        .get()
      if (!card?.deletedAt) throw new Error('The original cards are no longer available.')
      const layoutCrop = cropFromLayout(slide)
      this.db
        .update(boardObjects)
        .set({
          deletedAt: null,
          x: slide.layoutX,
          y: slide.layoutY,
          width: slide.layoutWidth,
          height: slide.layoutHeight,
          rotation: slide.layoutRotation ?? 0,
          data: { ...card.data, crop: layoutCrop },
          updatedAt: now
        })
        .where(eq(boardObjects.id, slide.sourceObjectId))
        .run()
    }
  }

  private extractCard(stack: ObjectRow, slide: SlideRow, index: number): string {
    const asset = this.requireImage(slide.assetId)
    const crop = cropFromRow(slide)
    const size = fitWidth(cropAspect(crop, asset.width!, asset.height!), stack.width)
    const id = randomUUID()
    const now = new Date()
    this.db
      .insert(boardObjects)
      .values({
        id,
        boardId: stack.boardId,
        type: 'image',
        assetId: asset.id,
        x: stack.x + index * GAP,
        y: stack.y + stack.height + GAP,
        ...size,
        rotation: stack.rotation,
        zIndex: this.boards.topZ(stack.boardId) + 1 + index,
        data: crop ? { crop } : {},
        createdAt: now,
        updatedAt: now
      })
      .run()
    this.copyTags('slide', slide.id, 'object', id)
    return id
  }

  private restoreObjects(ids: string[]): void {
    if (ids.length === 0) return
    const rows = this.db.select().from(boardObjects).where(inArray(boardObjects.id, ids)).all()
    if (rows.length !== ids.length || rows.some((row) => !row.deletedAt)) {
      throw new Error(STACK_UNDO_REFUSED)
    }
    this.db
      .update(boardObjects)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(inArray(boardObjects.id, ids))
      .run()
  }

  private geometryAfter(
    row: ObjectRow,
    settings: StackSettings,
    slides: SlideRow[],
    cropSlideId?: string,
    cropOverride?: ImageCrop | null
  ): { x: number; y: number; width: number; height: number } | null {
    if (settings.sizing !== 'adaptive') return null
    const displayed = slides.find((slide) => slide.id === settings.displayedSlideId) ?? slides[0]
    if (!displayed) return { x: row.x, y: row.y, ...EMPTY_STACK_SIZE }
    const asset = this.requireImage(displayed.assetId)
    const crop = displayed.id === cropSlideId ? (cropOverride ?? null) : cropFromRow(displayed)
    const pixels = cropPixels(crop ?? null, asset.width!, asset.height!)
    const previous = this.previousSourceWidth(row, slides, displayed.id)
    return adaptiveFrame(row, previous, pixels.width, pixels.height, MIN_SIZE)
  }

  private previousSourceWidth(row: ObjectRow, slides: SlideRow[], nextId: string): number {
    const settings = stackSettings(row.data)
    const current = slides.find((slide) => slide.id === settings.displayedSlideId)
    if (!current || current.id === nextId) {
      const asset = current ? this.requireImage(current.assetId) : null
      if (!asset) return 0
      return cropPixels(cropFromRow(current!), asset.width!, asset.height!).width
    }
    const asset = this.requireImage(current.assetId)
    return cropPixels(cropFromRow(current), asset.width!, asset.height!).width
  }

  private capture(row: ObjectRow): StackContentSnapshot {
    return {
      revision: row.revision,
      settings: stackSettings(row.data),
      geometry: { x: row.x, y: row.y, width: row.width, height: row.height },
      slides: this.slideRows(row.id).map((slide) => ({
        id: slide.id,
        assetId: slide.assetId,
        position: slide.position,
        crop: cropFromRow(slide),
        layout: layoutOf(slide),
        sourceObjectId: slide.sourceObjectId,
        tags: this.assignments('slide', slide.id)
      }))
    }
  }

  private requireStack(id: string): ObjectRow {
    const row = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.id, id), isNull(boardObjects.deletedAt)))
      .get()
    if (!row || row.type !== 'stack') throw new Error('That stack no longer exists.')
    return row
  }

  private slideRows(stackId: string): SlideRow[] {
    return this.db
      .select()
      .from(stackSlides)
      .where(eq(stackSlides.stackId, stackId))
      .orderBy(asc(stackSlides.position))
      .all()
  }

  private imageCards(ids: string[]): ImageCard[] {
    if (ids.length === 0) return []
    const rows = this.db
      .select()
      .from(boardObjects)
      .where(and(inArray(boardObjects.id, ids), isNull(boardObjects.deletedAt)))
      .all()
    if (rows.length !== new Set(ids).size) {
      throw new Error('Some images are no longer on the board.')
    }
    if (rows.some((row) => row.type !== 'image' || !row.assetId)) {
      throw new Error('Only images can go in a stack.')
    }
    return rows.map((row) => ({ row, asset: this.requireImage(row.assetId!) }))
  }

  private requireImage(id: string): AssetRow {
    const asset = this.db.select().from(assets).where(eq(assets.id, id)).get()
    if (
      !asset ||
      asset.deletedAt ||
      !asset.mime.startsWith('image/') ||
      !asset.width ||
      !asset.height
    ) {
      throw new Error('That image is no longer in the library.')
    }
    return asset
  }

  private assignments(type: string, id: string): TagAssignment[] {
    const assigned = this.db
      .select({ id: taggings.id, tagId: taggings.tagId })
      .from(taggings)
      .where(and(eq(taggings.targetType, type), eq(taggings.targetId, id)))
      .all()
    const oneOffs = this.db
      .select()
      .from(tags)
      .where(
        and(
          eq(tags.reusable, false),
          isNull(tags.deletedAt),
          eq(tags.ownerType, type),
          eq(tags.ownerId, id)
        )
      )
      .all()
    return [
      ...assigned.map((row) => ({
        id: row.id,
        tagId: row.tagId,
        targetType: 'slide' as const,
        targetId: id
      })),
      ...oneOffs.map((row) => ({
        id: row.id,
        tagId: row.id,
        targetType: 'slide' as const,
        targetId: id,
        oneOff: { name: row.name, color: row.color }
      }))
    ]
  }

  private copyTags(
    fromType: 'object' | 'slide',
    fromId: string,
    toType: 'object' | 'slide',
    toId: string
  ): void {
    const now = Date.now()
    const assigned = this.db
      .select()
      .from(taggings)
      .where(and(eq(taggings.targetType, fromType), eq(taggings.targetId, fromId)))
      .all()
    for (const row of assigned) {
      this.db
        .insert(taggings)
        .values({
          id: randomUUID(),
          tagId: row.tagId,
          targetType: toType,
          targetId: toId,
          createdAt: new Date(now)
        })
        .run()
    }
    const oneOffs = this.db
      .select()
      .from(tags)
      .where(
        and(
          eq(tags.reusable, false),
          isNull(tags.deletedAt),
          eq(tags.ownerType, fromType),
          eq(tags.ownerId, fromId)
        )
      )
      .all()
    for (const row of oneOffs) {
      this.db
        .insert(tags)
        .values({
          id: randomUUID(),
          name: row.name,
          normalizedName: row.normalizedName,
          color: row.color,
          reusable: false,
          ownerType: toType,
          ownerId: toId,
          createdAt: new Date(now),
          updatedAt: new Date(now)
        })
        .run()
    }
  }

  private replaceTags(type: string, id: string, next: TagAssignment[]): void {
    this.db
      .delete(taggings)
      .where(and(eq(taggings.targetType, type), eq(taggings.targetId, id)))
      .run()
    this.db
      .delete(tags)
      .where(and(eq(tags.reusable, false), eq(tags.ownerType, type), eq(tags.ownerId, id)))
      .run()
    const now = new Date()
    for (const tag of next) {
      if (tag.oneOff) {
        this.db
          .insert(tags)
          .values({
            id: tag.id,
            name: tag.oneOff.name,
            normalizedName: tagNameParts(tag.oneOff.name).normalized,
            color: tag.oneOff.color,
            reusable: false,
            ownerType: type,
            ownerId: id,
            createdAt: now,
            updatedAt: now
          })
          .run()
      } else {
        this.db
          .insert(taggings)
          .values({
            id: tag.id,
            tagId: tag.tagId,
            targetType: type,
            targetId: id,
            createdAt: now
          })
          .run()
      }
    }
  }
}

interface SlideSeed {
  existingId?: string
  asset: AssetRow
  crop: ImageCrop | null
  source: ObjectRow | null
  /** Layout already stored on the slide. Kept when a later edit rewrites the row. */
  layout?: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
    crop: ImageCrop | null
    sourceObjectId: string | null
  } | null
  tagsFrom: { type: 'object' | 'slide'; id: string } | null
}

export interface ImageCropUndo {
  revision: number
  undo: {
    objectId: string
    revision: number
    crop: ImageCrop | null
    width: number
    height: number
  }
}

function blankSettings(): StackSettings {
  return {
    sizing: 'fixed',
    rememberLast: false,
    coverSlideId: null,
    displayedSlideId: null,
    name: null,
    layoutCaptured: false
  }
}

function frameOf(row: ObjectRow): { x: number; y: number; width: number; height: number } {
  return { x: row.x, y: row.y, width: row.width, height: row.height }
}

function readingOrder<T extends { row: ObjectRow }>(cards: T[]): T[] {
  return [...cards].sort((a, b) =>
    Math.abs(a.row.y - b.row.y) > 8 ? a.row.y - b.row.y : a.row.x - b.row.x
  )
}

function fitAsset(asset: AssetRow): { width: number; height: number } {
  const scale = Math.min(1, MAX_INITIAL / Math.max(asset.width!, asset.height!))
  return fitWidth(asset.width! / asset.height!, asset.width! * scale)
}

function fitWidth(ratio: number, width: number): { width: number; height: number } {
  const safe = ratio > 0 ? ratio : 1
  const next = Math.max(MIN_SIZE, width)
  const height = Math.max(MIN_SIZE, next / safe)
  const fitted = height === next / safe ? next : height * safe
  return {
    width: Math.round(fitted * 100) / 100,
    height: Math.round((fitted / safe) * 100) / 100
  }
}

function cropFromRow(row: SlideRow): ImageCrop | null {
  if (row.cropX == null || row.cropY == null || row.cropW == null || row.cropH == null) return null
  return { x: row.cropX, y: row.cropY, width: row.cropW, height: row.cropH }
}

function cropFromLayout(row: SlideRow): ImageCrop | null {
  if (
    row.layoutCropX == null ||
    row.layoutCropY == null ||
    row.layoutCropW == null ||
    row.layoutCropH == null
  ) {
    return null
  }
  return { x: row.layoutCropX, y: row.layoutCropY, width: row.layoutCropW, height: row.layoutCropH }
}

function layoutOf(row: SlideRow): StackSlideSnapshot['layout'] {
  if (
    row.layoutX == null ||
    row.layoutY == null ||
    row.layoutWidth == null ||
    row.layoutHeight == null
  ) {
    return null
  }
  return {
    x: row.layoutX,
    y: row.layoutY,
    width: row.layoutWidth,
    height: row.layoutHeight,
    rotation: row.layoutRotation ?? 0,
    crop: cropFromLayout(row)
  }
}

function rowToSeed(row: SlideRow): SlideSeed {
  const layout = layoutOf(row)
  return {
    existingId: row.id,
    asset: { id: row.assetId } as AssetRow,
    crop: cropFromRow(row),
    source: null,
    layout: layout ? { ...layout, sourceObjectId: row.sourceObjectId } : null,
    tagsFrom: null
  }
}

function snapshotToSeed(slide: StackSlideSnapshot): SlideSeed {
  return {
    existingId: slide.id,
    asset: { id: slide.assetId } as AssetRow,
    crop: slide.crop,
    source: slide.layout
      ? ({
          id: slide.sourceObjectId,
          x: slide.layout.x,
          y: slide.layout.y,
          width: slide.layout.width,
          height: slide.layout.height,
          rotation: slide.layout.rotation,
          data: { crop: slide.layout.crop }
        } as unknown as ObjectRow)
      : null,
    tagsFrom: null
  }
}

function withoutSlide(
  settings: StackSettings,
  slideId: string,
  fallback: string | null
): StackSettings {
  return {
    ...settings,
    coverSlideId: settings.coverSlideId === slideId ? fallback : settings.coverSlideId,
    displayedSlideId: settings.displayedSlideId === slideId ? fallback : settings.displayedSlideId
  }
}

function slideValues(
  stackId: string,
  id: string,
  seed: SlideSeed,
  index: number,
  now: Date
): typeof stackSlides.$inferInsert {
  const layout = seed.source
  const saved = seed.layout
  const layoutCrop = layout ? cropOf(layout.data) : (saved?.crop ?? null)
  return {
    id,
    stackId,
    assetId: seed.asset.id,
    position: index,
    cropX: seed.crop?.x ?? null,
    cropY: seed.crop?.y ?? null,
    cropW: seed.crop?.width ?? null,
    cropH: seed.crop?.height ?? null,
    layoutX: layout?.x ?? saved?.x ?? null,
    layoutY: layout?.y ?? saved?.y ?? null,
    layoutWidth: layout?.width ?? saved?.width ?? null,
    layoutHeight: layout?.height ?? saved?.height ?? null,
    layoutRotation: layout?.rotation ?? saved?.rotation ?? null,
    layoutCropX: layoutCrop?.x ?? null,
    layoutCropY: layoutCrop?.y ?? null,
    layoutCropW: layoutCrop?.width ?? null,
    layoutCropH: layoutCrop?.height ?? null,
    sourceObjectId: layout?.id ?? saved?.sourceObjectId ?? null,
    updatedAt: now
  }
}

function commentShiftsForSlides(
  stackId: string,
  seeds: SlideSeed[],
  slideIds: string[],
  removeIds: string[]
): CommentShift[] {
  const removed = new Set(removeIds)
  const shifts: CommentShift[] = []
  seeds.forEach((seed, index) => {
    if (seed.existingId) return
    const objectId = seed.tagsFrom?.type === 'object' ? seed.tagsFrom.id : seed.source?.id
    if (!objectId || !removed.has(objectId)) return
    shifts.push({ op: 'object-to-slide', stackId, slideId: slideIds[index], objectId })
  })
  return shifts
}

function commentShiftsForRestore(
  stackId: string,
  slides: { id: string; sourceObjectId: string | null }[]
): CommentShift[] {
  const shifts: CommentShift[] = slides.flatMap((slide) =>
    slide.sourceObjectId
      ? [
          {
            op: 'slide-to-object' as const,
            stackId,
            slideId: slide.id,
            objectId: slide.sourceObjectId
          }
        ]
      : []
  )
  shifts.push({ op: 'detach-stack', stackId })
  return shifts
}

function shiftsOf(result: StackResult): CommentShift[] {
  return result.undo.op === 'display' ? [] : (result.undo.commentShifts ?? [])
}

function attachCommentShifts(result: StackResult, shifts: CommentShift[]): StackResult {
  if (shifts.length === 0 || result.undo.op === 'display') return result
  return { ...result, undo: { ...result.undo, commentShifts: shifts } }
}

export function copyOwnedTags(
  db: ProjectDb,
  fromType: string,
  fromId: string,
  toType: string,
  toId: string
): void {
  const now = new Date()
  const assigned = db
    .select()
    .from(taggings)
    .where(and(eq(taggings.targetType, fromType), eq(taggings.targetId, fromId)))
    .all()
  for (const row of assigned) {
    db.insert(taggings)
      .values({
        id: randomUUID(),
        tagId: row.tagId,
        targetType: toType,
        targetId: toId,
        createdAt: now
      })
      .run()
  }
  const oneOffs = db
    .select()
    .from(tags)
    .where(
      and(
        eq(tags.reusable, false),
        isNull(tags.deletedAt),
        eq(tags.ownerType, fromType),
        eq(tags.ownerId, fromId)
      )
    )
    .all()
  for (const row of oneOffs) {
    db.insert(tags)
      .values({
        id: randomUUID(),
        name: row.name,
        normalizedName: row.normalizedName,
        color: row.color,
        reusable: false,
        ownerType: toType,
        ownerId: toId,
        createdAt: now,
        updatedAt: now
      })
      .run()
  }
}

/** Copies slides onto a duplicated stack and points its cover at the new slide ids. */
export function cloneStackSlides(db: ProjectDb, fromId: string, toId: string): Map<string, string> {
  const slides = db
    .select()
    .from(stackSlides)
    .where(eq(stackSlides.stackId, fromId))
    .orderBy(asc(stackSlides.position))
    .all()
  const map = new Map<string, string>()
  const now = new Date()
  for (const slide of slides) {
    const id = randomUUID()
    map.set(slide.id, id)
    db.insert(stackSlides)
      .values({ ...slide, id, stackId: toId, sourceObjectId: null, createdAt: now, updatedAt: now })
      .run()
  }
  copyOwnedTags(db, 'object', fromId, 'object', toId)
  for (const [fromSlide, toSlide] of map) copyOwnedTags(db, 'slide', fromSlide, 'slide', toSlide)
  const object = db.select().from(boardObjects).where(eq(boardObjects.id, toId)).get()
  if (!object) return map
  const settings = stackSettings(object.data)
  db.update(boardObjects)
    .set({
      data: settingsData({
        ...settings,
        layoutCaptured: false,
        coverSlideId: settings.coverSlideId ? (map.get(settings.coverSlideId) ?? null) : null,
        displayedSlideId: settings.displayedSlideId
          ? (map.get(settings.displayedSlideId) ?? null)
          : null
      })
    })
    .where(eq(boardObjects.id, toId))
    .run()
  return map
}
