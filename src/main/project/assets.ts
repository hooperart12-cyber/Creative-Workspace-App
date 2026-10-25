import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { SUPPORTED_IMAGES_LABEL, THUMBNAIL_SIZES } from '@shared/assets'
import { mimeForExtension, safeExtension } from '@shared/files'
import type { AssetInfo, AssetVariant, ImportBytesInput, ImportResult } from '@shared/types'
import { inspectPdf } from './pdfInfo'
import type { ProjectDb } from '../db/client'
import { assets } from '../db/schema'

// Don't keep decoded files open between operations: on Windows an open handle blocks
// renaming and deleting, and originals are only read once per thumbnail anyway.
sharp.cache(false)

/** Formats that can be shown on a board, by the decoder name sharp reports (ADR-007, ADR-013). */
const IMAGE_FORMATS: Record<string, { mime: string; ext: string }> = {
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  png: { mime: 'image/png', ext: 'png' },
  webp: { mime: 'image/webp', ext: 'webp' }
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/

/** Files imported at the same time; keeps memory use steady for big batches. */
const IMPORT_CONCURRENCY = 3

/** A file that can't be imported, with a message for the user. */
export class UnsupportedFileError extends Error {}

export interface ImportOptions {
  /** Library folder for new assets (M4); null or omitted is the top level. */
  folderId?: string | null
  /**
   * Image tool only. Anything that isn't a JPG, PNG or WebP is skipped.
   * Drop, paste and the File tool leave this off and accept PDFs and other files.
   */
  imagesOnly?: boolean
}

type AssetRow = typeof assets.$inferSelect

export function toAssetInfo(row: AssetRow): AssetInfo {
  return {
    id: row.id,
    sha256: row.sha256,
    originalName: row.originalName,
    mime: row.mime,
    ext: row.ext,
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    hasAlpha: row.hasAlpha,
    pageCount: row.pageCount,
    folderId: row.folderId,
    previewAssetId: row.previewAssetId,
    preview: null
  }
}

/** Fills `preview` from `previewAssetId`. One card's preview is the file's preview. */
export function attachPreviews(db: ProjectDb, infos: AssetInfo[]): void {
  const ids = [
    ...new Set(infos.flatMap((info) => (info.previewAssetId ? [info.previewAssetId] : [])))
  ]
  if (ids.length === 0) return
  const rows = db.select().from(assets).where(inArray(assets.id, ids)).all()
  const byId = new Map(rows.map((row) => [row.id, row]))
  for (const info of infos) {
    const preview = info.previewAssetId ? byId.get(info.previewAssetId) : undefined
    if (preview && !preview.deletedAt && preview.width && preview.height) {
      info.preview = { sha256: preview.sha256, width: preview.width, height: preview.height }
    }
  }
}

/**
 * The project's file library on disk (ADR-005). Imports are copied byte-for-byte into
 * `assets/<sha[0..2]>/<sha>.<ext>` and never modified; identical files are stored once.
 * Thumbnails in `thumbs/` are generated from the original and can be regenerated any time.
 */
export class AssetRepository {
  /** Thumbnails being generated, so concurrent requests share one job. */
  private readonly pendingThumbnails = new Map<string, Promise<string | null>>()

  constructor(
    private readonly db: ProjectDb,
    private readonly projectPath: string
  ) {}

  /** Copies a file from disk into the library. */
  async importFile(path: string, options: ImportOptions = {}): Promise<AssetInfo> {
    let info
    try {
      info = await stat(path)
    } catch {
      throw new UnsupportedFileError('The file could not be found.')
    }
    if (!info.isFile()) throw new UnsupportedFileError('Folders can’t be imported yet.')
    return this.ingest(basename(path), () => createReadStream(path), options)
  }

  /** Stores bytes that didn't come from a file on disk (screenshots, browser images). */
  importBytes(name: string, bytes: Uint8Array, options: ImportOptions = {}): Promise<AssetInfo> {
    return this.ingest(name, () => Readable.from([Buffer.from(bytes)]), options)
  }

  /** Imports several files from disk. Files that can't be imported are reported, not thrown. */
  importFiles(paths: string[], options: ImportOptions = {}): Promise<ImportResult> {
    return this.importEach(paths, basename, (path) => this.importFile(path, options))
  }

  importByteFiles(files: ImportBytesInput[], options: ImportOptions = {}): Promise<ImportResult> {
    return this.importEach(
      files,
      (file) => file.name || 'Pasted image',
      (file) => this.importBytes(file.name, file.bytes, options)
    )
  }

  get(id: string): AssetInfo {
    const row = this.db.select().from(assets).where(eq(assets.id, id)).get()
    if (!row) throw new Error('File not found in the library.')
    return toAssetInfo(row)
  }

  byIds(ids: string[]): Map<string, AssetInfo> {
    if (ids.length === 0) return new Map()
    const rows = this.db.select().from(assets).where(inArray(assets.id, ids)).all()
    return new Map(rows.map((row) => [row.id, toAssetInfo(row)]))
  }

  /** Absolute path of an asset's stored original. */
  originalPath(sha256: string, ext: string): string {
    return join(this.projectPath, 'assets', sha256.slice(0, 2), `${sha256}.${ext}`)
  }

  /**
   * Bytes `[start, end)` of an asset's original. Used by the PDF reader, which
   * cannot fetch the custom asset URL from script. Never returns more than asked.
   */
  async readRange(id: string, start: number, end: number): Promise<Uint8Array> {
    const length = end - start
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      length < 0 ||
      length > 8 * 1024 * 1024
    ) {
      throw new Error('That part of the file can’t be read.')
    }
    const asset = this.get(id)
    const file = await open(this.originalPath(asset.sha256, asset.ext), 'r')
    try {
      const { size } = await file.stat()
      if (start >= size || length === 0) return new Uint8Array()
      const count = Math.min(length, size - start)
      const buf = Buffer.alloc(count)
      await file.read(buf, 0, count, start)
      const out = new Uint8Array(count)
      out.set(buf)
      return out
    } finally {
      await file.close()
    }
  }

  thumbnailPath(sha256: string, size: number): string {
    return join(this.projectPath, 'thumbs', `${sha256}_${size}.webp`)
  }

  /**
   * The file to serve for an asset URL, or null if there's no such asset. Thumbnails are
   * (re)generated on demand; if that fails, or the image is already small, the original is used.
   */
  async fileFor(
    sha256: string,
    variant: AssetVariant
  ): Promise<{ path: string; mime: string } | null> {
    if (!SHA256_PATTERN.test(sha256)) return null
    const row = this.db.select().from(assets).where(eq(assets.sha256, sha256)).get()
    if (!row) return null
    const original = { path: this.originalPath(row.sha256, row.ext), mime: row.mime }
    // A PDF's 1024 variant is the first-page cover, never the PDF itself (an <img> can't show it).
    if (row.mime === 'application/pdf' && variant !== 'original') {
      const cover = this.thumbnailPath(row.sha256, 1024)
      return existsSync(cover) ? { path: cover, mime: 'image/webp' } : null
    }
    if (variant === 'original' || !THUMBNAIL_SIZES.includes(variant)) return original
    if (!needsThumbnail(row, variant)) return original
    const thumbnail = await this.ensureThumbnail(row, variant)
    return thumbnail ? { path: thumbnail, mime: 'image/webp' } : original
  }

  /** Copies an asset's original to `destination` ("Download original"). */
  async exportOriginal(id: string, destination: string): Promise<void> {
    const asset = this.get(id)
    // Copy under a temporary name, then rename: the file only appears under its real name
    // once it's complete, and an existing file is either fully replaced or left as it was.
    const temp = join(dirname(destination), `.${basename(destination)}.${randomUUID()}.part`)
    try {
      await copyFile(this.originalPath(asset.sha256, asset.ext), temp)
      await replaceFile(temp, destination)
    } catch (error) {
      await rm(temp, { force: true })
      throw error
    }
  }

  /** Stores the first-page cover a window rendered. The original PDF is not touched. */
  async saveCover(id: string, png: Uint8Array): Promise<void> {
    const asset = this.get(id)
    if (asset.mime !== 'application/pdf') throw new Error('Only a PDF has a page cover.')
    const path = this.thumbnailPath(asset.sha256, 1024)
    const temp = `${path}.${randomUUID()}.tmp`
    await mkdir(dirname(path), { recursive: true })
    try {
      await sharp(Buffer.from(png))
        .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toFile(temp)
      await replaceFile(temp, path)
    } finally {
      await rm(temp, { force: true })
    }
  }

  /** Records page size after a password PDF is unlocked. The password is not stored. */
  recordPdfInfo(id: string, info: { pageCount: number; width: number; height: number }): void {
    const row = this.db.select().from(assets).where(eq(assets.id, id)).get()
    if (!row || row.mime !== 'application/pdf') throw new Error('Not a PDF.')
    this.db
      .update(assets)
      .set({
        pageCount: Math.max(1, Math.round(info.pageCount)),
        width: Math.max(1, Math.round(info.width)),
        height: Math.max(1, Math.round(info.height)),
        updatedAt: new Date()
      })
      .where(eq(assets.id, id))
      .run()
  }

  /**
   * Points a file at a preview image, or clears it. The image asset stays in the library
   * either way — another card may still use it.
   */
  setPreview(assetId: string, previewAssetId: string | null): void {
    const asset = this.db.select().from(assets).where(eq(assets.id, assetId)).get()
    if (!asset || asset.deletedAt) throw new Error('File not found in the library.')
    if (previewAssetId) {
      const preview = this.db.select().from(assets).where(eq(assets.id, previewAssetId)).get()
      if (!preview || preview.deletedAt || !preview.width || !preview.height) {
        throw new Error('A preview has to be a JPG, PNG or WebP image.')
      }
      if (preview.id === asset.id) throw new Error('A file can’t preview itself.')
    }
    this.db
      .update(assets)
      .set({ previewAssetId, updatedAt: new Date() })
      .where(eq(assets.id, assetId))
      .run()
  }

  /** Creates a thumbnail if it's missing. Returns its path, or null if it can't be made. */
  ensureThumbnail(asset: Pick<AssetInfo, 'sha256' | 'ext'>, size: number): Promise<string | null> {
    const path = this.thumbnailPath(asset.sha256, size)
    if (existsSync(path)) return Promise.resolve(path)
    const pending = this.pendingThumbnails.get(path)
    if (pending) return pending
    const job = (async () => {
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await mkdir(dirname(path), { recursive: true })
        // The original is only read. The thumbnail is upright (EXIF applied), keeps
        // transparency, and is never larger than the original.
        await sharp(this.originalPath(asset.sha256, asset.ext))
          .autoOrient()
          .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
          .webp({ quality: 85, alphaQuality: 100 })
          .toFile(temp)
        await placeFile(temp, path)
        return path
      } catch {
        return null
      } finally {
        await rm(temp, { force: true })
        this.pendingThumbnails.delete(path)
      }
    })()
    this.pendingThumbnails.set(path, job)
    return job
  }

  /** Runs imports a few at a time (hashing and thumbnails run off the main thread) and keeps their order. */
  private async importEach<T>(
    items: T[],
    nameOf: (item: T) => string,
    importOne: (item: T) => Promise<AssetInfo>
  ): Promise<ImportResult> {
    const results: ({ asset: AssetInfo } | { name: string; reason: string })[] = []
    let next = 0
    const worker = async () => {
      while (next < items.length) {
        const index = next++
        const item = items[index]
        try {
          results[index] = { asset: await importOne(item) }
        } catch (error) {
          const reason =
            error instanceof UnsupportedFileError
              ? error.message
              : `Could not be imported (${error instanceof Error ? error.message : String(error)}).`
          results[index] = { name: nameOf(item), reason }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, items.length) }, worker))
    const imported: AssetInfo[] = []
    const skipped: ImportResult['skipped'] = []
    for (const result of results) {
      if ('asset' in result) {
        // The same file twice in one import is placed once.
        if (!imported.some((a) => a.id === result.asset.id)) imported.push(result.asset)
      } else skipped.push(result)
    }
    return { imported, skipped }
  }

  private async ingest(
    name: string,
    source: () => NodeJS.ReadableStream,
    options: ImportOptions
  ): Promise<AssetInfo> {
    const incoming = join(this.projectPath, 'assets', '.incoming')
    await mkdir(incoming, { recursive: true })
    const temp = join(incoming, randomUUID())
    const hash = createHash('sha256')
    let bytes = 0
    try {
      // Copy and hash in one pass. The bytes are passed through untouched.
      await pipeline(
        source(),
        new Transform({
          transform(chunk: Buffer, _encoding, done) {
            hash.update(chunk)
            bytes += chunk.length
            done(null, chunk)
          }
        }),
        createWriteStream(temp, { flags: 'wx' })
      )
      if (bytes === 0) throw new UnsupportedFileError('The file is empty.')
      const sha256 = hash.digest('hex')
      const described = await describeFile(temp, name, options)
      await placeFile(temp, this.originalPath(sha256, described.ext))
      const asset = this.register({
        sha256,
        originalName: cleanName(
          name,
          described.ext,
          described.mime.startsWith('image/') ? 'Image' : 'File'
        ),
        bytes,
        folderId: options.folderId ?? null,
        ...described
      })
      // Image thumbnails are ready immediately. PDF covers are rendered by the importing window.
      if (described.mime.startsWith('image/')) {
        await Promise.all(
          THUMBNAIL_SIZES.filter((size) => needsThumbnail(asset, size)).map((size) =>
            this.ensureThumbnail(asset, size)
          )
        )
      }
      return asset
    } finally {
      await rm(temp, { force: true })
    }
  }

  /** Adds the asset row, or returns the existing one for identical content (restoring it if trashed). */
  private register(input: Omit<AssetInfo, 'id' | 'preview'>): AssetInfo {
    const existing = this.db.select().from(assets).where(eq(assets.sha256, input.sha256)).get()
    const now = new Date()
    if (existing) {
      if (existing.deletedAt) {
        this.db
          .update(assets)
          .set({ deletedAt: null, updatedAt: now })
          .where(eq(assets.id, existing.id))
          .run()
      }
      return toAssetInfo({ ...existing, deletedAt: null })
    }
    const id = randomUUID()
    this.db
      .insert(assets)
      .values({ id, ...input, createdAt: now, updatedAt: now })
      .run()
    return { id, ...input, preview: null }
  }
}

