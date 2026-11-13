/**
 * Writes a PDF or a numbered image sequence from displayed artwork.
 * Original asset files are read and never rewritten.
 */
import { randomUUID } from 'node:crypto'
import { stat, writeFile, rename, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { eq } from 'drizzle-orm'
import sharp from 'sharp'
import { spreadSides } from '@shared/collections'
import {
  planCollectionExport,
  type ExportFormat,
  type ExportSlot,
  type ExportSpread,
  type ExportWarning
} from '@shared/collectionExport'
import { assets } from '../db/schema'
import type { Project } from './project'

export async function writeCollectionExport(input: {
  project: Project
  collectionId: string
  destination: string
  format: ExportFormat
  spread: ExportSpread
  omitUnavailable: boolean
}): Promise<{ files: string[]; warnings: ExportWarning[] }> {
  const opened = input.project.collections.reader(input.collectionId)
  const plan = planCollectionExport(opened.pages, {
    format: input.format,
    spread: input.spread,
    omitUnavailable: input.omitUnavailable
  })
  const warnings = [...plan.warnings]
  if (plan.slots.length === 0) return { files: [], warnings }
  const pages = new Map(opened.pages.map((page) => [page.id, page]))
  const rendered: Buffer[] = []
  for (const slot of plan.slots) {
    const made = await renderSlot(input.project, opened, pages, slot)
    rendered.push(made.png)
    warnings.push(...made.warnings)
  }
  if (input.format === 'pdf') {
    await rm(input.destination, { force: true })
    await writeNew(input.destination, pdfOfImages(await Promise.all(rendered.map(rawRgb))))
    return { files: [input.destination], warnings }
  }
  await mkdir(input.destination, { recursive: true })
  const files: string[] = []
  for (const [index, slot] of plan.slots.entries()) {
    const target = join(input.destination, slot.fileName)
    await refuseExisting(target)
    const png = rendered[index]!
    const bytes =
      input.format === 'jpeg'
        ? await sharp(png).jpeg({ quality: 90 }).toBuffer()
        : input.format === 'webp'
          ? await sharp(png).webp().toBuffer()
          : png
    await writeNew(target, bytes)
    files.push(target)
  }
  const manifestPath = join(input.destination, 'sequence.json')
  await refuseExisting(manifestPath)
  await writeNew(
    manifestPath,
    Buffer.from(
      JSON.stringify({
        format: 'cw-collection-sequence',
        version: 1,
        slots: plan.slots,
        warnings
      })
    )
  )
  files.push(manifestPath)
  return { files, warnings }
}

async function renderSlot(
  project: Project,
  opened: ReturnType<Project['collections']['reader']>,
  pages: Map<string, ReturnType<Project['collections']['reader']>['pages'][number]>,
  slot: ExportSlot
): Promise<{ png: Buffer; warnings: ExportWarning[] }> {
  const warnings: ExportWarning[] = []
  const images: { id: string; png: Buffer }[] = []
  for (const pageId of slot.pageIds) {
    const page = pages.get(pageId)
    if (!page) continue
    const read = await readPageImage(project, page)
    images.push({ id: page.id, png: read.png })
    if (read.warning) warnings.push({ pageId, message: read.warning })
  }
  if (images.length < 2) return { png: images[0]?.png ?? (await placeholder()), warnings }
  const spread = {
    pageIds: images.map((image) => image.id),
    wide: false,
    locked: true
  }
  const sides = spreadSides(spread, opened.direction, opened.firstPageSide)
  const left = images.find((image) => image.id === sides.find((side) => side.side === 'left')?.id)
  const right = images.find((image) => image.id === sides.find((side) => side.side === 'right')?.id)
  return {
    png: await sideBySide(left?.png ?? (await placeholder()), right?.png ?? (await placeholder())),
    warnings
  }
}

async function readPageImage(
  project: Project,
  page: ReturnType<Project['collections']['reader']>['pages'][number]
): Promise<{ png: Buffer; warning: string | null }> {
  if (!page.sha256 || page.artwork !== 'ready') return { png: await placeholder(), warning: null }
  const file = project.db
    .select({ ext: assets.ext })
    .from(assets)
    .where(eq(assets.sha256, page.sha256))
    .get()
  if (!file) return { png: await placeholder(), warning: 'Displayed artwork is missing.' }
  const path = project.assets.originalPath(page.sha256, file.ext)
  try {
    const meta = await sharp(path).metadata()
    const crop = page.crop
    const fits =
      !!crop &&
      !!meta.width &&
      !!meta.height &&
      crop.x + crop.w <= meta.width &&
      crop.y + crop.h <= meta.height
    let image = sharp(path)
    if (fits && crop)
      image = image.extract({ left: crop.x, top: crop.y, width: crop.w, height: crop.h })
    return {
      png: await image.png().toBuffer(),
      warning:
        crop && !fits ? 'The crop does not fit this image, so the full image was used.' : null
    }
  } catch {
    return { png: await placeholder(), warning: 'Displayed artwork could not be read.' }
  }
}

function placeholder(): Promise<Buffer> {
  return sharp({
    create: { width: 400, height: 560, channels: 3, background: '#d9d9d9' }
  })
    .png()
    .toBuffer()
}

async function sideBySide(left: Buffer, right: Buffer): Promise<Buffer> {
  const leftMeta = await sharp(left).metadata()
  const rightMeta = await sharp(right).metadata()
  const leftWidth = leftMeta.width ?? 1
  const gutter = 16
  const width = leftWidth + gutter + (rightMeta.width ?? 1)
  const height = Math.max(leftMeta.height ?? 1, rightMeta.height ?? 1)
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .composite([
      { input: left, left: 0, top: 0 },
      { input: right, left: leftWidth + gutter, top: 0 }
    ])
    .png()
    .toBuffer()
}

async function rawRgb(png: Buffer): Promise<{ data: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(png)
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  return { data: deflateSync(data), width: info.width, height: info.height }
}

function pdfOfImages(images: { data: Buffer; width: number; height: number }[]): Buffer {
  const chunks: Buffer[] = []
  const offsets = [0]
  let size = 0
  const add = (value: string | Buffer) => {
    const buf = typeof value === 'string' ? Buffer.from(value, 'latin1') : value
    chunks.push(buf)
    size += buf.length
  }
  const object = () => offsets.push(size)
  add('%PDF-1.4\n%\xff\xff\xff\xff\n')
  object()
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const kids = images.map((_, index) => `${3 + index * 3} 0 R`).join(' ')
  object()
  add(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>\nendobj\n`)
  images.forEach((image, index) => {
    const pageObject = 3 + index * 3
    const contentObject = pageObject + 1
    const imageObject = pageObject + 2
    const pageW = Math.max(1, Math.round(((image.width * 72) / 144) * 100) / 100)
    const pageH = Math.max(1, Math.round(((image.height * 72) / 144) * 100) / 100)
    const content = Buffer.from(`q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q\n`, 'latin1')
    object()
    add(
      `${pageObject} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Contents ${contentObject} 0 R /Resources << /XObject << /Im0 ${imageObject} 0 R >> >> >>\nendobj\n`
    )
    object()
    add(`${contentObject} 0 obj\n<< /Length ${content.length} >>\nstream\n`)
    add(content)
    add('endstream\nendobj\n')
    object()
    add(
      `${imageObject} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${image.data.length} >>\nstream\n`
    )
    add(image.data)
    add('\nendstream\nendobj\n')
  })
  const xrefAt = size
  let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`
  }
  add(xref)
  add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)
  return Buffer.concat(chunks)
}

async function refuseExisting(path: string): Promise<void> {
  const found = await stat(path).catch(() => null)
  if (found) throw new Error(`${path} already exists.`)
}

async function writeNew(path: string, bytes: Buffer): Promise<void> {
  const staging = `${path}.${randomUUID()}.partial`
  try {
    await writeFile(staging, bytes)
    await rename(staging, path)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}
