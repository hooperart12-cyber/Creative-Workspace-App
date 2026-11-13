/**
 * Export planning for a page collection. This does not read or write files.
 * A wide page stays one image. Missing artwork is reported, not dropped, unless the
 * person explicitly chooses to omit it.
 */
import { layoutSpreads, type ArtworkState } from './collections'
import { parseDestination, type Destination } from './destinations'

export type ExportFormat = 'png' | 'jpeg' | 'webp' | 'pdf'
export type ExportSpread = 'page' | 'spread'

export interface ExportPageInput {
  id: string
  span: 1 | 2
  spreadId: string | null
  role: string | null
  number: number | null
  artwork: ArtworkState
}

export interface ExportSlot {
  fileName: string
  pageIds: string[]
  roles: (string | null)[]
  numbers: (number | null)[]
}

export interface ExportWarning {
  pageId: string
  message: string
}

const WARNING: Record<ArtworkState, string | null> = {
  ready: null,
  blank: 'This page is blank.',
  missing: 'Displayed artwork is missing.',
  unsupported: 'Displayed artwork is not a supported image.',
  damaged: 'Displayed artwork could not be read.',
  'changed-external': 'The linked file changed.',
  transient: 'Displayed artwork could not be loaded.'
}

export function planCollectionExport(
  pages: readonly ExportPageInput[],
  options: { format: ExportFormat; spread: ExportSpread; omitUnavailable: boolean }
): { slots: ExportSlot[]; warnings: ExportWarning[] } {
  const extension =
    options.format === 'jpeg' ? 'jpg' : options.format === 'pdf' ? 'png' : options.format
  const groups =
    options.spread === 'spread'
      ? layoutSpreads(
          pages.map((page) => ({ id: page.id, span: page.span, spreadId: page.spreadId }))
        ).map((spread) => spread.pageIds)
      : pages.map((page) => [page.id])
  const byId = new Map(pages.map((page) => [page.id, page]))
  const warnings: ExportWarning[] = []
  const chosen: string[][] = []
  for (const ids of groups) {
    const group = ids.flatMap((id) => {
      const page = byId.get(id)
      return page ? [page] : []
    })
    for (const page of group) {
      const message = WARNING[page.artwork]
      if (message) warnings.push({ pageId: page.id, message })
    }
    const kept = options.omitUnavailable ? group.filter((page) => page.artwork === 'ready') : group
    if (kept.length > 0) chosen.push(kept.map((page) => page.id))
  }
  const width = Math.max(3, String(chosen.length).length)
  return {
    slots: chosen.map((pageIds, index) => ({
      fileName: `${String(index + 1).padStart(width, '0')}.${extension}`,
      pageIds,
      roles: pageIds.map((id) => byId.get(id)?.role ?? null),
      numbers: pageIds.map((id) => byId.get(id)?.number ?? null)
    })),
    warnings
  }
}

export const COLLECTION_PACKAGE_FORMAT = 'cw-collection'
export const COLLECTION_PACKAGE_VERSION = 1

export interface PackageCrop {
  x: number
  y: number
  w: number
  h: number
}

export interface CollectionPackageVersion {
  id: string
  name: string
  assetSha: string
  crop: PackageCrop | null
}

export interface CollectionPackagePage {
  id: string
  title: string
  label: string
  role: string | null
  unnumbered: boolean | null
  notes: string
  overallStatus: string
  span: 1 | 2
  spreadId: string | null
  displayedVersionId: string | null
  versions: CollectionPackageVersion[]
  stages: { stageName: string; state: string; note: string }[]
  links: Destination[]
  comments: string[]
  tags: string[]
}

