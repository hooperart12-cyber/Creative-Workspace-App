import { randomUUID } from 'node:crypto'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { Box } from '@shared/geometry'
import type { FileAppearance } from '@shared/files'
import type { CanvasObject, CreateImagesInput, ObjectPatch, Point } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { assets, boardObjects, boards } from '../db/schema'
import { attachPreviews, toAssetInfo } from './assets'
import { deletionTime, remap, toCanvasObject, type BoardRepository } from './boards'

const PATCHABLE = ['x', 'y', 'width', 'height', 'rotation', 'zIndex', 'locked', 'groupId'] as const

/** Smallest allowed object size, so nothing can be resized out of existence. */
export const MIN_OBJECT_SIZE = 24

/** Longest side of a newly placed image, in canvas units. It can be resized freely afterwards. */
export const MAX_INITIAL_IMAGE_SIZE = 800

/** Space between images placed together. */
export const IMAGE_GAP = 24

const round2 = (value: number) => Math.round(value * 100) / 100

/**
 * Display size for an image that keeps its aspect ratio: scaled to `width` (or `height`
 * if no width is given), and never so small that its longest side is under the minimum.
 */
export function proportionalSize(
  ratio: number,
  size: { width?: number; height?: number }
): { width: number; height: number } {
  let width = size.width ?? (size.height ?? 0) * ratio
  if (!(Math.max(width, width / ratio) >= MIN_OBJECT_SIZE)) {
    // Too small (or invalid): grow the longest side to the minimum.
    width = ratio >= 1 ? MIN_OBJECT_SIZE : MIN_OBJECT_SIZE * ratio
  }
  return { width: round2(width), height: round2(width / ratio) }
}

/** Size an image gets when first placed: its pixel size, scaled down to fit the maximum. */
export function initialImageSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_INITIAL_IMAGE_SIZE / Math.max(width, height))
  return proportionalSize(width / height, { width: width * scale })
}

