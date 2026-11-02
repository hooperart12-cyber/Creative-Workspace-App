/**
 * One board as a portable, editable package. Other boards are not copied just because a
 * link points at them. Their ids and titles stay so Project integrity can repair them.
 */
import { createHash, randomUUID } from 'node:crypto'
import { copyFileSync, createWriteStream, mkdirSync } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { ZipFile } from 'yazl'
import { parseComment } from '@shared/comments'
import { parseConnection, remapConnection, type ConnectionData } from '@shared/connections'
import { parseDestination, remapDestination } from '@shared/destinations'
import type { ProjectDb } from '../db/client'
import {
  assets,
  boardObjects,
  boards,
  commentMessages,
  linkPreviews,
  stackSlides,
  taggings,
  tags
} from '../db/schema'
import { hashFile, storedOriginalPath } from './backup'
import { ensureActiveEntry } from './libraryEntries'
import type { Project } from './project'
import { extractZip, safeRelative } from './projectZip'
import { tagColor, tagNameParts } from './tagNames'

const OBJECT_TYPES = new Set([
  'board',
  'image',
  'text',
  'document',
  'file',
  'stack',
  'connection',
  'link',
  'comment'
])
const SHA = /^[0-9a-f]{64}$/
const EXT = /^[a-z0-9]{1,16}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface PackageAsset {
  sourceId: string
  sha256: string
  originalName: string
  mime: string
  ext: string
  bytes: number
  width: number | null
  height: number | null
  hasAlpha: boolean | null
  pageCount: number | null
  previewSha: string | null
}

interface PackageObject {
  id: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked: boolean
  groupId: string | null
  assetSha: string | null
  linkedBoardId: string | null
  data: Record<string, unknown>
}

interface PackageSlide {
  id: string
  stackId: string
  assetSha: string
  position: number
  cropX: number | null
  cropY: number | null
  cropW: number | null
  cropH: number | null
  layoutX: number | null
  layoutY: number | null
  layoutWidth: number | null
  layoutHeight: number | null
  layoutRotation: number | null
  layoutCropX: number | null
  layoutCropY: number | null
  layoutCropW: number | null
  layoutCropH: number | null
  sourceObjectId: string | null
}

interface PackageMessage {
  id: string
  commentId: string
  body: string
  editedAt: number | null
}

interface PackagePreview {
  objectId: string
  url: string
  title: string | null
  description: string | null
  imageFile: string | null
  error: string | null
}

interface PackageTag {
  id: string
  name: string
  normalizedName: string
  color: string | null
  reusable: boolean
  ownerType: string | null
  ownerId: string | null
}

interface PackageTagging {
  tagId: string
  targetType: string
  targetId: string
}

interface BoardDocument {
  formatVersion: 1
  kind: 'creative-workspace-board'
  includeComments: boolean
  board: {
    sourceId: string
    title: string
    viewportX: number
    viewportY: number
    viewportZoom: number
    tagVisibility: string
    connectionDisplay: string
    crossingStyle: string
    commentView: string
  }
  objects: PackageObject[]
  slides: PackageSlide[]
  messages: PackageMessage[]
  previews: PackagePreview[]
  tags: PackageTag[]
  taggings: PackageTagging[]
  assets: PackageAsset[]
}

interface ManifestFile {
  path: string
  sha256: string
  bytes: number
}

interface KnownIds {
  objects: Set<string>
  boards: Set<string>
  slides: Set<string>
  groups: Set<string>
}

