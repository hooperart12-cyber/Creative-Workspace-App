import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { assets } from '../db/schema'
import { UnsupportedFileError } from './assets'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-assets-'))
  project = Project.create(dir, 'Art', migrations)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** Writes a test image into the temp folder and returns its path and bytes. */
async function makeImage(
  name: string,
  options: {
    width: number
    height: number
    format: 'png' | 'jpeg' | 'webp'
    alpha?: boolean
    orientation?: number
  }
): Promise<{ path: string; bytes: Buffer }> {
  let image = sharp({
    create: {
      width: options.width,
      height: options.height,
      channels: options.alpha ? 4 : 3,
      background: options.alpha ? { r: 200, g: 40, b: 40, alpha: 0.4 } : { r: 30, g: 90, b: 160 }
    }
  })
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation })
  const bytes = await image.toFormat(options.format).toBuffer()
  const path = join(dir, name)
  writeFileSync(path, bytes)
  return { path, bytes }
}

describe('AssetRepository.importFile', () => {
  it('stores a byte-for-byte copy named by its SHA-256 and records its metadata', async () => {
    const { path, bytes } = await makeImage('Hero sketch.png', {
      width: 640,
      height: 480,
      format: 'png',
      alpha: true
    })
    const asset = await project.assets.importFile(path)

    expect(asset).toMatchObject({
      sha256: sha256(bytes),
      originalName: 'Hero sketch.png',
      mime: 'image/png',
      ext: 'png',
      bytes: bytes.length,
      width: 640,
      height: 480,
      hasAlpha: true,
      folderId: null
    })
    const stored = project.assets.originalPath(asset.sha256, asset.ext)
    expect(stored).toBe(
      join(project.path, 'assets', asset.sha256.slice(0, 2), `${asset.sha256}.png`)
    )
    // The original is never modified or recompressed.
    expect(readFileSync(stored).equals(bytes)).toBe(true)
    // The source file is untouched too.
    expect(readFileSync(path).equals(bytes)).toBe(true)
    // No temp files are left behind.
    expect(readdirSync(join(project.path, 'assets', '.incoming'))).toEqual([])
  })

  it('accepts JPEG and WebP and keeps the original bytes', async () => {
    const jpeg = await makeImage('photo.jpeg', { width: 300, height: 200, format: 'jpeg' })
    const webp = await makeImage('ref.webp', {
      width: 120,
      height: 90,
      format: 'webp',
      alpha: true
    })
    const a = await project.assets.importFile(jpeg.path)
    const b = await project.assets.importFile(webp.path)
    expect(a).toMatchObject({ mime: 'image/jpeg', ext: 'jpg', hasAlpha: false })
    expect(b).toMatchObject({ mime: 'image/webp', ext: 'webp', hasAlpha: true })
    expect(readFileSync(project.assets.originalPath(a.sha256, a.ext)).equals(jpeg.bytes)).toBe(true)
    expect(readFileSync(project.assets.originalPath(b.sha256, b.ext)).equals(webp.bytes)).toBe(true)
  })

  it('stores identical files once, even under different names', async () => {
    const { path, bytes } = await makeImage('a.png', { width: 50, height: 50, format: 'png' })
    const copy = join(dir, 'b.png')
    writeFileSync(copy, bytes)
    const first = await project.assets.importFile(path)
    const second = await project.assets.importFile(copy)
    expect(second.id).toBe(first.id)
    expect(project.db.select().from(assets).all()).toHaveLength(1)
    expect(readdirSync(join(project.path, 'assets', first.sha256.slice(0, 2)))).toEqual([
      `${first.sha256}.png`
    ])
  })

  it('brings a trashed asset back when the same file is imported again', async () => {
    const { path } = await makeImage('a.png', { width: 50, height: 50, format: 'png' })
    const first = await project.assets.importFile(path)
    project.db.update(assets).set({ deletedAt: new Date() }).where(eq(assets.id, first.id)).run()
    const again = await project.assets.importFile(path)
    expect(again.id).toBe(first.id)
    expect(project.db.select().from(assets).get()?.deletedAt).toBeNull()
  })

  it('restores a stored original that went missing on disk', async () => {
    const { path, bytes } = await makeImage('a.png', { width: 50, height: 50, format: 'png' })
    const asset = await project.assets.importFile(path)
    const stored = project.assets.originalPath(asset.sha256, asset.ext)
    rmSync(stored)
    await project.assets.importFile(path)
    expect(readFileSync(stored).equals(bytes)).toBe(true)
  })

  it('rejects files that are not JPG, PNG or WebP, whatever their extension says', async () => {
    const fake = join(dir, 'notes.png')
    writeFileSync(fake, 'just some text')
    await expect(project.assets.importFile(fake)).rejects.toBeInstanceOf(UnsupportedFileError)

    const tiff = join(dir, 'scan.tif')
    writeFileSync(
      tiff,
      await sharp({ create: { width: 10, height: 10, channels: 3, background: '#fff' } })
        .tiff()
        .toBuffer()
    )
    await expect(project.assets.importFile(tiff)).rejects.toThrow(/JPG, PNG or WebP/)

    const empty = join(dir, 'empty.png')
    writeFileSync(empty, '')
    await expect(project.assets.importFile(empty)).rejects.toThrow(/empty/)

    await expect(project.assets.importFile(join(dir, 'missing.png'))).rejects.toThrow(
      /not be found/
    )
    await expect(project.assets.importFile(dir)).rejects.toThrow(/Folders/)

    // Nothing was stored.
    expect(project.db.select().from(assets).all()).toEqual([])
    expect(readdirSync(join(project.path, 'assets', '.incoming'))).toEqual([])
  })

  it('reports the upright size of photos with an EXIF rotation, without changing the file', async () => {
    // Stored 400×200, but EXIF orientation 6 means it's shown rotated 90°: 200×400.
    const { path, bytes } = await makeImage('phone.jpg', {
      width: 400,
      height: 200,
      format: 'jpeg',
      orientation: 6
    })
    const asset = await project.assets.importFile(path)
    expect(asset).toMatchObject({ width: 200, height: 400 })
    expect(readFileSync(project.assets.originalPath(asset.sha256, asset.ext)).equals(bytes)).toBe(
      true
    )
  })
})