/** Lays images out in rows (roughly square overall). Positions are relative to the top-left. */
export function layoutImages(sizes: { width: number; height: number }[]): {
  positions: Point[]
  width: number
  height: number
} {
  const columns = Math.max(1, Math.ceil(Math.sqrt(sizes.length)))
  const positions: Point[] = []
  let y = 0
  let width = 0
  for (let start = 0; start < sizes.length; start += columns) {
    const row = sizes.slice(start, start + columns)
    let x = 0
    for (const size of row) {
      positions.push({ x, y })
      x += size.width + IMAGE_GAP
    }
    width = Math.max(width, x - IMAGE_GAP)
    y += Math.max(...row.map((s) => s.height)) + IMAGE_GAP
  }
  return { positions, width, height: Math.max(0, y - IMAGE_GAP) }
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y

const FILE_CARD = { width: 240, height: 96 }
const PDF_CARD = { width: 340, height: 440 }

function placementFor(asset: { mime: string; width: number | null; height: number | null }): {
  type: 'image' | 'document' | 'file'
  width: number
  height: number
  data: Record<string, unknown>
} {
  if (asset.mime.startsWith('image/') && asset.width && asset.height) {
    return { type: 'image', ...initialImageSize(asset.width, asset.height), data: {} }
  }
  if (asset.mime === 'application/pdf') {
    const size =
      asset.width && asset.height ? initialImageSize(asset.width, asset.height) : PDF_CARD
    return { type: 'document', ...size, data: {} }
  }
  return { type: 'file', ...FILE_CARD, data: { appearance: 'compact' } }
}

/**
 * Operations on objects placed on board canvases (§4). Board cards are special:
 * trashing, moving or copying a card does the same to the board it opens.
 */
export class ObjectRepository {
  constructor(
    private readonly db: ProjectDb,
    private readonly boards: BoardRepository
  ) {}

  /**
   * Applies placement/arrangement changes to several objects in one transaction.
   * Images and PDF cards keep their aspect ratio: a new width sets the height (or the reverse).
   */
  update(patches: ObjectPatch[]): void {
    if (patches.length === 0) return
    const ratios = this.lockedRatios(
      patches.filter((p) => p.width !== undefined || p.height !== undefined).map((p) => p.id)
    )
    const now = new Date()
    this.db.transaction((tx) => {
      for (const patch of patches) {
        const values: Partial<typeof boardObjects.$inferInsert> = { updatedAt: now }
        for (const key of PATCHABLE) {
          if (patch[key] !== undefined) Object.assign(values, { [key]: patch[key] })
        }
        const ratio = ratios.get(patch.id)
        if (ratio && (values.width !== undefined || values.height !== undefined)) {
          Object.assign(values, proportionalSize(ratio, values))
        } else {
          if (values.width !== undefined) values.width = Math.max(MIN_OBJECT_SIZE, values.width)
          if (values.height !== undefined) values.height = Math.max(MIN_OBJECT_SIZE, values.height)
        }
        const result = tx
          .update(boardObjects)
          .set(values)
          .where(and(eq(boardObjects.id, patch.id), isNull(boardObjects.deletedAt)))
          .run()
        if (result.changes === 0) throw new Error('Object not found. It may have been deleted.')
      }
    })
  }

  /** Moves objects to the trash. Board cards trash their board and everything inside it. */
  delete(ids: string[]): void {
    const rows = this.rows(ids, { includeDeleted: false })
    const now = deletionTime()
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (row.type === 'board' && row.linkedBoardId) {
          this.boards.delete(row.linkedBoardId)
        } else {
          tx.update(boardObjects)
            .set({ deletedAt: now, updatedAt: now })
            .where(eq(boardObjects.id, row.id))
            .run()
        }
      }
    })
  }

  /** Brings trashed objects back (undo of delete). */
  restore(ids: string[], boardId?: string): void {
    const rows = this.rows(ids, { includeDeleted: true })
    if (boardId) this.boards.require(boardId)
    const now = new Date()
    this.db.transaction((tx) => {
      for (const row of rows) {
        if (!row.deletedAt) continue
        if (row.type === 'board' && row.linkedBoardId) {
          this.boards.restore(row.linkedBoardId)
        } else {
          const target = boardId ?? row.boardId
          this.boards.require(target)
          tx.update(boardObjects)
            .set({ deletedAt: null, boardId: target, updatedAt: now })
            .where(eq(boardObjects.id, row.id))
            .run()
        }
      }
    })
  }

  /**
   * Moves objects onto another board (or repositions them on the same one), keeping
   * their layout relative to each other. The set's top-left corner goes to `at`,
   * or below the target's existing content.
   */
  moveToBoard(ids: string[], targetBoardId: string, at?: Point): void {
    this.boards.require(targetBoardId)
    const rows = this.rows(ids, { includeDeleted: false })
    if (rows.length === 0) return
    const origin = at ?? this.boards.placementBelowContent(targetBoardId)
    const left = Math.min(...rows.map((r) => r.x))
    const top = Math.min(...rows.map((r) => r.y))
    const now = new Date()

    this.db.transaction((tx) => {
      let z = this.boards.topZ(targetBoardId)
      for (const row of [...rows].sort((a, b) => a.zIndex - b.zIndex)) {
        const position = { x: origin.x + (row.x - left), y: origin.y + (row.y - top) }
        if (row.type === 'board' && row.linkedBoardId) {
          this.boards.move(row.linkedBoardId, targetBoardId, position)
        } else {
          const changingBoard = row.boardId !== targetBoardId
          tx.update(boardObjects)
            .set({
              boardId: targetBoardId,
              ...position,
              ...(changingBoard ? { zIndex: ++z } : {}),
              updatedAt: now
            })
            .where(eq(boardObjects.id, row.id))
            .run()
        }
      }
    })
  }

  /**
   * Copies objects onto a board with the set's top-left at `at`. Board cards copy their
   * whole board (deep copy). Copies keep their stacking order and get their own groups.
   * Returns the new object ids in the same order as `ids`.
   */
  copyTo(ids: string[], targetBoardId: string, at: Point): string[] {
    this.boards.require(targetBoardId)
    const rows = this.rows(ids, { includeDeleted: false })
    if (rows.length === 0) return []
    const left = Math.min(...rows.map((r) => r.x))
    const top = Math.min(...rows.map((r) => r.y))
    const now = new Date()
    const newIds = new Map<string, string>()
    const groupIds = new Map<string, string>()

    this.db.transaction((tx) => {
      for (const row of [...rows].sort((a, b) => a.zIndex - b.zIndex)) {
        const position = { x: at.x + (row.x - left), y: at.y + (row.y - top) }
        const groupId = row.groupId ? remap(groupIds, row.groupId) : null
        if (row.type === 'board' && row.linkedBoardId) {
          const cardId = this.boards.duplicate(row.linkedBoardId, targetBoardId, position)
          tx.update(boardObjects)
            .set({ groupId, width: row.width, height: row.height })
            .where(eq(boardObjects.id, cardId))
            .run()
          newIds.set(row.id, cardId)
        } else {
          const id = randomUUID()
          tx.insert(boardObjects)
            .values({
              ...row,
              id,
              boardId: targetBoardId,
              ...position,
              zIndex: this.boards.topZ(targetBoardId) + 1,
              groupId,
              createdAt: now,
              updatedAt: now,
              deletedAt: null
            })
            .run()
          newIds.set(row.id, id)
        }
      }
    })
    return ids.filter((id) => newIds.has(id)).map((id) => newIds.get(id)!)
  }

  /**
   * Places library images on a board, centred on a point and laid out in rows, each at its
   * initial size. Returns the new object ids in the same order as `assetIds`.
   */
  createImages({ boardId, assetIds, center, avoidOverlap }: CreateImagesInput): string[] {
    this.boards.require(boardId)
    if (assetIds.length === 0) return []
    const rows = this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
    const byId = new Map(rows.map((row) => [row.id, row]))
    const images = assetIds.map((id) => {
      const asset = byId.get(id)
      if (!asset?.width || !asset.height) throw new Error('Only images can be placed on a board.')
      return asset
    })
    const sizes = images.map((a) => initialImageSize(a.width!, a.height!))
    const layout = layoutImages(sizes)
    const origin = {
      x: Math.round(center.x - layout.width / 2),
      y: Math.round(center.y - layout.height / 2)
    }
    if (avoidOverlap) {
      const existing = this.boards.contentBounds(boardId)
      const area = () => ({ ...origin, width: layout.width, height: layout.height })
      for (let tries = 0; tries < 50 && existing.some((b) => overlaps(b, area())); tries++) {
        origin.x += Math.round(layout.width + IMAGE_GAP)
      }
    }

    const now = new Date()
    const ids = images.map(() => randomUUID())
    this.db.transaction((tx) => {
      let z = this.boards.topZ(boardId)
      images.forEach((asset, i) => {
        tx.insert(boardObjects)
          .values({
            id: ids[i],
            boardId,
            type: 'image',
            assetId: asset.id,
            x: origin.x + layout.positions[i].x,
            y: origin.y + layout.positions[i].y,
            ...sizes[i],
            zIndex: ++z,
            createdAt: now,
            updatedAt: now
          })
          .run()
      })
    })
    return ids
  }

  /**
   * Places library files on a board. An image becomes an image card, a PDF a document card,
   * and anything else a compact file card. One undo step covers the whole batch.
   */
  createFromAssets({ boardId, assetIds, center, avoidOverlap }: CreateImagesInput): string[] {
    this.boards.require(boardId)
    if (assetIds.length === 0) return []
    const rows = this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
    const byId = new Map(rows.map((row) => [row.id, row]))
    const placed = assetIds.map((id) => {
      const asset = byId.get(id)
      if (!asset || asset.deletedAt) throw new Error('File not found in the library.')
      return { asset, ...placementFor(asset) }
    })
    const layout = layoutImages(placed)
    const origin = {
      x: Math.round(center.x - layout.width / 2),
      y: Math.round(center.y - layout.height / 2)
    }
    if (avoidOverlap) {
      const existing = this.boards.contentBounds(boardId)
      const area = () => ({ ...origin, width: layout.width, height: layout.height })
      for (let tries = 0; tries < 50 && existing.some((b) => overlaps(b, area())); tries++) {
        origin.x += Math.round(layout.width + IMAGE_GAP)
      }
    }

    const now = new Date()
    const ids = placed.map(() => randomUUID())
    this.db.transaction((tx) => {
      let z = this.boards.topZ(boardId)
      placed.forEach((item, i) => {
        tx.insert(boardObjects)
          .values({
            id: ids[i],
            boardId,
            type: item.type,
            assetId: item.asset.id,
            data: item.data,
            x: origin.x + layout.positions[i].x,
            y: origin.y + layout.positions[i].y,
            width: item.width,
            height: item.height,
            zIndex: ++z,
            createdAt: now,
            updatedAt: now
          })
          .run()
      })
    })
    return ids
  }

  /** One object, with its file, for the PDF reader and file details. */
  read(id: string): CanvasObject | null {
    const row = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.id, id), isNull(boardObjects.deletedAt)))
      .get()
    if (!row) return null
    const object = toCanvasObject(row)
    if (row.assetId) {
      const asset = this.db.select().from(assets).where(eq(assets.id, row.assetId)).get()
      if (!asset || asset.deletedAt) return null
      object.asset = toAssetInfo(asset)
      attachPreviews(this.db, [object.asset])
    }
    return object
  }

  /** Compact or preview layout for one file card. Does not change the file or its preview. */
  setFileAppearance(id: string, appearance: FileAppearance): void {
    const row = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.id, id), isNull(boardObjects.deletedAt)))
      .get()
    if (!row || row.type !== 'file') throw new Error('Not a file card.')
    this.db
      .update(boardObjects)
      .set({ data: { ...row.data, appearance }, updatedAt: new Date() })
      .where(eq(boardObjects.id, id))
      .run()
  }

  /** Gives document cards of this PDF the page's proportions, keeping each card's width. */
  fitDocumentPages(assetId: string): void {
    const asset = this.db.select().from(assets).where(eq(assets.id, assetId)).get()
    if (!asset?.width || !asset.height) return
    const ratio = asset.width / asset.height
    const rows = this.db
      .select()
      .from(boardObjects)
      .where(
        and(
          eq(boardObjects.assetId, assetId),
          eq(boardObjects.type, 'document'),
          isNull(boardObjects.deletedAt)
        )
      )
      .all()
    const now = new Date()
    for (const row of rows) {
      const size = proportionalSize(ratio, { width: row.width })
      this.db
        .update(boardObjects)
        .set({ ...size, updatedAt: now })
        .where(eq(boardObjects.id, row.id))
        .run()
    }
  }

  /** The board an object lives on (used to check clipboard pastes). */
  boardOf(id: string): string | undefined {
    return this.db
      .select({ boardId: boardObjects.boardId })
      .from(boardObjects)
      .innerJoin(boards, eq(boards.id, boardObjects.boardId))
      .where(and(eq(boardObjects.id, id), isNull(boardObjects.deletedAt), isNull(boards.deletedAt)))
      .get()?.boardId
  }

  /** Width ÷ height of images and PDFs among `ids` (objects that must keep their proportions). */
  private lockedRatios(ids: string[]): Map<string, number> {
    if (ids.length === 0) return new Map()
    const rows = this.db
      .select({ id: boardObjects.id, width: assets.width, height: assets.height })
      .from(boardObjects)
      .innerJoin(assets, eq(assets.id, boardObjects.assetId))
      .where(and(inArray(boardObjects.id, ids), inArray(boardObjects.type, ['image', 'document'])))
      .all()
    return new Map(
      rows.flatMap((r) => (r.width && r.height ? [[r.id, r.width / r.height] as const] : []))
    )
  }

  private rows(ids: string[], { includeDeleted }: { includeDeleted: boolean }) {
    if (ids.length === 0) return []
    const rows = this.db
      .select()
      .from(boardObjects)
      .where(
        includeDeleted
          ? inArray(boardObjects.id, ids)
          : and(inArray(boardObjects.id, ids), isNull(boardObjects.deletedAt))
      )
      .all()
    if (rows.length !== new Set(ids).size) {
      throw new Error('Some items were not found. They may have been changed in another window.')
    }
    return rows
  }
}
