/**
 * A portable collection package. Import always creates a new collection.
 * Reader resume is not written. Comments are included only when asked.
 */
import { randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { and, eq, isNull } from 'drizzle-orm'
import { ZipFile } from 'yazl'
import {
  nextForPackage,
  remapPackageDestination,
  validateCollectionPackage,
  type CollectionPackageDocument,
  type CollectionPackagePage
} from '@shared/collectionExport'
import type { PageRole, PageStatus } from '@shared/collections'
import { assets, collectionStages, collections } from '../db/schema'
import { extractComicEntries, listComicArchive } from './comicArchive'
import type { Project } from './project'
import { tagNameParts } from './tagNames'

export async function exportCollectionPackage(input: {
  project: Project
  collectionId: string
  destination: string
  includeComments: boolean
}): Promise<void> {
  const document = buildPackage(input.project, input.collectionId, input.includeComments)
  const staging = `${input.destination}.${randomUUID()}.partial`
  const zip = new ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify(document)), 'manifest.json')
  for (const asset of document.assets) {
    const row = input.project.db
      .select({ ext: assets.ext })
      .from(assets)
      .where(eq(assets.sha256, asset.sha256))
      .get()
    if (!row) continue
    const path = input.project.assets.originalPath(asset.sha256, row.ext)
    if (!(await stat(path).catch(() => null))) continue
    zip.addFile(path, `assets/${asset.sha256}.${asset.ext}`)
  }
  try {
    const done = pipeline(zip.outputStream, createWriteStream(staging))
    zip.end()
    await done
    await rm(input.destination, { force: true })
    await rename(staging, input.destination)
  } catch (error) {
    await rm(staging, { force: true })
    throw error
  }
}

export async function importCollectionPackage(
  project: Project,
  zipPath: string
): Promise<{ collectionId: string; unresolved: string[] }> {
  const names = await listComicArchive(zipPath)
  if (!names.includes('manifest.json')) throw new Error('This is not a collection package.')
  const temp = await mkdtemp(join(tmpdir(), 'cw-collection-package-'))
  try {
    const extracted = await extractComicEntries(zipPath, names, temp)
    const manifestPath = extracted.get('manifest.json')
    if (!manifestPath) throw new Error('This is not a collection package.')
    const parsed = validateCollectionPackage(JSON.parse(await readFile(manifestPath, 'utf8')))
    if ('error' in parsed) throw new Error(parsed.error)
    const bySha = new Map<string, string>()
    const unresolved: string[] = []
    for (const asset of parsed.document.assets) {
      const path = extracted.get(`assets/${asset.sha256}.${asset.ext}`)
      if (!path) {
        unresolved.push(`Artwork ${asset.originalName} was not in the package.`)
        continue
      }
      const imported = await project.assets.importFile(path)
      bySha.set(asset.sha256, imported.id)
    }
    return importDocument(project, parsed.document, bySha, unresolved)
  } finally {
    await rm(temp, { recursive: true, force: true })
  }
}

function buildPackage(
  project: Project,
  collectionId: string,
  includeComments: boolean
): CollectionPackageDocument {
  const row = project.db.select().from(collections).where(eq(collections.id, collectionId)).get()
  if (!row || row.deletedAt) throw new Error('That collection is not in this project.')
  const detail = project.collections.detail(collectionId)
  const stageName = new Map(detail.stages.map((stage) => [stage.id, stage.name]))
  const cover = row.coverAssetId
    ? project.db.select().from(assets).where(eq(assets.id, row.coverAssetId)).get()
    : undefined
  const packed = new Map<string, CollectionPackageDocument['assets'][number]>()
  const pages: CollectionPackagePage[] = detail.pages.map((page) => {
    const versions = project.collections.versions(page.id).flatMap((version) => {
      if (!version.sha256) return []
      const file = project.db.select().from(assets).where(eq(assets.sha256, version.sha256)).get()
      if (!file || file.deletedAt) return []
      packed.set(file.sha256, {
        sha256: file.sha256,
        ext: file.ext,
        originalName: file.originalName
      })
      return [
        {
          id: version.id,
          name: version.name,
          assetSha: version.sha256,
          crop: version.crop
        }
      ]
    })
    return {
      id: page.id,
      title: page.title,
      label: page.label,
      role: page.role,
      unnumbered: page.unnumbered,
      notes: page.notes,
      overallStatus: page.overallStatus,
      span: page.span,
      spreadId: page.spreadId,
      displayedVersionId: page.displayedVersionId,
      versions,
      stages: detail.stageStates
        .filter((state) => state.pageId === page.id)
        .flatMap((state) => {
          const name = stageName.get(state.stageId)
          return name ? [{ stageName: name, state: state.state, note: state.note }] : []
        }),
      links: project.collections
        .links(page.id)
        .flatMap((link) => (link.destination ? [link.destination] : [])),
      comments: includeComments
        ? project.collections.comments(page.id).map((comment) => comment.body)
        : [],
      tags: project.tags.pillsFor('page', page.id, null, false).map((tag) => tag.name)
    }
  })
  if (cover && !cover.deletedAt) {
    packed.set(cover.sha256, {
      sha256: cover.sha256,
      ext: cover.ext,
      originalName: cover.originalName
    })
  }
  return {
    format: 'cw-collection',
    version: 1,
    collection: {
      sourceId: row.id,
      title: row.title,
      description: row.description,
      direction: row.direction === 'rtl' ? 'rtl' : 'ltr',
      firstPageSide: row.firstPageSide === 'left' ? 'left' : 'right',
      numberStart: row.numberStart,
      nextCollectionId: row.nextCollectionId,
      coverSha: cover && !cover.deletedAt ? cover.sha256 : null
    },
    stages: detail.stages.map((stage) => ({ name: stage.name })),
    pages,
    nav: project.collections
      .nav(collectionId)
      .flatMap((item) =>
        item.kind === 'toc' || item.kind === 'bookmark'
          ? [{ pageId: item.pageId, kind: item.kind, title: item.title }]
          : []
      ),
    assets: [...packed.values()]
  }
}

