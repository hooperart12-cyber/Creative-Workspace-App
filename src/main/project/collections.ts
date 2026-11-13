/**
 * Page collections (M9). A collection is not a canvas card, and a page id is not a page number.
 * This module does not import Electron, so the tests can open a project directly.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'
import { classifyArtwork, planFolderMatch } from '@shared/artwork'
import { bulkDecision, type BulkOperation, type BulkUndoEntry } from '@shared/collectionBulk'
import { stageKnownAssets, type CommittedAction } from '@shared/collectionImport'
import { placeBefore } from '@shared/collectionOrder'
import {
  BLANK_TEMPLATE,
  BUILTIN_TEMPLATES,
  COMIC_TEMPLATE,
  derivedNumbers,
  MANGA_TEMPLATE,
  type ArtworkState,
  type CollectionDetail,
  type CollectionOutline,
  type CollectionPageView,
  type PagePatch,
  type PageRole,
  type PageStatus,
  type ReadingDirection,
  type PageSide,
  type TemplateData
} from '@shared/collections'
import {
  collectionQueryActive,
  filterCollectionPages,
  type CollectionSearchPage
} from '@shared/collectionSearch'
import type { ReaderDocument, ReaderLayout } from '@shared/reader'
import { parseDestination, remapDestination, type Destination } from '@shared/destinations'
import type { ProjectDb } from '../db/client'
import {
  assets,
  boardObjects,
  collectionFolders,
  collectionNav,
  collectionPages,
  collectionStages,
  collectionTemplates,
  collections,
  pageCommentMessages,
  pageComments,
  pageLinks,
  pageStageStates,
  pageVersions,
  stackSlides,
  taggings,
  tags
} from '../db/schema'
import { deletionTime } from './boards'
import { TagRepository } from './tags'

export const COLLECTION_CONFLICT = 'Another window changed this page. The change was not saved.'

const BUILTINS: { id: string; name: string; data: TemplateData }[] = [
  { id: BUILTIN_TEMPLATES.blank, name: 'Blank', data: BLANK_TEMPLATE },
  { id: BUILTIN_TEMPLATES.manga, name: 'Manga', data: MANGA_TEMPLATE },
  { id: BUILTIN_TEMPLATES.comic, name: 'Comic', data: COMIC_TEMPLATE }
]

export interface UnmappedStage {
  pageId: string
  stageId: string
  stageName: string
  state: string
  note: string
}

const normalize = (name: string): string => name.trim().toLowerCase()

export class CollectionRepository {
  constructor(private readonly db: ProjectDb) {}

  /** Inserts the built-in templates once. Existing collections are not rewritten. */
  ensureTemplates(): void {
    const now = new Date()
    for (const template of BUILTINS) {
      const existing = this.db
        .select({ id: collectionTemplates.id })
        .from(collectionTemplates)
        .where(eq(collectionTemplates.id, template.id))
        .get()
      if (existing) continue
      this.db
        .insert(collectionTemplates)
        .values({
          id: template.id,
          name: template.name,
          builtin: true,
          data: template.data as unknown as Record<string, unknown>,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
  }

  templates(): { id: string; name: string; builtin: boolean; data: TemplateData }[] {
    this.ensureTemplates()
    return this.db
      .select()
      .from(collectionTemplates)
      .where(isNull(collectionTemplates.deletedAt))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        builtin: row.builtin,
        data: row.data as unknown as TemplateData
      }))
  }

  /** Changes a template. Collections already created from it keep the copy they were given. */
  updateTemplate(id: string, data: TemplateData): void {
    this.ensureTemplates()
    const now = new Date()
    const result = this.db
      .update(collectionTemplates)
      .set({ data: data as unknown as Record<string, unknown>, updatedAt: now })
      .where(and(eq(collectionTemplates.id, id), isNull(collectionTemplates.deletedAt)))
      .run()
    if (result.changes !== 1) throw new Error('That template is not in this project.')
  }

  createFolder(parentId: string | null, name: string): { id: string } {
    if (parentId) this.requireFolder(parentId)
    const id = randomUUID()
    const now = new Date()
    const sortOrder = this.nextFolderOrder(parentId)
    this.db
      .insert(collectionFolders)
      .values({
        id,
        parentId,
        name: name.trim() || 'Untitled folder',
        sortOrder,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id }
  }

  renameFolder(id: string, name: string): void {
    this.requireFolder(id)
    this.db
      .update(collectionFolders)
      .set({ name: name.trim() || 'Untitled folder', updatedAt: new Date() })
      .where(eq(collectionFolders.id, id))
      .run()
  }

  /** Hides the folder. Collections inside it stay, with the same folder id. */
  trashFolder(id: string): void {
    this.requireFolder(id)
    const child = this.db
      .select()
      .from(collectionFolders)
      .where(and(eq(collectionFolders.parentId, id), isNull(collectionFolders.deletedAt)))
      .get()
    if (child) throw new Error('Move the folders inside it first.')
    const now = deletionTime()
    this.db
      .update(collectionFolders)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(collectionFolders.id, id))
      .run()
  }

  trashedFolders(): { id: string; name: string }[] {
    return this.db
      .select()
      .from(collectionFolders)
      .where(isNotNull(collectionFolders.deletedAt))
      .all()
      .map((folder) => ({ id: folder.id, name: folder.name }))
  }

  trashedCollections(): { id: string; title: string }[] {
    return this.db
      .select()
      .from(collections)
      .where(isNotNull(collections.deletedAt))
      .all()
      .map((row) => ({ id: row.id, title: row.title }))
  }

  restoreFolder(id: string): void {
    const row = this.db.select().from(collectionFolders).where(eq(collectionFolders.id, id)).get()
    if (!row?.deletedAt) return
    this.db
      .update(collectionFolders)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(collectionFolders.id, id))
      .run()
  }

  moveFolder(id: string, parentId: string | null): void {
    this.requireFolder(id)
    if (parentId) {
      this.requireFolder(parentId)
      if (parentId === id || this.folderAncestors(parentId).includes(id)) {
        throw new Error('A folder cannot be moved into itself.')
      }
    }
    this.db
      .update(collectionFolders)
      .set({ parentId, sortOrder: this.nextFolderOrder(parentId), updatedAt: new Date() })
      .where(eq(collectionFolders.id, id))
      .run()
  }

  create(input: {
    title: string
    folderId?: string | null
    templateId?: string | null
    direction?: ReadingDirection
    firstPageSide?: PageSide
    placeholderCount?: number
  }): { id: string; pageIds: string[] } {
    this.ensureTemplates()
    if (input.folderId) this.requireFolder(input.folderId)
    const template = input.templateId
      ? this.templates().find((item) => item.id === input.templateId)
      : this.templates().find((item) => item.id === BUILTIN_TEMPLATES.blank)
    if (input.templateId && !template) throw new Error('That template is not in this project.')
    const data = template?.data ?? BLANK_TEMPLATE
    const id = randomUUID()
    const now = new Date()
    const direction = input.direction ?? data.direction
    const firstPageSide = input.firstPageSide ?? data.firstPageSide
    this.db.transaction((tx) => {
      tx.insert(collections)
        .values({
          id,
          folderId: input.folderId ?? null,
          templateId: template?.id ?? null,
          title: input.title.trim() || 'Untitled collection',
          direction,
          firstPageSide,
          sortOrder: this.nextCollectionOrder(input.folderId ?? null),
          createdAt: now,
          updatedAt: now
        })
        .run()
      data.stages.forEach((stage, index) => {
        tx.insert(collectionStages)
          .values({
            id: randomUUID(),
            collectionId: id,
            name: stage.name,
            position: index,
            createdAt: now,
            updatedAt: now
          })
          .run()
      })
    })
    const count = input.placeholderCount ?? 0
    const pageIds =
      count > 0 ? this.insertPages({ collectionId: id, count, role: 'story' }).pageIds : []
    return { id, pageIds }
  }

  /** Blank pages. One undo trashes every id this call created. Assigning nothing completes no stage. */
  insertPages(input: {
    collectionId: string
    count: number
    beforeId?: string | null
    title?: string
    notes?: string
    role?: PageRole | null
    status?: PageStatus
    tagIds?: string[]
  }): { pageIds: string[] } {
    this.requireCollection(input.collectionId)
    const count = Math.floor(input.count)
    if (count < 1 || count > 5000) throw new Error('Choose between 1 and 5000 pages.')
    const pageIds = Array.from({ length: count }, () => randomUUID())
    const now = new Date()
    this.db.transaction((tx) => {
      const ordered = this.livePages(input.collectionId, tx)
      const at = this.insertIndex(ordered, input.beforeId)
      const created = pageIds.map((id, index) => ({
        id,
        collectionId: input.collectionId,
        position: at + index,
        title: input.title ?? '',
        notes: input.notes ?? '',
        role: input.role ?? 'story',
        overallStatus: input.status ?? 'not_started',
        createdAt: now,
        updatedAt: now
      }))
      const next = [
        ...ordered.slice(0, at).map((page) => page.id),
        ...pageIds,
        ...ordered.slice(at).map((page) => page.id)
      ]
      for (const page of created) tx.insert(collectionPages).values(page).run()
      this.rewritePositions(tx, next)
    })
    const tagIds = [...new Set(input.tagIds ?? [])]
    if (tagIds.length > 0) {
      const tags = new TagRepository(this.db)
      for (const pageId of pageIds) {
        for (const tagId of tagIds) tags.assign(tagId, { type: 'page', id: pageId })
      }
    }
    return { pageIds }
  }

  /** Soft-deletes pages created together, in one step. */
  undoPages(pageIds: string[]): void {
    if (pageIds.length === 0) return
    const now = deletionTime()
    this.db
      .update(collectionPages)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(collectionPages.id, pageIds))
      .run()
  }

  pages(collectionId: string): CollectionPageView[] {
    const collection = this.requireCollection(collectionId)
    const rows = this.livePages(collectionId)
    const numbers = derivedNumbers(
      rows.map((row) => ({
        id: row.id,
        role: (row.role as PageRole | null) ?? null,
        unnumbered: row.unnumbered
      })),
      collection.numberStart
    )
    const artwork = this.displayedArtwork(rows)
    return rows.map((row) => ({
      id: row.id,
      collectionId: row.collectionId,
      position: row.position,
      title: row.title,
      label: row.label,
      role: (row.role as PageRole | null) ?? null,
      unnumbered: row.unnumbered,
      notes: row.notes,
      overallStatus: row.overallStatus,
      number: numbers.get(row.id) ?? null,
      span: row.span === 2 ? 2 : 1,
      spreadId: row.spreadId,
      displayedVersionId: row.displayedVersionId,
      revision: row.revision,
      artwork: artwork.get(row.id)?.state ?? 'blank',
      displayedName: artwork.get(row.id)?.name ?? '',
      sha256: artwork.get(row.id)?.sha256 ?? null,
      updatedAt: row.updatedAt.getTime()
    }))
  }

  stages(collectionId: string): { id: string; name: string; position: number }[] {
    this.requireCollection(collectionId)
    return this.db
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.collectionId, collectionId))
      .orderBy(asc(collectionStages.position))
      .all()
      .filter((stage) => !stage.removedAt)
      .map((stage) => ({ id: stage.id, name: stage.name, position: stage.position }))
  }

  updatePage(
    id: string,
    revision: number,
    patch: PagePatch,
    base?: PagePatch
  ): { revision: number } {
    const page = this.requirePage(id)
    if (page.revision !== revision && !sameFields(page, patch, base)) {
      throw new Error(COLLECTION_CONFLICT)
    }
    const next = page.revision + 1
    const result = this.db
      .update(collectionPages)
      .set({ ...patch, revision: next, updatedAt: new Date() })
      .where(and(eq(collectionPages.id, id), eq(collectionPages.revision, page.revision)))
      .run()
    if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
    return { revision: next }
  }

  addVersion(
    pageId: string,
    input: { assetId: string; name?: string; sourceSlideId?: string | null }
  ): { id: string } {
    this.requirePage(pageId)
    const id = randomUUID()
    const now = new Date()
    const position =
      this.db
        .select({ position: max(pageVersions.position) })
        .from(pageVersions)
        .where(eq(pageVersions.pageId, pageId))
        .get()?.position ?? -1
    this.db
      .insert(pageVersions)
      .values({
        id,
        pageId,
        assetId: input.assetId,
        name: input.name ?? '',
        sourceSlideId: input.sourceSlideId ?? null,
        position: position + 1,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id }
  }

  /** Shows a version. Does not mark any production stage done. */
  setDisplayed(pageId: string, versionId: string | null, revision: number): { revision: number } {
    const page = this.requirePage(pageId)
    if (page.revision !== revision) throw new Error(COLLECTION_CONFLICT)
    if (versionId) {
      const version = this.db
        .select({ id: pageVersions.id })
        .from(pageVersions)
        .where(and(eq(pageVersions.id, versionId), eq(pageVersions.pageId, pageId)))
        .get()
      if (!version) throw new Error('That version is not on this page.')
    }
    const next = revision + 1
    const status = page.overallStatus
    const result = this.db
      .update(collectionPages)
      .set({ displayedVersionId: versionId, revision: next, updatedAt: new Date() })
      .where(and(eq(collectionPages.id, pageId), eq(collectionPages.revision, revision)))
      .run()
    if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
    const saved = this.requirePage(pageId)
    if (saved.overallStatus !== status)
      throw new Error('Showing artwork must not complete the page.')
    return { revision: next }
  }

  lockSpread(pageId: string, partnerId: string): { spreadId: string } {
    const pages = [this.requirePage(pageId), this.requirePage(partnerId)]
    if (pages[0].collectionId !== pages[1].collectionId) {
      throw new Error('A spread stays inside one collection.')
    }
    if (pages.some((page) => page.span === 2)) {
      throw new Error('A wide page already fills the spread.')
    }
    const ordered = this.livePages(pages[0].collectionId)
    const indexA = ordered.findIndex((page) => page.id === pageId)
    const indexB = ordered.findIndex((page) => page.id === partnerId)
    if (Math.abs(indexA - indexB) !== 1)
      throw new Error('Lock two pages that are already next to each other.')
    const spreadId = randomUUID()
    const now = new Date()
    this.db
      .update(collectionPages)
      .set({ spreadId, updatedAt: now })
      .where(inArray(collectionPages.id, [pageId, partnerId]))
      .run()
    return { spreadId }
  }

  /** Restores a previous sequence. The ids must be the live pages, in the restored order. */
  orderPages(collectionId: string, pageIds: string[]): void {
    this.requireCollection(collectionId)
    this.db.transaction((tx) => {
      const live = this.livePages(collectionId, tx).map((page) => page.id)
      if (live.length !== pageIds.length || live.some((id) => !pageIds.includes(id))) {
        throw new Error('That sequence is out of date.')
      }
      this.rewritePositions(tx, pageIds)
      this.assertPartnersAdjacent(tx, collectionId)
    })
  }

  reorder(collectionId: string, pageIds: string[], beforeId: string | null): void {
    this.requireCollection(collectionId)
    this.db.transaction((tx) => {
      const ordered = this.livePages(collectionId, tx)
      const moving = this.withPartners(ordered, pageIds)
      if (beforeId && moving.includes(beforeId))
        throw new Error('Drop the pages beside themselves, not onto themselves.')
      const rest = ordered.map((page) => page.id).filter((id) => !moving.includes(id))
      const at = beforeId ? rest.indexOf(beforeId) : rest.length
      if (beforeId && at < 0) throw new Error('That page is not in this collection.')
      const next = [...rest.slice(0, at), ...moving, ...rest.slice(at)]
      this.rewritePositions(tx, next)
      this.assertPartnersAdjacent(tx, collectionId)
    })
  }

  movePages(
    pageIds: string[],
    toCollectionId: string,
    beforeId: string | null
  ): { unmapped: UnmappedStage[] } {
    if (pageIds.length === 0) return { unmapped: [] }
    const first = this.requirePage(pageIds[0]!)
    this.requireCollection(toCollectionId)
    const unmapped: UnmappedStage[] = []
    this.db.transaction((tx) => {
      const source = this.livePages(first.collectionId, tx)
      const moving = this.withPartners(source, pageIds)
      const dest = this.livePages(toCollectionId, tx).map((page) => page.id)
      const at = beforeId ? dest.indexOf(beforeId) : dest.length
      if (beforeId && at < 0) throw new Error('That page is not in this collection.')
      const now = new Date()
      for (const id of moving) {
        tx.update(collectionPages)
          .set({ collectionId: toCollectionId, updatedAt: now })
          .where(eq(collectionPages.id, id))
          .run()
        unmapped.push(...this.remapStages(tx, id, first.collectionId, toCollectionId))
      }
      this.rewritePositions(
        tx,
        source.map((page) => page.id).filter((id) => !moving.includes(id))
      )
      this.rewritePositions(tx, [...dest.slice(0, at), ...moving, ...dest.slice(at)])
      this.assertPartnersAdjacent(tx, toCollectionId)
    })
    return { unmapped }
  }

  copyPages(
    pageIds: string[],
    toCollectionId: string,
    beforeId: string | null,
    options?: { includeComments?: boolean; includeNotes?: boolean; includeLinks?: boolean }
  ): { pageIds: string[]; idMap: Map<string, string> } {
    const includeNotes = options?.includeNotes !== false
    const includeLinks = options?.includeLinks !== false
    const includeComments = options?.includeComments === true
    const first = this.requirePage(pageIds[0]!)
    this.requireCollection(toCollectionId)
    const source = this.livePages(first.collectionId)
    const moving = this.withPartners(source, pageIds)
    const idMap = new Map(moving.map((id) => [id, randomUUID()]))
    const spreadMap = new Map<string, string>()
    const now = new Date()
    this.db.transaction((tx) => {
      for (const id of moving) {
        const page = source.find((item) => item.id === id)!
        const partnerAlsoCopied =
          !!page.spreadId &&
          source
            .filter((item) => item.spreadId === page.spreadId)
            .every((item) => idMap.has(item.id))
        const spreadId = partnerAlsoCopied
          ? (spreadMap.get(page.spreadId!) ??
              spreadMap.set(page.spreadId!, randomUUID()).get(page.spreadId!))!
          : null
        tx.insert(collectionPages)
          .values({
            id: idMap.get(id)!,
            collectionId: toCollectionId,
            position: 0,
            title: page.title,
            label: page.label,
            unnumbered: page.unnumbered,
            role: page.role,
            notes: includeNotes ? page.notes : '',
            overallStatus: page.overallStatus,
            span: page.span,
            spreadId,
            createdAt: now,
            updatedAt: now
          })
          .run()
        this.copyVersions(tx, id, idMap.get(id)!, now)
        this.copyStageStates(tx, id, idMap.get(id)!, first.collectionId, toCollectionId)
        if (includeLinks) this.copyLinks(tx, id, idMap.get(id)!, idMap, toCollectionId, now)
        if (includeComments) this.copyComments(tx, id, idMap.get(id)!, now)
      }
      const copied = new Set<string>(idMap.values())
      const dest = this.livePages(toCollectionId, tx)
        .map((page) => page.id)
        .filter((id) => !copied.has(id))
      const at = beforeId ? dest.indexOf(beforeId) : dest.length
      const created = moving.map((id) => idMap.get(id)!)
      this.rewritePositions(tx, [
        ...dest.slice(0, Math.max(0, at)),
        ...created,
        ...dest.slice(Math.max(0, at))
      ])
    })
    return { pageIds: moving.map((id) => idMap.get(id)!), idMap }
  }

  addLink(pageId: string, destination: Destination): { id: string } {
    this.requirePage(pageId)
    const id = randomUUID()
    const now = new Date()
    this.db
      .insert(pageLinks)
      .values({
        id,
        pageId,
        destination: destination as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id }
  }

  links(pageId: string): { id: string; destination: Destination | null }[] {
    return this.db
      .select()
      .from(pageLinks)
      .where(and(eq(pageLinks.pageId, pageId), isNull(pageLinks.deletedAt)))
      .all()
      .map((row) => ({ id: row.id, destination: parseDestination(row.destination) }))
  }

  addComment(pageId: string, body: string): { id: string } {
    this.requirePage(pageId)
    const id = randomUUID()
    const messageId = randomUUID()
    const now = new Date()
    this.db.transaction((tx) => {
      tx.insert(pageComments).values({ id, pageId, createdAt: now, updatedAt: now }).run()
      tx.insert(pageCommentMessages)
        .values({ id: messageId, commentId: id, body, createdAt: now, updatedAt: now })
        .run()
    })
    return { id }
  }

  comments(pageId: string): { id: string; body: string }[] {
    const threads = this.db
      .select()
      .from(pageComments)
      .where(and(eq(pageComments.pageId, pageId), isNull(pageComments.deletedAt)))
      .all()
    return threads.flatMap((thread) =>
      this.db
        .select()
        .from(pageCommentMessages)
        .where(
          and(eq(pageCommentMessages.commentId, thread.id), isNull(pageCommentMessages.deletedAt))
        )
        .all()
        .map((message) => ({ id: thread.id, body: message.body }))
    )
  }

  /**
   * What the Reader shows. Reading this does not record a resume.
   * Next chapter is only the stored id, and only while that collection exists.
   */
  reader(collectionId: string): ReaderDocument {
    const row = this.requireCollection(collectionId)
    const pages = this.pages(collectionId)
    const versionIds = pages.flatMap((page) =>
      page.displayedVersionId ? [page.displayedVersionId] : []
    )
    const versionRows = versionIds.length
      ? this.db.select().from(pageVersions).where(inArray(pageVersions.id, versionIds)).all()
      : []
    const byVersion = new Map(versionRows.map((version) => [version.id, version]))
    const assetIds = versionRows.map((version) => version.assetId)
    const files = assetIds.length
      ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
      : []
    const byAsset = new Map(files.map((file) => [file.id, file]))
    const next = row.nextCollectionId
      ? this.db
          .select({ title: collections.title })
          .from(collections)
          .where(and(eq(collections.id, row.nextCollectionId), isNull(collections.deletedAt)))
          .get()
      : undefined
    const layout: ReaderLayout =
      row.readerLayout === 'spread' || row.readerLayout === 'continuous'
        ? row.readerLayout
        : 'single'
    return {
      id: row.id,
      title: row.title,
      direction: row.direction === 'rtl' ? 'rtl' : 'ltr',
      firstPageSide: row.firstPageSide === 'left' ? 'left' : 'right',
      nextCollectionId: next ? row.nextCollectionId : null,
      nextTitle: next?.title ?? null,
      resume: {
        pageId: row.readerPageId,
        layout,
        zoom: row.readerZoom,
        x: row.readerX,
        y: row.readerY
      },
      pages: pages.map((page) => {
        const version = page.displayedVersionId ? byVersion.get(page.displayedVersionId) : undefined
        const file = version ? byAsset.get(version.assetId) : undefined
        const crop =
          version &&
          version.cropX != null &&
          version.cropY != null &&
          version.cropW != null &&
          version.cropH != null
            ? { x: version.cropX, y: version.cropY, w: version.cropW, h: version.cropH }
            : null
        return {
          id: page.id,
          title: page.title,
          label: page.label,
          number: page.number,
          role: page.role,
          span: page.span,
          spreadId: page.spreadId,
          artwork: page.artwork,
          sha256: file && !file.deletedAt ? file.sha256 : null,
          width: file?.width ?? null,
          height: file?.height ?? null,
          crop
        }
      })
    }
  }

  /** Records the Reader that the person just used. A window that only closes does not call this. */
  touchReader(
    collectionId: string,
    state: { pageId: string; layout: string; zoom: number; x: number; y: number }
  ): void {
    this.requireCollection(collectionId)
    const page = this.requirePage(state.pageId)
    if (page.collectionId !== collectionId) throw new Error('That page is not in this collection.')
    const layout: ReaderLayout =
      state.layout === 'spread' || state.layout === 'continuous' ? state.layout : 'single'
    const zoom = Number.isFinite(state.zoom) ? Math.min(8, Math.max(0.25, state.zoom)) : 1
    this.db
      .update(collections)
      .set({
        readerPageId: state.pageId,
        readerLayout: layout,
        readerZoom: zoom,
        readerX: Number.isFinite(state.x) ? state.x : 0,
        readerY: Number.isFinite(state.y) ? state.y : 0,
        readerInteractedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(collections.id, collectionId))
      .run()
  }

  /** Collection-wide settings. Page ids and order stay where they are. */
  updateSettings(
    id: string,
    patch: {
      title?: string
      description?: string
      direction?: ReadingDirection
      firstPageSide?: PageSide
      numberStart?: number
      nextCollectionId?: string | null
    }
  ): void {
    this.requireCollection(id)
    if (patch.nextCollectionId) this.requireCollection(patch.nextCollectionId)
    this.db
      .update(collections)
      .set({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
        ...(patch.firstPageSide !== undefined ? { firstPageSide: patch.firstPageSide } : {}),
        ...(patch.numberStart !== undefined ? { numberStart: patch.numberStart } : {}),
        ...(patch.nextCollectionId !== undefined
          ? { nextCollectionId: patch.nextCollectionId }
          : {}),
        updatedAt: new Date()
      })
      .where(eq(collections.id, id))
      .run()
  }

  /** Progress on one stage. This does not change the page's overall status. */
  setStage(pageId: string, stageId: string, state: PageStatus, note = ''): void {
    const page = this.requirePage(pageId)
    const stage = this.db
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.id, stageId))
      .get()
    if (!stage || stage.removedAt || stage.collectionId !== page.collectionId) {
      throw new Error('That stage is not on this collection.')
    }
    this.db
      .delete(pageStageStates)
      .where(and(eq(pageStageStates.pageId, pageId), eq(pageStageStates.stageId, stageId)))
      .run()
    this.db.insert(pageStageStates).values({ pageId, stageId, state, note }).run()
  }

  /** Hides the shown artwork. The page, its notes, and its version rows stay. */
  clearArtwork(pageId: string, revision: number): { revision: number } {
    const page = this.requirePage(pageId)
    if (page.revision !== revision) throw new Error(COLLECTION_CONFLICT)
    const next = revision + 1
    const result = this.db
      .update(collectionPages)
      .set({ displayedVersionId: null, revision: next, updatedAt: new Date() })
      .where(and(eq(collectionPages.id, pageId), eq(collectionPages.revision, revision)))
      .run()
    if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
    return { revision: next }
  }

  /** Drops one version row. The asset file in the library is left alone. */
  removeVersion(versionId: string): void {
    const version = this.db.select().from(pageVersions).where(eq(pageVersions.id, versionId)).get()
    if (!version) throw new Error('That version is not in this project.')
    const page = this.requirePage(version.pageId)
    const now = new Date()
    this.db.transaction((tx) => {
      tx.delete(pageVersions).where(eq(pageVersions.id, versionId)).run()
      if (page.displayedVersionId === versionId) {
        tx.update(collectionPages)
          .set({ displayedVersionId: null, revision: page.revision + 1, updatedAt: now })
          .where(eq(collectionPages.id, page.id))
          .run()
      }
    })
  }

  /**
   * Soft-deletes pages. A locked partner is included so the pair is not split.
   * One timestamp lets restore put the same pages back.
   */
  trashPages(pageIds: string[]): { pageIds: string[] } {
    if (pageIds.length === 0) return { pageIds: [] }
    const first = this.requirePage(pageIds[0]!)
    for (const id of pageIds) {
      if (this.requirePage(id).collectionId !== first.collectionId) {
        throw new Error('Trash pages from one collection at a time.')
      }
    }
    const ordered = this.livePages(first.collectionId)
    const moving = this.withPartners(ordered, pageIds)
    const now = deletionTime()
    this.db.transaction((tx) => {
      tx.update(collectionPages)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(collectionPages.id, moving))
        .run()
      this.rewritePositions(
        tx,
        ordered.map((page) => page.id).filter((id) => !moving.includes(id))
      )
    })
    return { pageIds: moving }
  }

  restorePages(pageIds: string[]): { pageIds: string[] } {
    const rows = pageIds.map((id) => {
      const row = this.db.select().from(collectionPages).where(eq(collectionPages.id, id)).get()
      if (!row) throw new Error('That page is not in this project.')
      return row
    })
    const deleted = rows.filter((row) => row.deletedAt)
    if (deleted.length === 0) return { pageIds: [] }
    const collectionId = deleted[0]!.collectionId
    if (deleted.some((row) => row.collectionId !== collectionId)) {
      throw new Error('Restore pages into one collection at a time.')
    }
    this.requireCollection(collectionId)
    const selected = new Set(deleted.map((row) => row.id))
    const trashed = this.db
      .select()
      .from(collectionPages)
      .where(
        and(eq(collectionPages.collectionId, collectionId), isNotNull(collectionPages.deletedAt))
      )
      .all()
    for (const page of trashed) {
      if (!selected.has(page.id) || !page.spreadId) continue
      for (const partner of trashed) {
        if (partner.spreadId === page.spreadId) selected.add(partner.id)
      }
    }
    const ids = [...selected]
    const now = new Date()
    this.db.transaction((tx) => {
      tx.update(collectionPages)
        .set({ deletedAt: null, updatedAt: now })
        .where(inArray(collectionPages.id, ids))
        .run()
      const live = this.livePages(collectionId, tx)
      const restoredIds = new Set(ids)
      this.rewritePositions(tx, [
        ...live.filter((page) => !restoredIds.has(page.id)).map((page) => page.id),
        ...live.filter((page) => restoredIds.has(page.id)).map((page) => page.id)
      ])
      this.assertPartnersAdjacent(tx, collectionId)
    })
    return { pageIds: ids }
  }

  /** Hides the collection. Pages, cards, and assets stay so it can come back. */
  trash(id: string): void {
    this.requireCollection(id)
    const now = deletionTime()
    this.db
      .update(collections)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(collections.id, id))
      .run()
  }

  restore(id: string): void {
    const row = this.db.select().from(collections).where(eq(collections.id, id)).get()
    if (!row?.deletedAt) return
    this.db
      .update(collections)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(collections.id, id))
      .run()
  }

  outline(): CollectionOutline {
    const folders = this.db
      .select()
      .from(collectionFolders)
      .where(isNull(collectionFolders.deletedAt))
      .all()
    const rows = this.db.select().from(collections).where(isNull(collections.deletedAt)).all()
    const pages = this.db
      .select({ collectionId: collectionPages.collectionId })
      .from(collectionPages)
      .where(isNull(collectionPages.deletedAt))
      .all()
    const counts = new Map<string, number>()
    for (const page of pages) {
      counts.set(page.collectionId, (counts.get(page.collectionId) ?? 0) + 1)
    }
    return {
      folders: folders.map((folder) => ({
        id: folder.id,
        parentId: folder.parentId,
        name: folder.name,
        sortOrder: folder.sortOrder,
        createdAt: folder.createdAt.getTime(),
        updatedAt: folder.updatedAt.getTime()
      })),
      collections: rows.map((row) => ({
        id: row.id,
        folderId: row.folderId,
        title: row.title,
        sortOrder: row.sortOrder,
        createdAt: row.createdAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
        direction: row.direction === 'rtl' ? 'rtl' : 'ltr',
        pageCount: counts.get(row.id) ?? 0
      }))
    }
  }

  detail(id: string): CollectionDetail {
    const row = this.requireCollection(id)
    const pages = this.pages(id)
    const pageIds = pages.map((page) => page.id)
    const stageStates =
      pageIds.length === 0
        ? []
        : this.db
            .select()
            .from(pageStageStates)
            .where(inArray(pageStageStates.pageId, pageIds))
            .all()
            .map((state) => ({
              pageId: state.pageId,
              stageId: state.stageId,
              state: state.state,
              note: state.note
            }))
    return {
      id: row.id,
      title: row.title,
      folderId: row.folderId,
      direction: row.direction === 'rtl' ? 'rtl' : 'ltr',
      firstPageSide: row.firstPageSide === 'left' ? 'left' : 'right',
      numberStart: row.numberStart,
      plannerView: row.plannerView === 'spread' ? 'spread' : 'grid',
      gridDensity:
        row.gridDensity === 'compact' || row.gridDensity === 'detailed'
          ? row.gridDensity
          : 'balanced',
      gridSize: row.gridSize,
      spreadZoom: row.spreadZoom,
      plannerPageId: row.plannerPageId,
      description: row.description,
      updatedAt: row.updatedAt.getTime(),
      pages,
      stages: this.stages(id),
      stageStates
    }
  }

  rename(id: string, title: string): void {
    this.requireCollection(id)
    this.db
      .update(collections)
      .set({ title: title.trim() || 'Untitled collection', updatedAt: new Date() })
      .where(eq(collections.id, id))
      .run()
  }

  move(id: string, folderId: string | null): void {
    this.requireCollection(id)
    if (folderId) this.requireFolder(folderId)
    this.db
      .update(collections)
      .set({
        folderId,
        sortOrder: this.nextCollectionOrder(folderId),
        updatedAt: new Date()
      })
      .where(eq(collections.id, id))
      .run()
  }

  /** Manual order among items that already share a parent. This does not change ids. */
  reorderSibling(kind: 'folder' | 'collection', id: string, beforeId: string | null): void {
    const now = new Date()
    if (kind === 'folder') {
      const row = this.db
        .select()
        .from(collectionFolders)
        .where(and(eq(collectionFolders.id, id), isNull(collectionFolders.deletedAt)))
        .get()
      if (!row) throw new Error('That folder is not in this project.')
      const siblings = this.db
        .select()
        .from(collectionFolders)
        .where(isNull(collectionFolders.deletedAt))
        .all()
        .filter((folder) => folder.parentId === row.parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
      const ordered = placeBefore(
        siblings.map((folder) => folder.id),
        id,
        beforeId
      )
      this.db.transaction((tx) => {
        ordered.forEach((itemId, index) => {
          tx.update(collectionFolders)
            .set({ sortOrder: index, updatedAt: now })
            .where(eq(collectionFolders.id, itemId))
            .run()
        })
      })
      return
    }
    const row = this.requireCollection(id)
    const siblings = this.db
      .select()
      .from(collections)
      .where(isNull(collections.deletedAt))
      .all()
      .filter((collection) => collection.folderId === row.folderId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
    const ordered = placeBefore(
      siblings.map((collection) => collection.id),
      id,
      beforeId
    )
    this.db.transaction((tx) => {
      ordered.forEach((itemId, index) => {
        tx.update(collections)
          .set({ sortOrder: index, updatedAt: now })
          .where(eq(collections.id, itemId))
          .run()
      })
    })
  }

  /**
   * Saves this collection's direction, opening side, and current stage names as a new template.
   * The collection itself is not changed, and older collections are not rewritten.
   */
  saveTemplate(name: string, collectionId: string): { id: string } {
    const source = this.requireCollection(collectionId)
    const id = randomUUID()
    const now = new Date()
    const data: TemplateData = {
      direction: source.direction === 'rtl' ? 'rtl' : 'ltr',
      firstPageSide: source.firstPageSide === 'left' ? 'left' : 'right',
      stages: this.stages(collectionId).map((stage) => ({ name: stage.name }))
    }
    this.db
      .insert(collectionTemplates)
      .values({
        id,
        name: name.trim() || 'Untitled template',
        builtin: false,
        data: data as unknown as Record<string, unknown>,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id }
  }

  renameTemplate(id: string, name: string): void {
    const row = this.db
      .select()
      .from(collectionTemplates)
      .where(and(eq(collectionTemplates.id, id), isNull(collectionTemplates.deletedAt)))
      .get()
    if (!row) throw new Error('That template is not in this project.')
    if (row.builtin) throw new Error('Built-in template names stay as they are.')
    this.db
      .update(collectionTemplates)
      .set({ name: name.trim() || 'Untitled template', updatedAt: new Date() })
      .where(eq(collectionTemplates.id, id))
      .run()
  }

  /** Planner view and the last selected page. This does not write Reader resume. */
  rememberPlanner(
    id: string,
    patch: {
      view?: 'grid' | 'spread'
      density?: 'compact' | 'balanced' | 'detailed'
      gridSize?: number
      spreadZoom?: number
      pageId?: string | null
    }
  ): void {
    this.requireCollection(id)
    if (patch.pageId) {
      const page = this.requirePage(patch.pageId)
      if (page.collectionId !== id) throw new Error('That page is not in this collection.')
    }
    const gridSize =
      patch.gridSize === undefined ? undefined : Math.min(320, Math.max(96, patch.gridSize))
    const spreadZoom =
      patch.spreadZoom === undefined ? undefined : Math.min(3, Math.max(0.5, patch.spreadZoom))
    this.db
      .update(collections)
      .set({
        ...(patch.view !== undefined ? { plannerView: patch.view } : {}),
        ...(patch.density !== undefined ? { gridDensity: patch.density } : {}),
        ...(gridSize !== undefined ? { gridSize } : {}),
        ...(spreadZoom !== undefined ? { spreadZoom } : {}),
        ...(patch.pageId !== undefined ? { plannerPageId: patch.pageId } : {}),
        updatedAt: new Date()
      })
      .where(eq(collections.id, id))
      .run()
  }

  setSpan(pageId: string, span: 1 | 2): void {
    const page = this.requirePage(pageId)
    if (span === 2 && page.spreadId) {
      throw new Error('Unlock the spread before making the page wide.')
    }
    this.db
      .update(collectionPages)
      .set({
        span,
        spreadId: span === 2 ? null : page.spreadId,
        updatedAt: new Date()
      })
      .where(eq(collectionPages.id, pageId))
      .run()
  }

  unlockSpread(pageId: string): void {
    const page = this.requirePage(pageId)
    if (!page.spreadId) return
    this.db
      .update(collectionPages)
      .set({ spreadId: null, updatedAt: new Date() })
      .where(
        and(
          eq(collectionPages.collectionId, page.collectionId),
          eq(collectionPages.spreadId, page.spreadId)
        )
      )
      .run()
  }

  /**
   * Compact or cover, and what a double-click opens, for this card only.
   * A custom size is left alone. The preset sizes swap only when the card is still a preset.
   */
  setAppearance(
    objectId: string,
    patch: {
      display?: 'compact' | 'cover'
      openWith?: 'planner' | 'reader' | 'last'
      lastOpened?: 'planner' | 'reader'
    }
  ): void {
    const row = this.db
      .select()
      .from(boardObjects)
      .where(and(eq(boardObjects.id, objectId), isNull(boardObjects.deletedAt)))
      .get()
    if (!row || row.type !== 'collection') throw new Error('That card is not a collection.')
    const data = { ...row.data }
    if (patch.display) data.display = patch.display
    if (patch.openWith) data.openWith = patch.openWith
    if (patch.lastOpened) data.lastOpened = patch.lastOpened
    const compact = row.width === 220 && row.height === 148
    const cover = row.width === 260 && row.height === 320
    const size =
      patch.display === 'cover' && compact
        ? { width: 260, height: 320 }
        : patch.display === 'compact' && cover
          ? { width: 220, height: 148 }
          : {}
    this.db
      .update(boardObjects)
      .set({ data, ...size, updatedAt: new Date() })
      .where(eq(boardObjects.id, objectId))
      .run()
  }

  /** Fills collection cards with the collection's title so the canvas does not look it up itself. */
  attach<T extends { type: string; data: Record<string, unknown> }>(
    objects: T[]
  ): (T & {
    collection?: {
      id: string
      title: string
      pageCount: number
      direction: 'ltr' | 'rtl'
      missing: boolean
    }
  })[] {
    const ids = [
      ...new Set(
        objects.flatMap((object) =>
          object.type === 'collection' && typeof object.data.collectionId === 'string'
            ? [object.data.collectionId]
            : []
        )
      )
    ]
    if (ids.length === 0) return objects
    const rows = this.db.select().from(collections).where(inArray(collections.id, ids)).all()
    const byId = new Map(rows.map((row) => [row.id, row]))
    const pages = this.db
      .select({ collectionId: collectionPages.collectionId })
      .from(collectionPages)
      .where(and(inArray(collectionPages.collectionId, ids), isNull(collectionPages.deletedAt)))
      .all()
    const counts = new Map<string, number>()
    for (const page of pages) {
      counts.set(page.collectionId, (counts.get(page.collectionId) ?? 0) + 1)
    }
    return objects.map((object) => {
      if (object.type !== 'collection' || typeof object.data.collectionId !== 'string') {
        return object
      }
      const row = byId.get(object.data.collectionId)
      const missing = !row || row.deletedAt != null
      return {
        ...object,
        collection: {
          id: object.data.collectionId,
          title: missing ? 'Missing collection' : row.title,
          pageCount: counts.get(object.data.collectionId) ?? 0,
          direction: row?.direction === 'rtl' ? 'rtl' : 'ltr',
          missing
        }
      }
    })
  }

  list(): { id: string; folderId: string | null; title: string; sortOrder: number }[] {
    return this.db
      .select()
      .from(collections)
      .where(isNull(collections.deletedAt))
      .orderBy(asc(collections.sortOrder))
      .all()
      .map((row) => ({
        id: row.id,
        folderId: row.folderId,
        title: row.title,
        sortOrder: row.sortOrder
      }))
  }

  /**
   * A new collection. Full copies artwork references and stage progress.
   * Structure keeps slots, order, and notes, and leaves production and artwork behind.
   * Comments stay on the original either way.
   */
  duplicate(collectionId: string, mode: 'full' | 'structure'): { id: string; pageIds: string[] } {
    const source = this.requireCollection(collectionId)
    const id = randomUUID()
    const now = new Date()
    const stageRows = this.db
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.collectionId, collectionId))
      .all()
      .filter((stage) => !stage.removedAt)
    const stageIds = new Map(stageRows.map((stage) => [stage.id, randomUUID()]))
    const sourcePages = this.livePages(collectionId)
    const idMap = new Map(sourcePages.map((page) => [page.id, randomUUID()]))
    const spreadMap = new Map<string, string>()
    this.db.transaction((tx) => {
      tx.insert(collections)
        .values({
          id,
          folderId: source.folderId,
          templateId: source.templateId,
          title: `${source.title} copy`,
          description: source.description,
          coverAssetId: mode === 'full' ? source.coverAssetId : null,
          direction: source.direction,
          firstPageSide: source.firstPageSide,
          numberStart: source.numberStart,
          plannerView: source.plannerView,
          gridDensity: source.gridDensity,
          gridSize: source.gridSize,
          spreadZoom: source.spreadZoom,
          overallStatus: mode === 'full' ? source.overallStatus : 'not_started',
          sortOrder: this.nextCollectionOrder(source.folderId),
          nextCollectionId: source.nextCollectionId,
          createdAt: now,
          updatedAt: now
        })
        .run()
      for (const stage of stageRows) {
        tx.insert(collectionStages)
          .values({
            id: stageIds.get(stage.id)!,
            collectionId: id,
            name: stage.name,
            position: stage.position,
            createdAt: now,
            updatedAt: now
          })
          .run()
      }
      for (const page of sourcePages) {
        const partnerAlsoCopied =
          !!page.spreadId &&
          sourcePages
            .filter((item) => item.spreadId === page.spreadId)
            .every((item) => idMap.has(item.id))
        const spreadId = partnerAlsoCopied
          ? (spreadMap.get(page.spreadId!) ??
              spreadMap.set(page.spreadId!, randomUUID()).get(page.spreadId!))!
          : null
        const copyId = idMap.get(page.id)!
        tx.insert(collectionPages)
          .values({
            id: copyId,
            collectionId: id,
            position: page.position,
            title: page.title,
            label: page.label,
            unnumbered: page.unnumbered,
            role: page.role,
            notes: page.notes,
            overallStatus: mode === 'full' ? page.overallStatus : 'not_started',
            span: page.span,
            spreadId,
            createdAt: now,
            updatedAt: now
          })
          .run()
        if (mode === 'full') {
          this.copyVersions(tx, page.id, copyId, now)
          this.copyStageStates(tx, page.id, copyId, collectionId, id)
          this.copyLinks(tx, page.id, copyId, idMap, id, now, new Map([[collectionId, id]]))
        }
      }
    })
    return { id, pageIds: sourcePages.map((page) => idMap.get(page.id)!) }
  }

  addNav(
    collectionId: string,
    pageId: string,
    kind: 'toc' | 'bookmark',
    title: string
  ): { id: string } {
    const page = this.requirePage(pageId)
    if (page.collectionId !== collectionId) throw new Error('That page is not in this collection.')
    const id = randomUUID()
    const now = new Date()
    const position =
      this.db
        .select({ position: max(collectionNav.position) })
        .from(collectionNav)
        .where(and(eq(collectionNav.collectionId, collectionId), isNull(collectionNav.deletedAt)))
        .get()?.position ?? -1
    this.db
      .insert(collectionNav)
      .values({
        id,
        collectionId,
        pageId,
        kind,
        title: title.trim(),
        position: position + 1,
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id }
  }

  nav(collectionId: string): {
    id: string
    pageId: string
    kind: string
    title: string
    available: boolean
  }[] {
    this.requireCollection(collectionId)
    const rows = this.db
      .select()
      .from(collectionNav)
      .where(and(eq(collectionNav.collectionId, collectionId), isNull(collectionNav.deletedAt)))
      .orderBy(asc(collectionNav.position))
      .all()
    return rows.map((row) => {
      const page = this.db
        .select()
        .from(collectionPages)
        .where(eq(collectionPages.id, row.pageId))
        .get()
      const available = !!page && !page.deletedAt && page.collectionId === collectionId
      return {
        id: row.id,
        pageId: row.pageId,
        kind: row.kind,
        title: row.title,
        available
      }
    })
  }

  renameNav(id: string, title: string): void {
    const row = this.requireNav(id)
    this.db
      .update(collectionNav)
      .set({ title: title.trim(), updatedAt: new Date() })
      .where(eq(collectionNav.id, row.id))
      .run()
  }

  removeNav(id: string): void {
    this.requireNav(id)
    const now = deletionTime()
    this.db
      .update(collectionNav)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(collectionNav.id, id))
      .run()
  }

  /** A canvas card for this collection. Deleting the card does not delete the collection. */
  createAppearance(boardId: string, collectionId: string): { id: string } {
    this.requireCollection(collectionId)
    const id = randomUUID()
    const now = new Date()
    const top = this.db
      .select({ z: max(boardObjects.zIndex) })
      .from(boardObjects)
      .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
      .get()
    this.db
      .insert(boardObjects)
      .values({
        id,
        boardId,
        type: 'collection',
        x: 80,
        y: 80,
        width: 220,
        height: 148,
        zIndex: (top?.z ?? 0) + 1,
        data: { collectionId, display: 'compact', openWith: 'planner' },
        createdAt: now,
        updatedAt: now
      })
      .run()
    return { id }
  }

  /** Ids in sequence order. An empty query matches every page and is not stored. */
  search(collectionId: string, query: string): { ids: string[] } {
    const pages = this.pages(collectionId)
    if (!collectionQueryActive(query)) return { ids: pages.map((page) => page.id) }
    const searchable = this.searchRows(pages)
    return { ids: filterCollectionPages(searchable, query).map((page) => page.id) }
  }

  /**
   * Writes only the fields named by the operation. Replace notes does nothing
   * until `confirmReplace` is true. One undo restores those fields.
   */
  applyBulk(
    ids: string[],
    operation: BulkOperation,
    confirmReplace: boolean
  ): {
    changed: string[]
    alreadyMatching: string[]
    incompatible: { id: string; reason: string }[]
    undo: BulkUndoEntry[]
  } {
    if (operation.kind === 'replace-notes' && !confirmReplace) {
      throw new Error('Replace notes only after you confirm the preview.')
    }
    const unique = [...new Set(ids)]
    const rows = unique.length
      ? this.db.select().from(collectionPages).where(inArray(collectionPages.id, unique)).all()
      : []
    const byId = new Map(rows.map((row) => [row.id, row]))
    const tags = this.pageTags(unique)
    const stages = unique.length
      ? this.db.select().from(pageStageStates).where(inArray(pageStageStates.pageId, unique)).all()
      : []
    const undo: BulkUndoEntry[] = []
    const changed: string[] = []
    const alreadyMatching: string[] = []
    const incompatible: { id: string; reason: string }[] = []
    this.db.transaction((tx) => {
      for (const id of unique) {
        const page = byId.get(id)
        if (!page || page.deletedAt) {
          incompatible.push({ id, reason: 'That page is not in this collection.' })
          continue
        }
        const decision = bulkDecision(
          {
            id,
            notes: page.notes,
            overallStatus: page.overallStatus,
            role: page.role,
            tagIds: tags.filter((tag) => tag.pageId === id).map((tag) => tag.tagId),
            stages: stages
              .filter((stage) => stage.pageId === id)
              .map((stage) => ({ stageId: stage.stageId, state: stage.state }))
          },
          operation
        )
        if (decision.kind === 'same') {
          alreadyMatching.push(id)
          continue
        }
        if (decision.kind === 'incompatible') {
          incompatible.push({ id, reason: decision.reason })
          continue
        }
        if (decision.kind === 'tag') {
          const target = and(
            eq(taggings.tagId, decision.tagId),
            eq(taggings.targetType, 'page'),
            eq(taggings.targetId, id)
          )
          if (decision.added) {
            tx.insert(taggings)
              .values({
                id: randomUUID(),
                tagId: decision.tagId,
                targetType: 'page',
                targetId: id,
                createdAt: new Date()
              })
              .run()
          } else {
            tx.delete(taggings).where(target).run()
          }
          changed.push(id)
          undo.push({ kind: 'tag', id, tagId: decision.tagId, added: decision.added })
          continue
        }
        if (decision.kind === 'stage') {
          const stage = tx
            .select()
            .from(collectionStages)
            .where(eq(collectionStages.id, decision.stageId))
            .get()
          if (!stage || stage.removedAt || stage.collectionId !== page.collectionId) {
            incompatible.push({ id, reason: 'That stage is not on this collection.' })
            continue
          }
          tx.delete(pageStageStates)
            .where(
              and(eq(pageStageStates.pageId, id), eq(pageStageStates.stageId, decision.stageId))
            )
            .run()
          tx.insert(pageStageStates)
            .values({ pageId: id, stageId: decision.stageId, state: decision.state, note: '' })
            .run()
          changed.push(id)
          const prior = stages.find(
            (stage) => stage.pageId === id && stage.stageId === decision.stageId
          )
          undo.push({
            kind: 'stage',
            id,
            stageId: decision.stageId,
            previous: decision.previous,
            previousNote: prior?.note ?? '',
            applied: decision.state
          })
          continue
        }
        const next = page.revision + 1
        const result = tx
          .update(collectionPages)
          .set({ ...decision.patch, revision: next, updatedAt: new Date() })
          .where(and(eq(collectionPages.id, id), eq(collectionPages.revision, page.revision)))
          .run()
        if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
        changed.push(id)
        undo.push({ kind: 'page', id, revision: next, previous: decision.previous })
      }
    })
    return { changed, alreadyMatching, incompatible, undo }
  }

  undoBulk(entries: BulkUndoEntry[]): void {
    this.db.transaction((tx) => {
      for (const entry of entries) {
        if (entry.kind === 'tag') {
          const existing = tx
            .select()
            .from(taggings)
            .where(
              and(
                eq(taggings.tagId, entry.tagId),
                eq(taggings.targetType, 'page'),
                eq(taggings.targetId, entry.id)
              )
            )
            .get()
          if (entry.added) {
            if (!existing) throw new Error(COLLECTION_CONFLICT)
            tx.delete(taggings).where(eq(taggings.id, existing.id)).run()
          } else if (existing) {
            throw new Error(COLLECTION_CONFLICT)
          } else {
            tx.insert(taggings)
              .values({
                id: randomUUID(),
                tagId: entry.tagId,
                targetType: 'page',
                targetId: entry.id,
                createdAt: new Date()
              })
              .run()
          }
          continue
        }
        if (entry.kind === 'stage') {
          const current = tx
            .select()
            .from(pageStageStates)
            .where(
              and(eq(pageStageStates.pageId, entry.id), eq(pageStageStates.stageId, entry.stageId))
            )
            .get()
          if ((current?.state ?? null) !== entry.applied) throw new Error(COLLECTION_CONFLICT)
          tx.delete(pageStageStates)
            .where(
              and(eq(pageStageStates.pageId, entry.id), eq(pageStageStates.stageId, entry.stageId))
            )
            .run()
          if (entry.previous) {
            tx.insert(pageStageStates)
              .values({
                pageId: entry.id,
                stageId: entry.stageId,
                state: entry.previous,
                note: entry.previousNote
              })
              .run()
          }
          continue
        }
        const result = tx
          .update(collectionPages)
          .set({ ...entry.previous, revision: entry.revision + 1, updatedAt: new Date() })
          .where(
            and(eq(collectionPages.id, entry.id), eq(collectionPages.revision, entry.revision))
          )
          .run()
        if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
      }
    })
  }

  /**
   * Creates pages or fills blank ones from an approved plan. The first asset is
   * displayed. Later assets in the same action stay as versions. Status is not changed.
   */
  commitImport(
    collectionId: string,
    beforeId: string | null,
    actions: CommittedAction[]
  ): {
    created: string[]
    filled: {
      pageId: string
      versionIds: string[]
      previousDisplayed: string | null
      revision: number
    }[]
  } {
    this.requireCollection(collectionId)
    const created: string[] = []
    const filled: {
      pageId: string
      versionIds: string[]
      previousDisplayed: string | null
      revision: number
    }[] = []
    this.db.transaction((tx) => {
      for (const action of actions) {
        if (action.assets.length === 0) throw new Error('Choose an image for each page.')
        if (action.kind === 'page') {
          const id = randomUUID()
          const ordered = this.livePages(collectionId, tx)
          const at = this.insertIndex(ordered, beforeId)
          const now = new Date()
          tx.insert(collectionPages)
            .values({
              id,
              collectionId,
              position: at,
              title: stem(action.assets[0]!.name),
              role: 'story',
              overallStatus: 'not_started',
              createdAt: now,
              updatedAt: now
            })
            .run()
          const next = [
            ...ordered.slice(0, at).map((page) => page.id),
            id,
            ...ordered.slice(at).map((page) => page.id)
          ]
          this.rewritePositions(tx, next)
          const versionIds = this.insertVersions(tx, id, action.assets)
          tx.update(collectionPages)
            .set({ displayedVersionId: versionIds[0], revision: 1, updatedAt: now })
            .where(eq(collectionPages.id, id))
            .run()
          created.push(id)
        } else {
          const page = tx
            .select()
            .from(collectionPages)
            .where(
              and(
                eq(collectionPages.id, action.pageId),
                eq(collectionPages.collectionId, collectionId),
                isNull(collectionPages.deletedAt)
              )
            )
            .get()
          if (!page) throw new Error('That page is not in this collection.')
          if (page.displayedVersionId) throw new Error('That page already has artwork.')
          const notes = page.notes
          const status = page.overallStatus
          const versionIds = this.insertVersions(tx, page.id, action.assets)
          const next = page.revision + 1
          const now = new Date()
          const result = tx
            .update(collectionPages)
            .set({ displayedVersionId: versionIds[0], revision: next, updatedAt: now })
            .where(
              and(eq(collectionPages.id, page.id), eq(collectionPages.revision, page.revision))
            )
            .run()
          if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
          const saved = tx
            .select({ notes: collectionPages.notes, overallStatus: collectionPages.overallStatus })
            .from(collectionPages)
            .where(eq(collectionPages.id, page.id))
            .get()
          if (saved?.notes !== notes || saved.overallStatus !== status) {
            throw new Error('Importing artwork must not change notes or status.')
          }
          filled.push({
            pageId: page.id,
            versionIds,
            previousDisplayed: null,
            revision: next
          })
        }
      }
    })
    return { created, filled }
  }

  undoImport(record: {
    created: string[]
    filled: {
      pageId: string
      versionIds: string[]
      previousDisplayed: string | null
      revision: number
    }[]
  }): void {
    this.db.transaction((tx) => {
      if (record.created.length > 0) {
        const now = deletionTime()
        tx.update(collectionPages)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(collectionPages.id, record.created))
          .run()
      }
      for (const fill of record.filled) {
        const result = tx
          .update(collectionPages)
          .set({
            displayedVersionId: fill.previousDisplayed,
            revision: fill.revision + 1,
            updatedAt: new Date()
          })
          .where(
            and(eq(collectionPages.id, fill.pageId), eq(collectionPages.revision, fill.revision))
          )
          .run()
        if (result.changes !== 1) throw new Error(COLLECTION_CONFLICT)
        if (fill.versionIds.length > 0) {
          tx.delete(pageVersions).where(inArray(pageVersions.id, fill.versionIds)).run()
        }
      }
    })
  }

  versions(pageId: string): {
    id: string
    name: string
    assetId: string
    fileName: string
    sha256: string | null
    width: number | null
    height: number | null
    missing: boolean
    crop: { x: number; y: number; w: number; h: number } | null
  }[] {
    this.requirePage(pageId)
    const rows = this.db
      .select()
      .from(pageVersions)
      .where(eq(pageVersions.pageId, pageId))
      .orderBy(asc(pageVersions.position))
      .all()
    const assetIds = rows.map((row) => row.assetId)
    const files = assetIds.length
      ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
      : []
    const byAsset = new Map(files.map((file) => [file.id, file]))
    return rows.map((row) => {
      const file = byAsset.get(row.assetId)
      const crop =
        row.cropX != null && row.cropY != null && row.cropW != null && row.cropH != null
          ? { x: row.cropX, y: row.cropY, w: row.cropW, h: row.cropH }
          : null
      return {
        id: row.id,
        name: row.name,
        assetId: row.assetId,
        fileName: file?.originalName ?? '',
        sha256: file && !file.deletedAt ? file.sha256 : null,
        width: file?.width ?? null,
        height: file?.height ?? null,
        missing: !file || file.deletedAt != null,
        crop
      }
    })
  }

  stageBoardArtwork(
    objects: readonly { id: string; type: string; assetId: string | null }[]
  ): ReturnType<typeof stageKnownAssets> {
    const stackIds = objects.filter((object) => object.type === 'stack').map((object) => object.id)
    const slideRows = stackIds.length
      ? this.db.select().from(stackSlides).where(inArray(stackSlides.stackId, stackIds)).all()
      : []
    const assetIds = [
      ...objects.flatMap((object) => (object.assetId ? [object.assetId] : [])),
      ...slideRows.map((slide) => slide.assetId)
    ]
    const files = assetIds.length
      ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
      : []
    const byId = new Map(files.map((file) => [file.id, file]))
    const items = [
      ...objects.flatMap((object) => {
        if (object.type !== 'image' || !object.assetId) return []
        const file = byId.get(object.assetId)
        if (!file || file.deletedAt || !file.mime.startsWith('image/')) return []
        return [{ name: file.originalName, assetId: file.id }]
      }),
      ...slideRows.flatMap((slide) => {
        const file = byId.get(slide.assetId)
        if (!file || file.deletedAt || !file.mime.startsWith('image/')) return []
        return [{ name: file.originalName, assetId: file.id, sourceSlideId: slide.id }]
      })
    ]
    return stageKnownAssets(items)
  }

  pageTags(pageIds: string[]): { pageId: string; tagId: string }[] {
    if (pageIds.length === 0) return []
    return this.db
      .select({ pageId: taggings.targetId, tagId: taggings.tagId })
      .from(taggings)
      .where(and(eq(taggings.targetType, 'page'), inArray(taggings.targetId, pageIds)))
      .all()
  }

  /**
   * Points one version at another library asset. The version id stays.
   * A crop that does not fit the new image is cleared. The old file is not deleted.
   */
  relinkVersion(versionId: string, assetId: string): { cropCleared: boolean } {
    const version = this.db.select().from(pageVersions).where(eq(pageVersions.id, versionId)).get()
    if (!version) throw new Error('That version is not on this page.')
    const file = this.db.select().from(assets).where(eq(assets.id, assetId)).get()
    if (!file || file.deletedAt) throw new Error('That file is not in the library.')
    const crop =
      version.cropX != null &&
      version.cropY != null &&
      version.cropW != null &&
      version.cropH != null
        ? { x: version.cropX, y: version.cropY, w: version.cropW, h: version.cropH }
        : null
    const fits =
      crop &&
      file.width != null &&
      file.height != null &&
      crop.x + crop.w <= file.width &&
      crop.y + crop.h <= file.height
    const cropCleared = Boolean(crop && !fits)
    this.db
      .update(pageVersions)
      .set({
        assetId,
        ...(cropCleared ? { cropX: null, cropY: null, cropW: null, cropH: null } : {}),
        updatedAt: new Date()
      })
      .where(eq(pageVersions.id, versionId))
      .run()
    return { cropCleared }
  }

  /** Names in a chosen folder that match version file names. This does not import or relink. */
  previewFolderMatch(
    collectionId: string,
    files: readonly { name: string; filePath: string }[]
  ): { versionId: string; filePath: string; fileName: string }[] {
    this.requireCollection(collectionId)
    const versions = this.pages(collectionId).flatMap((page) =>
      this.versions(page.id).map((version) => ({
        versionId: version.id,
        fileName: version.fileName
      }))
    )
    return planFolderMatch(versions, files)
  }

  /** Stores a crop on the version. The asset file is not opened or rewritten. */
  setCrop(versionId: string, crop: { x: number; y: number; w: number; h: number } | null): void {
    const version = this.db
      .select({ id: pageVersions.id })
      .from(pageVersions)
      .where(eq(pageVersions.id, versionId))
      .get()
    if (!version) throw new Error('That version is not on this page.')
    if (crop) {
      const values = [crop.x, crop.y, crop.w, crop.h]
      if (
        values.some((value) => !Number.isInteger(value) || value < 0) ||
        crop.w < 1 ||
        crop.h < 1
      ) {
        throw new Error('Crop uses whole pixels, with a width and height.')
      }
    }
    this.db
      .update(pageVersions)
      .set({
        cropX: crop?.x ?? null,
        cropY: crop?.y ?? null,
        cropW: crop?.w ?? null,
        cropH: crop?.h ?? null,
        updatedAt: new Date()
      })
      .where(eq(pageVersions.id, versionId))
      .run()
  }

  private requireCollection(id: string) {
    const row = this.db
      .select()
      .from(collections)
      .where(and(eq(collections.id, id), isNull(collections.deletedAt)))
      .get()
    if (!row) throw new Error('That collection is not in this project.')
    return row
  }

  private requirePage(id: string) {
    const row = this.db
      .select()
      .from(collectionPages)
      .where(and(eq(collectionPages.id, id), isNull(collectionPages.deletedAt)))
      .get()
    if (!row) throw new Error('That page is not in this project.')
    return row
  }

  private requireNav(id: string) {
    const row = this.db
      .select()
      .from(collectionNav)
      .where(and(eq(collectionNav.id, id), isNull(collectionNav.deletedAt)))
      .get()
    if (!row) throw new Error('That contents entry is not in this project.')
    return row
  }

  private requireFolder(id: string): void {
    const row = this.db
      .select({ id: collectionFolders.id })
      .from(collectionFolders)
      .where(and(eq(collectionFolders.id, id), isNull(collectionFolders.deletedAt)))
      .get()
    if (!row) throw new Error('That folder is not in this project.')
  }

  private folderAncestors(id: string): string[] {
    const ancestors: string[] = []
    let cursor: string | null = id
    while (cursor) {
      const row: { parentId: string | null } | undefined = this.db
        .select({ parentId: collectionFolders.parentId })
        .from(collectionFolders)
        .where(eq(collectionFolders.id, cursor))
        .get()
      cursor = row?.parentId ?? null
      if (cursor) ancestors.push(cursor)
    }
    return ancestors
  }

  private nextFolderOrder(parentId: string | null): number {
    const siblings = this.db
      .select()
      .from(collectionFolders)
      .where(isNull(collectionFolders.deletedAt))
      .all()
      .filter((folder) => folder.parentId === parentId)
    return siblings.reduce((maxOrder, folder) => Math.max(maxOrder, folder.sortOrder), -1) + 1
  }

  private nextCollectionOrder(folderId: string | null): number {
    const siblings = this.db
      .select()
      .from(collections)
      .where(isNull(collections.deletedAt))
      .all()
      .filter((collection) => collection.folderId === folderId)
    return (
      siblings.reduce((maxOrder, collection) => Math.max(maxOrder, collection.sortOrder), -1) + 1
    )
  }

  private displayedArtwork(
    rows: { id: string; displayedVersionId: string | null }[]
  ): Map<string, { state: ArtworkState; name: string; sha256: string | null }> {
    const result = new Map<string, { state: ArtworkState; name: string; sha256: string | null }>()
    const versionIds = rows.flatMap((row) =>
      row.displayedVersionId ? [row.displayedVersionId] : []
    )
    const versions = versionIds.length
      ? this.db.select().from(pageVersions).where(inArray(pageVersions.id, versionIds)).all()
      : []
    const byVersion = new Map(versions.map((version) => [version.id, version]))
    const assetIds = versions.map((version) => version.assetId)
    const files = assetIds.length
      ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
      : []
    const byAsset = new Map(files.map((file) => [file.id, file]))
    for (const row of rows) {
      const version = row.displayedVersionId ? byVersion.get(row.displayedVersionId) : undefined
      const file = version ? byAsset.get(version.assetId) : undefined
      const present = Boolean(file && !file.deletedAt)
      const state = classifyArtwork({
        hasVersion: Boolean(row.displayedVersionId),
        assetPresent: present,
        mime: file?.mime ?? null,
        width: file?.width ?? null,
        height: file?.height ?? null
      })
      result.set(row.id, {
        state,
        name: version?.name || file?.originalName || '',
        sha256: state === 'ready' || state === 'damaged' ? (file?.sha256 ?? null) : null
      })
    }
    return result
  }

  private searchRows(pages: CollectionPageView[]): CollectionSearchPage[] {
    const ids = pages.map((page) => page.id)
    if (ids.length === 0) return []
    const versionRows = this.db
      .select()
      .from(pageVersions)
      .where(inArray(pageVersions.pageId, ids))
      .all()
    const assetIds = versionRows.map((row) => row.assetId)
    const files = assetIds.length
      ? this.db.select().from(assets).where(inArray(assets.id, assetIds)).all()
      : []
    const fileName = new Map(files.map((file) => [file.id, file.originalName]))
    const tagRows = this.db
      .select({ name: tags.name, targetId: taggings.targetId })
      .from(taggings)
      .innerJoin(tags, eq(tags.id, taggings.tagId))
      .where(and(eq(taggings.targetType, 'page'), inArray(taggings.targetId, ids)))
      .all()
    const commentRows = this.db
      .select({ pageId: pageComments.pageId, body: pageCommentMessages.body })
      .from(pageComments)
      .innerJoin(pageCommentMessages, eq(pageCommentMessages.commentId, pageComments.id))
      .where(and(inArray(pageComments.pageId, ids), isNull(pageComments.deletedAt)))
      .all()
    const stageRows = this.db
      .select()
      .from(pageStageStates)
      .where(inArray(pageStageStates.pageId, ids))
      .all()
    return pages.map((page) => ({
      id: page.id,
      title: page.title,
      label: page.label,
      notes: page.notes,
      number: page.number,
      overallStatus: page.overallStatus,
      role: page.role,
      spreadId: page.spreadId,
      span: page.span,
      versionNames: versionRows.filter((row) => row.pageId === page.id).map((row) => row.name),
      fileNames: versionRows
        .filter((row) => row.pageId === page.id)
        .map((row) => fileName.get(row.assetId) ?? ''),
      tags: tagRows.filter((row) => row.targetId === page.id).map((row) => row.name),
      comments: commentRows.filter((row) => row.pageId === page.id).map((row) => row.body),
      stageNotes: stageRows
        .filter((row) => row.pageId === page.id)
        .map((row) => row.note)
        .filter(Boolean),
      blank: page.artwork === 'blank'
    }))
  }

  private insertVersions(
    tx: ProjectDb,
    pageId: string,
    items: { assetId: string; name: string; sourceSlideId?: string | null }[]
  ): string[] {
    const now = new Date()
    return items.map((item, index) => {
      const id = randomUUID()
      tx.insert(pageVersions)
        .values({
          id,
          pageId,
          assetId: item.assetId,
          name: stem(item.name),
          sourceSlideId: item.sourceSlideId ?? null,
          position: index,
          createdAt: now,
          updatedAt: now
        })
        .run()
      return id
    })
  }

  private livePages(collectionId: string, tx: ProjectDb = this.db) {
    return tx
      .select()
      .from(collectionPages)
      .where(and(eq(collectionPages.collectionId, collectionId), isNull(collectionPages.deletedAt)))
      .orderBy(asc(collectionPages.position), asc(collectionPages.createdAt))
      .all()
  }

  private insertIndex(ordered: { id: string }[], beforeId?: string | null): number {
    if (!beforeId) return ordered.length
    const index = ordered.findIndex((page) => page.id === beforeId)
    if (index < 0) throw new Error('That page is not in this collection.')
    return index
  }

  private rewritePositions(tx: ProjectDb, ids: string[]): void {
    const now = new Date()
    ids.forEach((id, index) => {
      tx.update(collectionPages)
        .set({ position: index, updatedAt: now })
        .where(eq(collectionPages.id, id))
        .run()
    })
  }

  private withPartners(
    ordered: { id: string; spreadId: string | null }[],
    pageIds: string[]
  ): string[] {
    const selected = new Set(pageIds)
    for (const page of ordered) {
      if (!selected.has(page.id) || !page.spreadId) continue
      for (const partner of ordered) {
        if (partner.spreadId === page.spreadId) selected.add(partner.id)
      }
    }
    return ordered.map((page) => page.id).filter((id) => selected.has(id))
  }

  private assertPartnersAdjacent(tx: ProjectDb, collectionId: string): void {
    const ordered = this.livePages(collectionId, tx)
    const seen = new Set<string>()
    for (let index = 0; index < ordered.length; index += 1) {
      const spreadId = ordered[index]!.spreadId
      if (!spreadId || seen.has(spreadId)) continue
      seen.add(spreadId)
      const members = ordered.filter((page) => page.spreadId === spreadId)
      if (members.length !== 2) throw new Error('A locked spread needs both pages.')
      const first = ordered.findIndex((page) => page.id === members[0]!.id)
      const second = ordered.findIndex((page) => page.id === members[1]!.id)
      if (Math.abs(first - second) !== 1) throw new Error('A locked spread cannot be split.')
    }
  }

  private remapStages(
    tx: ProjectDb,
    pageId: string,
    fromCollectionId: string,
    toCollectionId: string
  ): UnmappedStage[] {
    if (fromCollectionId === toCollectionId) return []
    const sourceStages = tx
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.collectionId, fromCollectionId))
      .all()
    const destStages = tx
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.collectionId, toCollectionId))
      .all()
      .filter((stage) => !stage.removedAt)
    const byName = new Map(destStages.map((stage) => [normalize(stage.name), stage.id]))
    const states = tx.select().from(pageStageStates).where(eq(pageStageStates.pageId, pageId)).all()
    const unmapped: UnmappedStage[] = []
    for (const state of states) {
      const stage = sourceStages.find((item) => item.id === state.stageId)
      const match = stage ? byName.get(normalize(stage.name)) : undefined
      if (!stage || !match) {
        unmapped.push({
          pageId,
          stageId: state.stageId,
          stageName: stage?.name ?? 'Stage',
          state: state.state,
          note: state.note
        })
        continue
      }
      if (match === state.stageId) continue
      tx.delete(pageStageStates)
        .where(and(eq(pageStageStates.pageId, pageId), eq(pageStageStates.stageId, state.stageId)))
        .run()
      tx.insert(pageStageStates)
        .values({ pageId, stageId: match, state: state.state, note: state.note })
        .run()
    }
    return unmapped
  }

  private copyVersions(tx: ProjectDb, fromId: string, toId: string, now: Date): void {
    const versions = tx.select().from(pageVersions).where(eq(pageVersions.pageId, fromId)).all()
    let displayed: string | null = null
    const source = tx
      .select({ displayedVersionId: collectionPages.displayedVersionId })
      .from(collectionPages)
      .where(eq(collectionPages.id, fromId))
      .get()
    for (const version of versions) {
      const id = randomUUID()
      if (version.id === source?.displayedVersionId) displayed = id
      tx.insert(pageVersions)
        .values({
          id,
          pageId: toId,
          name: version.name,
          assetId: version.assetId,
          position: version.position,
          cropX: version.cropX,
          cropY: version.cropY,
          cropW: version.cropW,
          cropH: version.cropH,
          sourceSlideId: version.sourceSlideId,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
    if (displayed) {
      tx.update(collectionPages)
        .set({ displayedVersionId: displayed })
        .where(eq(collectionPages.id, toId))
        .run()
    }
  }

  private copyStageStates(
    tx: ProjectDb,
    fromId: string,
    toId: string,
    fromCollectionId: string,
    toCollectionId: string
  ): void {
    const sourceStages = tx
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.collectionId, fromCollectionId))
      .all()
    const destStages = tx
      .select()
      .from(collectionStages)
      .where(eq(collectionStages.collectionId, toCollectionId))
      .all()
    const byName = new Map(destStages.map((stage) => [normalize(stage.name), stage.id]))
    const states = tx.select().from(pageStageStates).where(eq(pageStageStates.pageId, fromId)).all()
    for (const state of states) {
      const stage = sourceStages.find((item) => item.id === state.stageId)
      const match = stage ? byName.get(normalize(stage.name)) : undefined
      if (!match) continue
      tx.insert(pageStageStates)
        .values({ pageId: toId, stageId: match, state: state.state, note: state.note })
        .run()
    }
  }

  private copyLinks(
    tx: ProjectDb,
    fromId: string,
    toId: string,
    idMap: Map<string, string>,
    toCollectionId: string,
    now: Date,
    collectionIds: Map<string, string> = new Map()
  ): void {
    const links = tx
      .select()
      .from(pageLinks)
      .where(and(eq(pageLinks.pageId, fromId), isNull(pageLinks.deletedAt)))
      .all()
    const remap = new Map(idMap)
    const copiedPageIds = new Set(idMap.values())
    for (const link of links) {
      const destination = parseDestination(link.destination)
      const next = destination ? remapDestination(destination, remap, false) : null
      let stored = (next ?? destination) as Destination | null
      if (stored?.kind === 'page' && copiedPageIds.has(stored.pageId)) {
        stored = {
          ...stored,
          collectionId: collectionIds.get(stored.collectionId) ?? toCollectionId
        }
      }
      if (stored?.kind === 'collection') {
        const nextCollection = collectionIds.get(stored.collectionId)
        if (nextCollection) stored = { ...stored, collectionId: nextCollection }
      }
      tx.insert(pageLinks)
        .values({
          id: randomUUID(),
          pageId: toId,
          destination: (stored ?? {}) as Record<string, unknown>,
          createdAt: now,
          updatedAt: now
        })
        .run()
    }
  }

  private copyComments(tx: ProjectDb, fromId: string, toId: string, now: Date): void {
    const threads = tx
      .select()
      .from(pageComments)
      .where(and(eq(pageComments.pageId, fromId), isNull(pageComments.deletedAt)))
      .all()
    for (const thread of threads) {
      const id = randomUUID()
      tx.insert(pageComments)
        .values({ id, pageId: toId, status: thread.status, createdAt: now, updatedAt: now })
        .run()
      const messages = tx
        .select()
        .from(pageCommentMessages)
        .where(eq(pageCommentMessages.commentId, thread.id))
        .all()
      for (const message of messages) {
        tx.insert(pageCommentMessages)
          .values({
            id: randomUUID(),
            commentId: id,
            body: message.body,
            createdAt: now,
            updatedAt: now
          })
          .run()
      }
    }
  }
}

const PAGE_FIELDS = ['title', 'notes', 'label', 'overallStatus', 'role', 'unnumbered'] as const

/** The edited fields still have the values this window started from. Other fields may have changed. */
function sameFields(
  page: {
    title: string
    notes: string
    label: string
    overallStatus: string
    role: string | null
    unnumbered: boolean | null
  },
  patch: PagePatch,
  base: PagePatch | undefined
): boolean {
  if (!base) return false
  return PAGE_FIELDS.every((key) => {
    if (patch[key] === undefined) return true
    const current = page[key] ?? null
    const expected = base[key] ?? null
    return current === expected
  })
}

function stem(name: string): string {
  const base = name.replace(/\\/g, '/').split('/').pop() ?? name
  return base.replace(/\.[^.]+$/, '') || base
}