/** Writes one board and the files it needs. Comments are omitted unless asked for. */
export async function exportBoardPackage(input: {
  project: Project
  boardId: string
  destination: string
  includeComments: boolean
}): Promise<void> {
  const document = readBoard(input.project.db, input.boardId, input.includeComments)
  const staging = `${input.destination}.${randomUUID()}.partial`
  const zip = new ZipFile()
  const files: ManifestFile[] = []
  const boardJson = Buffer.from(JSON.stringify(document))
  files.push({
    path: 'board.json',
    sha256: sha256(boardJson),
    bytes: boardJson.length
  })
  zip.addBuffer(boardJson, 'board.json')
  for (const asset of document.assets) {
    const path = `assets/${asset.sha256}.${asset.ext}`
    const source = storedOriginalPath(input.project.path, asset.sha256, asset.ext)
    files.push({ path, sha256: asset.sha256, bytes: asset.bytes })
    zip.addFile(source, path)
  }
  for (const preview of document.previews) {
    if (!preview.imageFile) continue
    const path = `previews/${preview.imageFile}`
    const source = join(input.project.path, 'thumbs', 'link-previews', preview.imageFile)
    const info = await stat(source)
    files.push({ path, sha256: await hashFile(source), bytes: info.size })
    zip.addFile(source, path)
  }
  const manifest = {
    formatVersion: 1 as const,
    kind: 'creative-workspace-board' as const,
    files
  }
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'manifest.json')
  try {
    const done = pipeline(zip.outputStream, createWriteStream(staging))
    zip.end()
    await done
    await rename(staging, input.destination)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

/** Adds the board as a new child. Existing boards, files, and objects are left in place. */
export async function importBoardPackage(input: {
  project: Project
  zipPath: string
  parentBoardId: string
}): Promise<{ boardId: string }> {
  const parent = input.project.db
    .select({ id: boards.id })
    .from(boards)
    .where(and(eq(boards.id, input.parentBoardId), isNull(boards.deletedAt)))
    .get()
  if (!parent) throw new Error('Choose a board to import into.')
  const partial = join(input.project.path, `.board-import-${randomUUID()}`)
  const copied: string[] = []
  await mkdir(partial, { recursive: true })
  try {
    await extractZip(input.zipPath, partial)
    const document = await readPackage(partial)
    const staged = await stageAssets(input.project, partial, document.assets, copied)
    const boardId = input.project.db.transaction((tx) =>
      insertBoard(tx, input.project.path, document, staged, input.parentBoardId, partial, copied)
    )
    return { boardId }
  } catch (error) {
    for (const file of copied) await rm(file, { force: true })
    throw error
  } finally {
    await rm(partial, { recursive: true, force: true })
  }
}

function readBoard(db: ProjectDb, boardId: string, includeComments: boolean): BoardDocument {
  const board = db
    .select()
    .from(boards)
    .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
    .get()
  if (!board) throw new Error('That board is not in this project.')
  const rows = db
    .select()
    .from(boardObjects)
    .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
    .all()
    .filter((row) => includeComments || row.type !== 'comment')
  const assetRows = db.select().from(assets).where(isNull(assets.deletedAt)).all()
  const byAsset = new Map(assetRows.map((row) => [row.id, row]))
  const wantedAssets = new Set<string>()
  const rememberAsset = (id: string | null) => {
    if (!id) return
    const row = byAsset.get(id)
    if (!row) return
    wantedAssets.add(row.id)
    if (row.previewAssetId) wantedAssets.add(row.previewAssetId)
  }
  for (const row of rows) rememberAsset(row.assetId)
  const stackIds = rows.filter((row) => row.type === 'stack').map((row) => row.id)
  const slides = stackIds.length
    ? db.select().from(stackSlides).where(inArray(stackSlides.stackId, stackIds)).all()
    : []
  for (const slide of slides) rememberAsset(slide.assetId)
  const objectIds = new Set(rows.map((row) => row.id))
  const slideIds = new Set(slides.map((slide) => slide.id))
  const assigned = db
    .select()
    .from(taggings)
    .all()
    .filter((row) => {
      if (row.targetType === 'object') return objectIds.has(row.targetId)
      if (row.targetType === 'slide') return slideIds.has(row.targetId)
      if (row.targetType === 'board') return row.targetId === boardId
      if (row.targetType === 'asset') return wantedAssets.has(row.targetId)
      return false
    })
  const tagIds = new Set(assigned.map((row) => row.tagId))
  const tagRows = tagIds.size
    ? db
        .select()
        .from(tags)
        .where(and(inArray(tags.id, [...tagIds]), isNull(tags.deletedAt)))
        .all()
    : []
  const commentIds = rows.filter((row) => row.type === 'comment').map((row) => row.id)
  const messages = commentIds.length
    ? db
        .select()
        .from(commentMessages)
        .where(
          and(inArray(commentMessages.commentId, commentIds), isNull(commentMessages.deletedAt))
        )
        .all()
    : []
  const linkIds = rows.filter((row) => row.type === 'link').map((row) => row.id)
  const previews = linkIds.length
    ? db.select().from(linkPreviews).where(inArray(linkPreviews.objectId, linkIds)).all()
    : []
  const packagedAssets: PackageAsset[] = [...wantedAssets].flatMap((id) => {
    const row = byAsset.get(id)
    if (!row) return []
    const preview = row.previewAssetId ? byAsset.get(row.previewAssetId) : undefined
    return [
      {
        sourceId: row.id,
        sha256: row.sha256,
        originalName: row.originalName,
        mime: row.mime,
        ext: row.ext,
        bytes: row.bytes,
        width: row.width,
        height: row.height,
        hasAlpha: row.hasAlpha,
        pageCount: row.pageCount,
        previewSha: preview?.sha256 ?? null
      }
    ]
  })
  return {
    formatVersion: 1,
    kind: 'creative-workspace-board',
    includeComments,
    board: {
      sourceId: board.id,
      title: board.title,
      viewportX: board.viewportX,
      viewportY: board.viewportY,
      viewportZoom: board.viewportZoom,
      tagVisibility: board.tagVisibility,
      connectionDisplay: board.connectionDisplay,
      crossingStyle: board.crossingStyle,
      commentView: board.commentView
    },
    objects: rows.map((row) => ({
      id: row.id,
      type: row.type,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      zIndex: row.zIndex,
      locked: row.locked,
      groupId: row.groupId,
      assetSha: row.assetId ? (byAsset.get(row.assetId)?.sha256 ?? null) : null,
      linkedBoardId: row.linkedBoardId,
      data: { ...(row.data ?? {}) }
    })),
    slides: slides.map((slide) => ({
      id: slide.id,
      stackId: slide.stackId,
      assetSha: byAsset.get(slide.assetId)?.sha256 ?? '',
      position: slide.position,
      cropX: slide.cropX,
      cropY: slide.cropY,
      cropW: slide.cropW,
      cropH: slide.cropH,
      layoutX: slide.layoutX,
      layoutY: slide.layoutY,
      layoutWidth: slide.layoutWidth,
      layoutHeight: slide.layoutHeight,
      layoutRotation: slide.layoutRotation,
      layoutCropX: slide.layoutCropX,
      layoutCropY: slide.layoutCropY,
      layoutCropW: slide.layoutCropW,
      layoutCropH: slide.layoutCropH,
      sourceObjectId: slide.sourceObjectId
    })),
    messages: messages.map((message) => ({
      id: message.id,
      commentId: message.commentId,
      body: message.body,
      editedAt: message.editedAt ? message.editedAt.getTime() : null
    })),
    previews: previews.map((preview) => ({
      objectId: preview.objectId,
      url: preview.url,
      title: preview.title,
      description: preview.description,
      imageFile: safePreviewName(preview.imageFile),
      error: preview.error
    })),
    tags: tagRows.map((tag) => ({
      id: tag.id,
      name: tag.name,
      normalizedName: tag.normalizedName,
      color: tag.color,
      reusable: tag.reusable,
      ownerType: tag.ownerType,
      ownerId: tag.ownerId
    })),
    taggings: assigned.map((row) => ({
      tagId: row.tagId,
      targetType: row.targetType,
      targetId: row.targetId
    })),
    assets: packagedAssets
  }
}

async function readPackage(root: string): Promise<BoardDocument> {
  const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8')) as {
    formatVersion?: number
    kind?: string
    files?: ManifestFile[]
  }
  if (manifest.formatVersion !== 1 || manifest.kind !== 'creative-workspace-board') {
    throw new Error('This archive is not a Creative Workspace board.')
  }
  if (!Array.isArray(manifest.files)) throw new Error('The board package has no file list.')
  const present = await relativeFiles(root)
  const declared = new Set(manifest.files.map((file) => file.path))
  declared.add('manifest.json')
  for (const path of present) {
    if (!declared.has(path)) throw new Error('The archive contains a file that is not listed.')
  }
  let total = 0
  for (const file of manifest.files) {
    const safe = safeRelative(file.path)
    if (!safe) throw new Error('The archive contains an unsafe path.')
    const full = join(root, safe)
    const info = await stat(full)
    if (info.size !== file.bytes) throw new Error(`${file.path} is the wrong size.`)
    if ((await hashFile(full)) !== file.sha256)
      throw new Error(`${file.path} does not match its checksum.`)
    total += file.bytes
    if (total > 4_000_000_000) throw new Error('The board package is too large.')
  }
  const document = JSON.parse(await readFile(join(root, 'board.json'), 'utf8')) as BoardDocument
  validateDocument(document)
  return document
}

