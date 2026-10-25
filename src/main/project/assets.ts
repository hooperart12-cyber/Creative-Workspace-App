import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { eq, inArray } from 'drizzle-orm'
import sharp from 'sharp'
import { SUPPORTED_IMAGES_LABEL, THUMBNAIL_SIZES } from '@shared/assets'
import type { AssetInfo, AssetVariant, ImportBytesInput, ImportResult } from '@shared/types'
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
    folderId: row.folderId
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
    if (variant === 'original' || !THUMBNAIL_SIZES.includes(variant)) return original
    if (!needsThumbnail(row, variant)) return original
    const thumbnail = await this.ensureThumbnail(row, variant)
    return thumbnail ? { path: thumbnail, mime: 'image/webp' } : original
  }

  /** Copies an asset's original to `destination` ("Download original"). */
  async exportOriginal(id: string, destination: string): Promise<void> {
    const asset = this.get(id)
    await copyFile(this.originalPath(asset.sha256, asset.ext), destination)
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
      const image = await readImageInfo(temp)
      await placeFile(temp, this.originalPath(sha256, image.ext))
      const asset = this.register({
        sha256,
        originalName: cleanName(name, image.ext),
        bytes,
        folderId: options.folderId ?? null,
        ...image
      })
      // Make the thumbnails now so the board shows them right away.
      await Promise.all(
        THUMBNAIL_SIZES.filter((size) => needsThumbnail(asset, size)).map((size) =>
          this.ensureThumbnail(asset, size)
        )
      )
      return asset
    } finally {
      await rm(temp, { force: true })
    }
  }

  /** Adds the asset row, or returns the existing one for identical content (restoring it if trashed). */
  private register(input: Omit<AssetInfo, 'id'>): AssetInfo {
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
    return { id, ...input }
  }
}

/** Reads what the app needs to know about an image, rejecting formats it can't show. */
async function readImageInfo(
  path: string
): Promise<{ mime: string; ext: string; width: number; height: number; hasAlpha: boolean }> {
  let meta
  try {
    meta = await sharp(path).metadata()
  } catch {
    throw new UnsupportedFileError(`Not a ${SUPPORTED_IMAGES_LABEL} image.`)
  }
  const format = IMAGE_FORMATS[meta.format]
  if (!format) throw new UnsupportedFileError(`Not a ${SUPPORTED_IMAGES_LABEL} image.`)
  const { width, height } = meta.autoOrient
  if (!width || !height) throw new UnsupportedFileError('The image has no size.')
  return { ...format, width, height, hasAlpha: meta.hasAlpha }
}

function needsThumbnail(asset: Pick<AssetInfo, 'width' | 'height'>, size: number): boolean {
  return Math.max(asset.width ?? 0, asset.height ?? 0) > size
}

/** A readable name for the library, e.g. for pasted images that arrive without one. */
function cleanName(name: string, ext: string): string {
  const trimmed = name.trim()
  return trimmed || `Image.${ext}`
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