type StoredMeta = Omit<
  AssetInfo,
  'id' | 'sha256' | 'originalName' | 'bytes' | 'folderId' | 'preview'
>

/** Image, PDF, or anything else. Images win when the bytes are a JPG, PNG or WebP. */
async function describeFile(
  path: string,
  name: string,
  options: ImportOptions
): Promise<StoredMeta> {
  const image = await readImageInfo(path)
  if (image) return { ...image, pageCount: null, previewAssetId: null }
  if (options.imagesOnly) throw new UnsupportedFileError(`Not a ${SUPPORTED_IMAGES_LABEL} image.`)

  const ext = safeExtension(name)
  const header = await readHeader(path)
  if (header.startsWith('%PDF-') || ext === 'pdf') {
    if (!header.startsWith('%PDF-')) throw new UnsupportedFileError('This file isn’t a valid PDF.')
    const info = await inspectPdf(path)
    if (info.kind === 'invalid') throw new UnsupportedFileError('This file isn’t a valid PDF.')
    if (info.kind === 'encrypted') {
      return {
        mime: 'application/pdf',
        ext: 'pdf',
        width: null,
        height: null,
        hasAlpha: null,
        pageCount: null,
        previewAssetId: null
      }
    }
    return {
      mime: 'application/pdf',
      ext: 'pdf',
      width: Math.max(1, Math.round(info.width)),
      height: Math.max(1, Math.round(info.height)),
      hasAlpha: null,
      pageCount: info.pageCount,
      previewAssetId: null
    }
  }
  return {
    mime: mimeForExtension(ext),
    ext,
    width: null,
    height: null,
    hasAlpha: null,
    pageCount: null,
    previewAssetId: null
  }
}