function importDocument(
  project: Project,
  document: CollectionPackageDocument,
  assetsBySha: Map<string, string>,
  unresolved: string[]
): { collectionId: string; unresolved: string[] } {
  const live = new Set(
    project.db
      .select({ id: collections.id })
      .from(collections)
      .where(isNull(collections.deletedAt))
      .all()
      .map((row) => row.id)
  )
  const next = nextForPackage(document.collection.nextCollectionId, live)
  if (next.unresolved) unresolved.push('The next chapter is not in this project.')
  const created = project.collections.create({
    title: document.collection.title,
    direction: document.collection.direction,
    firstPageSide: document.collection.firstPageSide,
    placeholderCount: 0
  })
  try {
    project.collections.updateSettings(created.id, {
      description: document.collection.description,
      numberStart: document.collection.numberStart,
      nextCollectionId: next.id
    })
    if (document.stages.length > 0)
      replaceStages(
        project,
        created.id,
        document.stages.map((stage) => stage.name)
      )
    const stageIds = new Map(
      project.collections.stages(created.id).map((stage) => [stage.name, stage.id])
    )
    const pageIds = new Map<string, string>()
    const versionIds = new Map<string, string>()
    for (const page of document.pages) {
      const inserted = project.collections.insertPages({
        collectionId: created.id,
        count: 1,
        title: page.title,
        notes: page.notes,
        role: (page.role as PageRole | null) ?? 'story',
        status: page.overallStatus as PageStatus
      })
      const pageId = inserted.pageIds[0]!
      pageIds.set(page.id, pageId)
      let revision = 0
      if (page.label || page.unnumbered !== null) {
        revision = project.collections.updatePage(pageId, revision, {
          label: page.label,
          unnumbered: page.unnumbered
        }).revision
      }
      if (page.span === 2) project.collections.setSpan(pageId, 2)
      for (const version of page.versions) {
        const assetId = assetsBySha.get(version.assetSha)
        if (!assetId) {
          unresolved.push(`Artwork for “${page.title || 'a page'}” was not available.`)
          continue
        }
        const added = project.collections.addVersion(pageId, { assetId, name: version.name })
        versionIds.set(version.id, added.id)
        if (version.crop) project.collections.setCrop(added.id, version.crop)
      }
      const displayed = page.displayedVersionId ? versionIds.get(page.displayedVersionId) : null
      if (displayed)
        revision = project.collections.setDisplayed(pageId, displayed, revision).revision
      for (const stage of page.stages) {
        const stageId = stageIds.get(stage.stageName)
        if (!stageId) continue
        project.collections.setStage(pageId, stageId, stage.state as PageStatus, stage.note)
      }
      for (const name of page.tags) assignTag(project, pageId, name, unresolved)
      for (const body of page.comments) project.collections.addComment(pageId, body)
    }
    const spreads = new Map<string, string[]>()
    for (const page of document.pages) {
      const pageId = pageIds.get(page.id)
      if (!page.spreadId || !pageId) continue
      const group = spreads.get(page.spreadId) ?? []
      group.push(pageId)
      spreads.set(page.spreadId, group)
    }
    for (const group of spreads.values()) {
      if (group.length === 2) project.collections.lockSpread(group[0]!, group[1]!)
    }
    for (const page of document.pages) {
      const pageId = pageIds.get(page.id)
      if (!pageId) continue
      for (const destination of page.links) {
        const mapped = remapPackageDestination(
          destination,
          document.collection.sourceId,
          created.id,
          pageIds
        )
        if (mapped.unresolved) unresolved.push('A link points outside this package.')
        project.collections.addLink(pageId, mapped.destination)
      }
    }
    for (const item of document.nav) {
      const pageId = pageIds.get(item.pageId)
      if (!pageId) {
        unresolved.push(`Contents entry “${item.title || 'Untitled'}” has no page.`)
        continue
      }
      project.collections.addNav(created.id, pageId, item.kind, item.title)
    }
    const coverId = document.collection.coverSha
      ? assetsBySha.get(document.collection.coverSha)
      : null
    if (coverId) {
      project.db
        .update(collections)
        .set({ coverAssetId: coverId, updatedAt: new Date() })
        .where(eq(collections.id, created.id))
        .run()
    }
    return { collectionId: created.id, unresolved }
  } catch (error) {
    project.collections.trash(created.id)
    throw error
  }
}

function replaceStages(project: Project, collectionId: string, names: string[]): void {
  const now = new Date()
  project.db
    .update(collectionStages)
    .set({ removedAt: now, updatedAt: now })
    .where(and(eq(collectionStages.collectionId, collectionId), isNull(collectionStages.removedAt)))
    .run()
  names.forEach((name, index) => {
    project.db
      .insert(collectionStages)
      .values({
        id: randomUUID(),
        collectionId,
        name,
        position: index,
        createdAt: now,
        updatedAt: now
      })
      .run()
  })
}

function assignTag(project: Project, pageId: string, name: string, unresolved: string[]): void {
  const parts = tagNameParts(name)
  const found = project.tags
    .list()
    .find((item) => tagNameParts(item.name).normalized === parts.normalized)
  try {
    const id = found?.id ?? project.tags.createReusable(parts.name).id
    project.tags.assign(id, { type: 'page', id: pageId })
  } catch (error) {
    unresolved.push(error instanceof Error ? error.message : String(error))
  }
}