function validateDocument(document: BoardDocument): void {
  if (document.formatVersion !== 1 || document.kind !== 'creative-workspace-board') {
    throw new Error('This archive is not a Creative Workspace board.')
  }
  if (
    !document.board ||
    typeof document.board.title !== 'string' ||
    !uuid(document.board.sourceId)
  ) {
    throw new Error('The board package is missing its board.')
  }
  if (!Array.isArray(document.objects) || document.objects.length > 20000) {
    throw new Error('The board package has an invalid object list.')
  }
  for (const list of [
    document.slides,
    document.messages,
    document.previews,
    document.tags,
    document.taggings
  ]) {
    if (!Array.isArray(list)) throw new Error('The board package is incomplete.')
  }
  for (const object of document.objects) {
    if (!uuid(object.id) || !OBJECT_TYPES.has(object.type)) {
      throw new Error('The board package has an object this app cannot store.')
    }
    for (const value of [
      object.x,
      object.y,
      object.width,
      object.height,
      object.rotation,
      object.zIndex
    ]) {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('The board package has an object with a position that cannot be read.')
      }
    }
    if (!object.data || typeof object.data !== 'object' || Array.isArray(object.data)) {
      throw new Error('The board package has an object whose data cannot be read.')
    }
  }
  if (!Array.isArray(document.assets) || document.assets.length > 10000) {
    throw new Error('The board package has an invalid file list.')
  }
  for (const asset of document.assets) {
    if (
      !uuid(asset.sourceId) ||
      !SHA.test(asset.sha256) ||
      !EXT.test(asset.ext) ||
      !Number.isFinite(asset.bytes)
    ) {
      throw new Error('The board package names a file that cannot be stored.')
    }
  }
}