export interface CollectionPackageDocument {
  format: typeof COLLECTION_PACKAGE_FORMAT
  version: typeof COLLECTION_PACKAGE_VERSION
  collection: {
    sourceId: string
    title: string
    description: string
    direction: 'ltr' | 'rtl'
    firstPageSide: 'left' | 'right'
    numberStart: number
    nextCollectionId: string | null
    coverSha: string | null
  }
  stages: { name: string }[]
  pages: CollectionPackagePage[]
  nav: { pageId: string; kind: 'toc' | 'bookmark'; title: string }[]
  assets: { sha256: string; ext: string; originalName: string }[]
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA = /^[0-9a-f]{64}$/
const EXT = /^[a-z0-9]{1,8}$/

/** Reads a package manifest. Reader resume fields are ignored. */
export function validateCollectionPackage(
  value: unknown
): { document: CollectionPackageDocument } | { error: string } {
  if (!value || typeof value !== 'object') return { error: 'This is not a collection package.' }
  const raw = value as Record<string, unknown>
  if (raw.format !== COLLECTION_PACKAGE_FORMAT || raw.version !== COLLECTION_PACKAGE_VERSION) {
    return { error: 'This collection package version is not supported.' }
  }
  const collection = raw.collection
  if (!collection || typeof collection !== 'object') return { error: 'The collection is missing.' }
  const header = collection as Record<string, unknown>
  const sourceId = uuid(header.sourceId)
  if (!sourceId) return { error: 'The collection identity could not be read.' }
  if (!Array.isArray(raw.pages) || raw.pages.length > 5000) {
    return { error: 'The page list could not be read.' }
  }
  if (!Array.isArray(raw.assets) || raw.assets.length > 5000) {
    return { error: 'The artwork list could not be read.' }
  }
  const pages: CollectionPackagePage[] = []
  for (const item of raw.pages) {
    const page = pageOf(item)
    if (!page) return { error: 'A page in the package could not be read.' }
    pages.push(page)
  }
  const assets: CollectionPackageDocument['assets'] = []
  for (const item of raw.assets) {
    if (!item || typeof item !== 'object') return { error: 'An artwork file could not be read.' }
    const asset = item as Record<string, unknown>
    if (typeof asset.sha256 !== 'string' || !SHA.test(asset.sha256)) {
      return { error: 'An artwork file could not be read.' }
    }
    if (typeof asset.ext !== 'string' || !EXT.test(asset.ext)) {
      return { error: 'An artwork file could not be read.' }
    }
    assets.push({
      sha256: asset.sha256,
      ext: asset.ext,
      originalName: text(asset.originalName, 200) || 'Image'
    })
  }
  const stages = Array.isArray(raw.stages)
    ? raw.stages.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const name = text((item as Record<string, unknown>).name, 80)
        return name ? [{ name }] : []
      })
    : []
  const nav = Array.isArray(raw.nav)
    ? raw.nav.flatMap((item) => {
        if (!item || typeof item !== 'object') return []
        const row = item as Record<string, unknown>
        const pageId = uuid(row.pageId)
        const kind: 'toc' | 'bookmark' | null =
          row.kind === 'bookmark' ? 'bookmark' : row.kind === 'toc' ? 'toc' : null
        if (!pageId || !kind) return []
        return [{ pageId, kind, title: text(row.title, 200) }]
      })
    : []
  return {
    document: {
      format: COLLECTION_PACKAGE_FORMAT,
      version: COLLECTION_PACKAGE_VERSION,
      collection: {
        sourceId,
        title: text(header.title, 200) || 'Untitled collection',
        description: text(header.description, 4000),
        direction: header.direction === 'rtl' ? 'rtl' : 'ltr',
        firstPageSide: header.firstPageSide === 'left' ? 'left' : 'right',
        numberStart: whole(header.numberStart, 1, 9999, 1),
        nextCollectionId: uuid(header.nextCollectionId),
        coverSha:
          typeof header.coverSha === 'string' && SHA.test(header.coverSha) ? header.coverSha : null
      },
      stages,
      pages,
      nav,
      assets
    }
  }
}

