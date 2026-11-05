/**
 * Page collections (M9). A collection is not a canvas card, and a page id is not a page number.
 * This module does not import Electron, so the tests can open a project directly.
 */
import { randomUUID } from 'node:crypto'
import { and, asc, eq, inArray, isNotNull, isNull, max } from 'drizzle-orm'
import {
  BLANK_TEMPLATE,
  BUILTIN_TEMPLATES,
  COMIC_TEMPLATE,
  derivedNumbers,
  MANGA_TEMPLATE,
  type PageRole,
  type PageStatus,
  type ReadingDirection,
  type PageSide,
  type TemplateData
} from '@shared/collections'
import { parseDestination, remapDestination, type Destination } from '@shared/destinations'
import type { ProjectDb } from '../db/client'
import {
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
  pageVersions
} from '../db/schema'
import { deletionTime } from './boards'

export const COLLECTION_CONFLICT = 'Another window changed this page. The change was not saved.'

const BUILTINS: { id: string; name: string; data: TemplateData }[] = [
  { id: BUILTIN_TEMPLATES.blank, name: 'Blank', data: BLANK_TEMPLATE },
  { id: BUILTIN_TEMPLATES.manga, name: 'Manga', data: MANGA_TEMPLATE },
  { id: BUILTIN_TEMPLATES.comic, name: 'Comic', data: COMIC_TEMPLATE }
]

export interface CollectionPageView {
  id: string
  collectionId: string
  position: number
  title: string
  label: string
  role: PageRole | null
  unnumbered: boolean | null
  notes: string
  overallStatus: string
  /** Derived story number. Null when the page is unnumbered. */
  number: number | null
  span: 1 | 2
  spreadId: string | null
  displayedVersionId: string | null
  revision: number
}

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
      revision: row.revision
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
    patch: { title?: string; notes?: string; label?: string; overallStatus?: PageStatus }
  ): { revision: number } {
    const page = this.requirePage(id)
    if (page.revision !== revision) throw new Error(COLLECTION_CONFLICT)
    const next = revision + 1
    const result = this.db
      .update(collectionPages)
      .set({ ...patch, revision: next, updatedAt: new Date() })
      .where(and(eq(collectionPages.id, id), eq(collectionPages.revision, revision)))
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

  /** Records the Reader that the person just used. A window that only closes does not call this. */
  touchReader(
    collectionId: string,
    state: { pageId: string; layout: string; zoom: number; x: number; y: number }
  ): void {
    this.requireCollection(collectionId)
    this.db
      .update(collections)
      .set({
        readerPageId: state.pageId,
        readerLayout: state.layout,
        readerZoom: state.zoom,
        readerX: state.x,
        readerY: state.y,
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