interface StagedAsset {
  asset: PackageAsset
  existingId: string | null
}

/** Copies new originals beside the project. Database rows are inserted later, in one transaction. */
async function stageAssets(
  project: Project,
  root: string,
  listed: PackageAsset[],
  copied: string[]
): Promise<StagedAsset[]> {
  const existing = project.db
    .select({ id: assets.id, sha256: assets.sha256 })
    .from(assets)
    .where(isNull(assets.deletedAt))
    .all()
  const bySha = new Map(existing.map((row) => [row.sha256, row.id]))
  const staged: StagedAsset[] = []
  for (const asset of listed) {
    const existingId = bySha.get(asset.sha256) ?? null
    if (!existingId) {
      const target = storedOriginalPath(project.path, asset.sha256, asset.ext)
      let already = true
      try {
        await stat(target)
      } catch {
        already = false
      }
      if (!already) {
        await mkdir(dirname(target), { recursive: true })
        await copyFile(join(root, 'assets', `${asset.sha256}.${asset.ext}`), target)
        copied.push(target)
      }
    }
    staged.push({ asset, existingId })
  }
  return staged
}

function insertBoard(
  tx: ProjectDb,
  projectPath: string,
  document: BoardDocument,
  staged: StagedAsset[],
  parentBoardId: string,
  root: string,
  copied: string[]
): string {
  const now = new Date()
  const boardId = randomUUID()
  const ids = new Map<string, string>([[document.board.sourceId, boardId]])
  const assetIds = new Map<string, string>()
  const freshAssets = new Set<string>()
  for (const item of staged) {
    const id = item.existingId ?? randomUUID()
    assetIds.set(item.asset.sha256, id)
    ids.set(item.asset.sourceId, id)
    if (!item.existingId) {
      freshAssets.add(id)
      tx.insert(assets)
        .values({
          id,
          sha256: item.asset.sha256,
          originalName: item.asset.originalName.slice(0, 240) || 'File',
          mime: item.asset.mime.slice(0, 120) || 'application/octet-stream',
          ext: item.asset.ext,
          bytes: item.asset.bytes,
          width: item.asset.width,
          height: item.asset.height,
          hasAlpha: item.asset.hasAlpha,
          pageCount: item.asset.pageCount,
          createdAt: now,
          updatedAt: now
        })
        .run()
      ensureActiveEntry(tx, { assetId: id, name: item.asset.originalName, folderId: null })
    }
  }
  for (const item of staged) {
    if (!item.asset.previewSha) continue
    const id = assetIds.get(item.asset.sha256)
    const preview = assetIds.get(item.asset.previewSha)
    if (!id || !preview || id === preview || !freshAssets.has(id)) continue
    tx.update(assets)
      .set({ previewAssetId: preview, updatedAt: now })
      .where(eq(assets.id, id))
      .run()
  }
  for (const object of document.objects) ids.set(object.id, randomUUID())
  for (const slide of document.slides) ids.set(slide.id, randomUUID())
  for (const object of document.objects) {
    if (object.groupId && !ids.has(object.groupId)) ids.set(object.groupId, randomUUID())
  }
  const known = knownIds(tx)
  known.boards.add(boardId)
  for (const object of document.objects) known.objects.add(ids.get(object.id)!)
  for (const slide of document.slides) known.slides.add(ids.get(slide.id)!)
  for (const object of document.objects) {
    if (object.groupId) known.groups.add(ids.get(object.groupId)!)
  }
  tx.insert(boards)
    .values({
      id: boardId,
      parentBoardId,
      title: document.board.title.trim() || 'Imported board',
      viewportX: numberOr(document.board.viewportX, 0),
      viewportY: numberOr(document.board.viewportY, 0),
      viewportZoom: numberOr(document.board.viewportZoom, 1),
      tagVisibility: oneOf(document.board.tagVisibility, ['hover', 'always', 'hidden'], 'hover'),
      connectionDisplay: oneOf(
        document.board.connectionDisplay,
        ['full', 'adaptive', 'minimal', 'hidden'],
        'adaptive'
      ),
      crossingStyle: oneOf(document.board.crossingStyle, ['plain', 'bridge', 'gap'], 'plain'),
      commentView: oneOf(document.board.commentView, ['open', 'all', 'resolved', 'hidden'], 'open'),
      createdAt: now,
      updatedAt: now
    })
    .run()
  const below = tx
    .select({ y: boardObjects.y, height: boardObjects.height })
    .from(boardObjects)
    .where(and(eq(boardObjects.boardId, parentBoardId), isNull(boardObjects.deletedAt)))
    .all()
  const y = below.reduce((max, row) => Math.max(max, row.y + row.height), 40) + 24
  tx.insert(boardObjects)
    .values({
      id: randomUUID(),
      boardId: parentBoardId,
      type: 'board',
      linkedBoardId: boardId,
      x: 80,
      y,
      width: 280,
      height: 180,
      zIndex: below.length + 1,
      createdAt: now,
      updatedAt: now
    })
    .run()
  for (const object of document.objects) {
    const id = ids.get(object.id)!
    let linked = object.linkedBoardId
    let data = remapData(object.type, object.data, ids)
    if (linked && ids.has(linked)) linked = ids.get(linked)!
    else if (linked && !known.boards.has(linked)) {
      data = { ...data, unavailableBoardId: linked }
      linked = null
    }
    data = settle(object.type, data, known)
    const assetId = object.assetSha ? assetIds.get(object.assetSha) : null
    if (object.assetSha && !assetId) throw new Error('The board package is missing a file it uses.')
    tx.insert(boardObjects)
      .values({
        id,
        boardId,
        type: object.type,
        x: object.x,
        y: object.y,
        width: object.width,
        height: object.height,
        rotation: object.rotation,
        zIndex: object.zIndex,
        locked: object.locked === true,
        groupId: object.groupId ? (ids.get(object.groupId) ?? null) : null,
        assetId: assetId ?? null,
        linkedBoardId: linked,
        data,
        createdAt: now,
        updatedAt: now
      })
      .run()
  }
  for (const slide of document.slides) {
    const stackId = ids.get(slide.stackId)
    const assetId = assetIds.get(slide.assetSha)
    if (!stackId || !assetId) throw new Error('The board package is missing a stack image.')
    tx.insert(stackSlides)
      .values({
        id: ids.get(slide.id)!,
        stackId,
        assetId,
        position: slide.position,
        cropX: slide.cropX,
        cropY: slide.cropY,
        cropW: slide.cropW,
        cropH: slide.cropH,
        layoutX: slide.layoutX,
        layoutY: slide.layoutY,
        layoutWidth: slide.layoutWidth,
        layoutHeight: slide.layoutHeight,
        layoutRotation: slide.layoutRotation,
        layoutCropX: slide.layoutCropX,
        layoutCropY: slide.layoutCropY,
        layoutCropW: slide.layoutCropW,
        layoutCropH: slide.layoutCropH,
        sourceObjectId: slide.sourceObjectId
          ? (ids.get(slide.sourceObjectId) ?? slide.sourceObjectId)
          : null,
        createdAt: now,
        updatedAt: now
      })
      .run()
  }
  for (const message of document.messages) {
    const commentId = ids.get(message.commentId)
    if (!commentId || typeof message.body !== 'string') continue
    tx.insert(commentMessages)
      .values({
        id: randomUUID(),
        commentId,
        body: message.body.slice(0, 10000),
        editedAt: message.editedAt ? new Date(message.editedAt) : null,
        createdAt: now,
        updatedAt: now
      })
      .run()
  }
  for (const preview of document.previews) {
    const objectId = ids.get(preview.objectId)
    if (!objectId) continue
    let imageFile: string | null = null
    const safeName = safePreviewName(preview.imageFile)
    if (safeName) {
      const ext = safeName.slice(safeName.lastIndexOf('.') + 1)
      imageFile = `${objectId}.${ext}`
      const target = join(projectPath, 'thumbs', 'link-previews', imageFile)
      mkdirSync(dirname(target), { recursive: true })
      copyFileSync(join(root, 'previews', safeName), target)
      copied.push(target)
    }
    tx.insert(linkPreviews)
      .values({
        objectId,
        url: preview.url,
        title: preview.title,
        description: preview.description,
        imageFile,
        fetchedAt: now,
        error: preview.error
      })
      .run()
  }
  const tagIds = placeTags(tx, document, ids, freshAssets)
  for (const tagging of document.taggings) {
    const tagId = tagIds.get(tagging.tagId)
    const targetId = retarget(tagging.targetType, tagging.targetId, ids, freshAssets)
    if (!tagId || !targetId) continue
    tx.insert(taggings)
      .values({
        id: randomUUID(),
        tagId,
        targetType: tagging.targetType,
        targetId,
        createdAt: now
      })
      .run()
  }
  return boardId
}