describe('AssetRepository.importBytes', () => {
  it('stores pasted bytes like a file and names them', async () => {
    const bytes = await sharp({
      create: { width: 30, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
    })
      .png()
      .toBuffer()
    const asset = await project.assets.importBytes('', new Uint8Array(bytes))
    expect(asset).toMatchObject({
      originalName: 'Image.png',
      width: 30,
      height: 20,
      hasAlpha: true
    })
    expect(readFileSync(project.assets.originalPath(asset.sha256, asset.ext)).equals(bytes)).toBe(
      true
    )
  })
})

describe('thumbnails', () => {
  it('makes 256 and 1024 px WebP thumbnails for large images, keeping transparency', async () => {
    const { path, bytes } = await makeImage('big.png', {
      width: 2000,
      height: 1000,
      format: 'png',
      alpha: true
    })
    const asset = await project.assets.importFile(path)
    for (const size of [256, 1024]) {
      const thumb = project.assets.thumbnailPath(asset.sha256, size)
      const meta = await sharp(thumb).metadata()
      expect(meta).toMatchObject({ format: 'webp', width: size, height: size / 2, hasAlpha: true })
    }
    // Thumbnails never replace the original.
    expect(readFileSync(project.assets.originalPath(asset.sha256, asset.ext)).equals(bytes)).toBe(
      true
    )
  })

  it('skips thumbnails that would not be smaller than the original', async () => {
    const { path } = await makeImage('mid.jpg', { width: 600, height: 300, format: 'jpeg' })
    const asset = await project.assets.importFile(path)
    expect(existsSync(project.assets.thumbnailPath(asset.sha256, 256))).toBe(true)
    expect(existsSync(project.assets.thumbnailPath(asset.sha256, 1024))).toBe(false)
    // Asking for the 1024 version serves the original instead.
    expect(await project.assets.fileFor(asset.sha256, 1024)).toEqual({
      path: project.assets.originalPath(asset.sha256, asset.ext),
      mime: 'image/jpeg'
    })
  })

  it('regenerates deleted thumbnails on demand, upright for EXIF-rotated photos', async () => {
    const { path } = await makeImage('phone.jpg', {
      width: 800,
      height: 400,
      format: 'jpeg',
      orientation: 6
    })
    const asset = await project.assets.importFile(path)
    const thumb = project.assets.thumbnailPath(asset.sha256, 256)
    rmSync(thumb)
    expect(await project.assets.fileFor(asset.sha256, 256)).toEqual({
      path: thumb,
      mime: 'image/webp'
    })
    expect(await sharp(thumb).metadata()).toMatchObject({ width: 128, height: 256 })
  })
})

describe('AssetRepository.fileFor', () => {
  it('only serves files of known assets and rejects anything path-like', async () => {
    const { path } = await makeImage('a.png', { width: 50, height: 50, format: 'png' })
    const asset = await project.assets.importFile(path)
    expect((await project.assets.fileFor(asset.sha256, 'original'))?.path).toBe(
      project.assets.originalPath(asset.sha256, asset.ext)
    )
    expect(await project.assets.fileFor('0'.repeat(64), 'original')).toBeNull()
    expect(await project.assets.fileFor('../../project.db', 'original')).toBeNull()
    expect(await project.assets.fileFor(asset.sha256.toUpperCase(), 'original')).toBeNull()
  })

  it('exports the original under a new name, byte-for-byte', async () => {
    const { path, bytes } = await makeImage('a.webp', { width: 50, height: 50, format: 'webp' })
    const asset = await project.assets.importFile(path)
    const target = join(dir, 'exported.webp')
    await project.assets.exportOriginal(asset.id, target)
    expect(readFileSync(target).equals(bytes)).toBe(true)
  })
})