/** A link that points at a page in this package follows the new page. Anything else stays unresolved. */
export function remapPackageDestination(
  destination: Destination,
  sourceCollectionId: string,
  collectionId: string,
  pageIds: ReadonlyMap<string, string>
): { destination: Destination; unresolved: boolean } {
  if (destination.kind === 'page') {
    const pageId = pageIds.get(destination.pageId)
    if (pageId && destination.collectionId === sourceCollectionId) {
      return {
        destination: { ...destination, collectionId, pageId },
        unresolved: false
      }
    }
    return { destination, unresolved: true }
  }
  if (destination.kind === 'collection') {
    if (destination.collectionId === sourceCollectionId) {
      return { destination: { ...destination, collectionId }, unresolved: false }
    }
    return { destination, unresolved: true }
  }
  return { destination, unresolved: true }
}

/** The next collection is kept only when that collection is already in this project. */
export function nextForPackage(
  nextCollectionId: string | null,
  liveCollectionIds: ReadonlySet<string>
): { id: string | null; unresolved: boolean } {
  if (!nextCollectionId) return { id: null, unresolved: false }
  if (liveCollectionIds.has(nextCollectionId)) return { id: nextCollectionId, unresolved: false }
  return { id: null, unresolved: true }
}

function pageOf(value: unknown): CollectionPackagePage | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = uuid(raw.id)
  if (!id) return null
  if (!Array.isArray(raw.versions) || raw.versions.length > 50) return null
  const versions: CollectionPackageVersion[] = []
  for (const item of raw.versions) {
    if (!item || typeof item !== 'object') return null
    const version = item as Record<string, unknown>
    const versionId = uuid(version.id)
    if (!versionId || typeof version.assetSha !== 'string' || !SHA.test(version.assetSha))
      return null
    versions.push({
      id: versionId,
      name: text(version.name, 200),
      assetSha: version.assetSha,
      crop: cropOf(version.crop)
    })
  }
  const links = Array.isArray(raw.links)
    ? raw.links.flatMap((item) => {
        const destination = parseDestination(item)
        return destination ? [destination] : []
      })
    : []
  return {
    id,
    title: text(raw.title, 200),
    label: text(raw.label, 80),
    role: roleOf(raw.role),
    unnumbered: raw.unnumbered === true ? true : raw.unnumbered === false ? false : null,
    notes: text(raw.notes, 100_000),
    overallStatus: statusOf(raw.overallStatus),
    span: raw.span === 2 ? 2 : 1,
    spreadId: uuid(raw.spreadId),
    displayedVersionId: uuid(raw.displayedVersionId),
    versions,
    stages: Array.isArray(raw.stages)
      ? raw.stages.flatMap((item) => {
          if (!item || typeof item !== 'object') return []
          const stage = item as Record<string, unknown>
          const stageName = text(stage.stageName, 80)
          if (!stageName) return []
          return [{ stageName, state: statusOf(stage.state), note: text(stage.note, 100_000) }]
        })
      : [],
    links,
    comments: Array.isArray(raw.comments)
      ? raw.comments.flatMap((item) =>
          typeof item === 'string' && item.trim() ? [item.trim().slice(0, 20_000)] : []
        )
      : [],
    tags: Array.isArray(raw.tags)
      ? raw.tags.flatMap((item) => {
          const name = text(item, 80)
          return name ? [name] : []
        })
      : []
  }
}

function cropOf(value: unknown): PackageCrop | null {
  if (!value || typeof value !== 'object') return null
  const crop = value as Record<string, unknown>
  const numbers = [crop.x, crop.y, crop.w, crop.h]
  if (!numbers.every((item) => typeof item === 'number' && Number.isInteger(item) && item >= 0))
    return null
  if ((crop.w as number) < 1 || (crop.h as number) < 1) return null
  return { x: crop.x as number, y: crop.y as number, w: crop.w as number, h: crop.h as number }
}

function roleOf(value: unknown): string | null {
  return value === 'cover' ||
    value === 'title' ||
    value === 'story' ||
    value === 'bonus' ||
    value === 'end' ||
    value === 'blank'
    ? value
    : null
}

function statusOf(value: unknown): string {
  return value === 'in_progress' || value === 'done' || value === 'skipped' ? value : 'not_started'
}

function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null
}

function text(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function whole(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