function placeTags(
  tx: ProjectDb,
  document: BoardDocument,
  ids: Map<string, string>,
  freshAssets: Set<string>
): Map<string, string> {
  const used = new Set<string>()
  for (const tagging of document.taggings) {
    if (retarget(tagging.targetType, tagging.targetId, ids, freshAssets)) used.add(tagging.tagId)
  }
  const mapped = new Map<string, string>()
  const now = new Date()
  for (const tag of document.tags) {
    if (!used.has(tag.id)) continue
    if (tag.reusable) {
      const same = tx.select().from(tags).where(eq(tags.id, tag.id)).get()
      if (same && !same.deletedAt && same.reusable && same.normalizedName === tag.normalizedName) {
        mapped.set(tag.id, same.id)
        continue
      }
      const parts = uniqueTagName(tx, tag.name)
      const id = randomUUID()
      tx.insert(tags)
        .values({
          id,
          name: parts.name,
          normalizedName: parts.normalized,
          color: tag.color ? tagColor(tag.color) : null,
          reusable: true,
          createdAt: now,
          updatedAt: now
        })
        .run()
      mapped.set(tag.id, id)
      continue
    }
    const ownerId = tag.ownerId ? ids.get(tag.ownerId) : null
    if (!ownerId || !tag.ownerType) continue
    const parts = tagNameParts(tag.name)
    const id = randomUUID()
    tx.insert(tags)
      .values({
        id,
        name: parts.name,
        normalizedName: parts.normalized,
        color: tag.color ? tagColor(tag.color) : null,
        reusable: false,
        ownerType: tag.ownerType,
        ownerId,
        createdAt: now,
        updatedAt: now
      })
      .run()
    mapped.set(tag.id, id)
  }
  return mapped
}