/** What the app needs to show an image, or null when the bytes aren't a JPG, PNG or WebP. */
async function readImageInfo(
  path: string
): Promise<{ mime: string; ext: string; width: number; height: number; hasAlpha: boolean } | null> {
  let meta
  try {
    meta = await sharp(path).metadata()
  } catch {
    return null
  }
  const format = meta.format ? IMAGE_FORMATS[meta.format] : undefined
  if (!format) return null
  const { width, height } = meta.autoOrient
  if (!width || !height) return null
  return { ...format, width, height, hasAlpha: meta.hasAlpha ?? false }
}

async function readHeader(path: string): Promise<string> {
  const file = await open(path, 'r')
  try {
    const buf = Buffer.alloc(5)
    await file.read(buf, 0, 5, 0)
    return buf.toString('latin1')
  } finally {
    await file.close()
  }
}

function needsThumbnail(asset: Pick<AssetInfo, 'width' | 'height'>, size: number): boolean {
  return Math.max(asset.width ?? 0, asset.height ?? 0) > size
}

/** A readable name for the library, e.g. for pasted images that arrive without one. */
function cleanName(name: string, ext: string, fallback: string): string {
  const trimmed = name.trim()
  return trimmed || `${fallback}.${ext}`
}

/**
 * Moves a finished temp file into place. If the target already exists (same content),
 * the temp file is dropped. Retries briefly because sync tools and virus scanners
 * (OneDrive, Defender) can hold new files for a moment.
 */
async function placeFile(temp: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true })
  for (let attempt = 0; ; attempt++) {
    if (existsSync(target)) {
      await rm(temp, { force: true })
      return
    }
    try {
      await rename(temp, target)
      return
    } catch (error) {
      if (attempt >= 4) throw error
      await delay(100 * (attempt + 1))
    }
  }
}

/** Moves a finished temp file over `target`, replacing it. Retries like `placeFile`. */
async function replaceFile(temp: string, target: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(temp, target)
      return
    } catch (error) {
      if (attempt >= 4) throw error
      await delay(100 * (attempt + 1))
    }
  }
}