function uniqueTagName(tx: ProjectDb, name: string): { name: string; normalized: string } {
  const base = tagNameParts(name)
  for (let extra = 0; extra < 20; extra += 1) {
    const candidate =
      extra === 0 ? base : tagNameParts(`${base.name} (imported${extra > 1 ? ` ${extra}` : ''})`)
    const clash = tx
      .select({ id: tags.id })
      .from(tags)
      .where(
        and(
          eq(tags.normalizedName, candidate.normalized),
          eq(tags.reusable, true),
          isNull(tags.deletedAt)
        )
      )
      .get()
    if (!clash) return candidate
  }
  return tagNameParts(`${base.name} ${randomUUID().slice(0, 8)}`)
}

function retarget(
  type: string,
  id: string,
  ids: Map<string, string>,
  freshAssets: Set<string>
): string | null {
  const next = ids.get(id) ?? null
  if (!next) return null
  if (type === 'asset') return freshAssets.has(next) ? next : null
  if (type === 'object' || type === 'slide' || type === 'board') return next
  return null
}

function remapData(
  type: string,
  raw: Record<string, unknown>,
  ids: Map<string, string>
): Record<string, unknown> {
  if (type === 'connection') {
    const connection = parseConnection(raw)
    return connection ? { ...remapConnection(connection, ids, false) } : { ...raw }
  }
  if (type === 'comment') {
    const comment = parseComment(raw)
    if (!comment) return { ...raw }
    const targetId = comment.anchor.targetId
      ? (ids.get(comment.anchor.targetId) ?? comment.anchor.targetId)
      : null
    const slideId = comment.anchor.slideId
      ? (ids.get(comment.anchor.slideId) ?? comment.anchor.slideId)
      : null
    return { ...comment, anchor: { ...comment.anchor, targetId, slideId } }
  }
  const data = { ...raw }
  if (data.destination) {
    const destination = parseDestination(data.destination)
    if (destination) data.destination = remapDestination(destination, ids, false) ?? destination
  }
  if (data.navLink) {
    const destination = parseDestination(data.navLink)
    if (destination) data.navLink = remapDestination(destination, ids, false) ?? destination
  }
  if (data.labelLink) {
    const destination = parseDestination(data.labelLink)
    if (destination) data.labelLink = remapDestination(destination, ids, false) ?? destination
  }
  return data
}

function settle(
  type: string,
  raw: Record<string, unknown>,
  known: KnownIds
): Record<string, unknown> {
  if (type === 'connection') {
    const connection = parseConnection(raw)
    if (!connection) return raw
    return { ...settleConnection(connection, known) }
  }
  if (type === 'comment') {
    const comment = parseComment(raw)
    if (!comment || comment.anchor.detached === 'user') return raw
    const targetGone = !!comment.anchor.targetId && !known.objects.has(comment.anchor.targetId)
    const slideGone = !!comment.anchor.slideId && !known.slides.has(comment.anchor.slideId)
    if (!targetGone && !slideGone && comment.anchor.detached === 'missing') {
      return { ...comment, anchor: { ...comment.anchor, detached: 'none' } }
    }
    if (targetGone || slideGone) {
      return { ...comment, anchor: { ...comment.anchor, detached: 'missing' } }
    }
  }
  return raw
}

function settleConnection(data: ConnectionData, known: KnownIds): ConnectionData {
  const endpoint = (end: ConnectionData['start']): ConnectionData['start'] => {
    const attachment = end.attachment
    if (!attachment || attachment.userHeld) return end
    const present =
      attachment.kind === 'group'
        ? known.groups.has(attachment.id)
        : known.objects.has(attachment.id)
    return {
      ...end,
      attachment: { ...attachment, missing: !present }
    }
  }
  return { ...data, start: endpoint(data.start), end: endpoint(data.end) }
}

function knownIds(db: ProjectDb): KnownIds {
  const objects = db
    .select({ id: boardObjects.id, groupId: boardObjects.groupId })
    .from(boardObjects)
    .where(isNull(boardObjects.deletedAt))
    .all()
  return {
    objects: new Set(objects.map((row) => row.id)),
    boards: new Set(
      db
        .select({ id: boards.id })
        .from(boards)
        .where(isNull(boards.deletedAt))
        .all()
        .map((row) => row.id)
    ),
    slides: new Set(
      db
        .select({ id: stackSlides.id })
        .from(stackSlides)
        .all()
        .map((row) => row.id)
    ),
    groups: new Set(objects.map((row) => row.groupId).filter((id): id is string => !!id))
  }
}

function safePreviewName(value: string | null): string | null {
  if (!value || !/^[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$/i.test(value)) return null
  return value
}

async function relativeFiles(root: string): Promise<string[]> {
  const found: string[] = []
  const walk = async (dir: string, prefix: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new Error('The archive contains a link, which was not extracted.')
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(dir, entry.name), rel)
      else found.push(rel)
    }
  }
  await walk(root, '')
  return found
}

function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function oneOf(value: unknown, allowed: string[], fallback: string): string {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}
