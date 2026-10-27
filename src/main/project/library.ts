import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type {
  FolderDeletePreview,
  LibraryDetails,
  LibraryEntry,
  LibraryPage,
  LibraryQuery,
  PurgeResult,
  StorageReport,
  TrashItem
} from '@shared/types'
import type { ProjectDb } from '../db/client'
import { assets, boardObjects, boards, folders, libraryEntries, stackSlides } from '../db/schema'
import { deletionTime } from './boards'
import { toAssetInfo, attachPreviews } from './assets'

type FolderRow = { id: string; name: string; parentId: string | null }

/** Browsing, moving, trashing and purging library entries (ADR-016). */
export class LibraryRepository {
  constructor(private readonly db: ProjectDb) {}

  list(query: LibraryQuery): LibraryPage {
    const folderRows = this.folderRows(false)
    const conditions = [isNull(libraryEntries.deletedAt)]
    const folderId = query.folderId
    if (query.unfiled) {
      conditions.push(isNull(libraryEntries.folderId))
    } else if (query.direct) {
      conditions.push(
        folderId ? eq(libraryEntries.folderId, folderId) : isNull(libraryEntries.folderId)
      )
    } else if (query.scope === 'folder' && folderId) {
      conditions.push(
        inArray(libraryEntries.folderId, [folderId, ...descendantIds(folderRows, folderId)])
      )
    }
    const text = query.query?.trim().toLowerCase() ?? ''
    if (text) {
      const pattern = `%${text.replace(/[%_\\]/g, '')}%`
      conditions.push(
        sql`(lower(${libraryEntries.name}) like ${pattern} or lower(${assets.ext}) like ${pattern})`
      )
    }
    if (query.type === 'image') conditions.push(sql`${assets.mime} like 'image/%'`)
    else if (query.type === 'pdf') conditions.push(eq(assets.mime, 'application/pdf'))
    else if (query.type === 'other') {
      conditions.push(
        sql`${assets.mime} not like 'image/%' and ${assets.mime} != 'application/pdf'`
      )
    }
    const where = and(...conditions)
    const sort = query.sort ?? 'name'
    const columns = {
      name: libraryEntries.name,
      imported: libraryEntries.createdAt,
      size: assets.bytes,
      type: assets.ext
    }
    const column = columns[sort] ?? libraryEntries.name
    const ordered = (query.direction ?? 'asc') === 'desc' ? desc(column) : asc(column)
    const rows = this.db
      .select({ entry: libraryEntries, asset: assets })
      .from(libraryEntries)
      .innerJoin(assets, eq(assets.id, libraryEntries.assetId))
      .where(where)
      .orderBy(ordered, asc(libraryEntries.id))
      .all()
    const infos = rows.map((row) => toAssetInfo(row.asset))
    const entries = rows.map((row, index) => this.toEntry(row.entry, infos[index], folderRows))
    const offset = Math.max(0, query.offset ?? 0)
    const limit = Math.min(200, Math.max(1, query.limit ?? 80))
    const page = entries.slice(offset, offset + limit)
    attachPreviews(
      this.db,
      page.map((entry) => entry.asset)
    )
    return {
      total: entries.length,
      ids: entries.map((entry) => entry.id),
      assetIds: entries.map((entry) => entry.assetId),
      entries: page
    }
  }

  details(id: string): LibraryDetails {
    const entry = this.requireActive(id)
    const folderRows = this.folderRows(true)
    const assetRow = this.db.select().from(assets).where(eq(assets.id, entry.assetId)).get()
    if (!assetRow) throw new Error('The stored file is missing.')
    const info = toAssetInfo(assetRow)
    attachPreviews(this.db, [info])
    const siblings = this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.assetId, entry.assetId), isNull(libraryEntries.deletedAt)))
      .all()
    const appearances = this.db
      .select({
        objectId: boardObjects.id,
        boardId: boards.id,
        boardTitle: boards.title
      })
      .from(boardObjects)
      .innerJoin(boards, eq(boards.id, boardObjects.boardId))
      .where(
        and(
          eq(boardObjects.assetId, entry.assetId),
          isNull(boardObjects.deletedAt),
          isNull(boards.deletedAt)
        )
      )
      .all()
    return {
      entry: this.toEntry(entry, info, folderRows),
      sameOriginal: siblings.map((row) => ({
        id: row.id,
        name: row.name,
        folderPath: folderPath(folderRows, row.folderId)
      })),
      appearances
    }
  }

  /** How many boards still show this original. Trashing an entry does not change that. */
  boardCount(assetId: string): number {
    const rows = this.db
      .select({ boardId: boardObjects.boardId })
      .from(boardObjects)
      .where(and(eq(boardObjects.assetId, assetId), isNull(boardObjects.deletedAt)))
      .all()
    return new Set(rows.map((row) => row.boardId)).size
  }

  rename(id: string, name: string): string {
    const row = this.requireActive(id)
    const clean = name.trim()
    if (!clean) throw new Error('The name cannot be empty.')
    this.db
      .update(libraryEntries)
      .set({ name: clean, updatedAt: new Date() })
      .where(eq(libraryEntries.id, id))
      .run()
    return row.name
  }

  move(ids: string[], folderId: string | null): { id: string; folderId: string | null }[] {
    if (folderId) {
      const folder = this.db
        .select({ id: folders.id })
        .from(folders)
        .where(and(eq(folders.id, folderId), isNull(folders.deletedAt)))
        .get()
      if (!folder) throw new Error('That folder is not in the library.')
    }
    const previous = ids.map((id) => {
      const row = this.requireActive(id)
      return { id: row.id, folderId: row.folderId }
    })
    if (ids.length === 0) return []
    const now = new Date()
    this.db
      .update(libraryEntries)
      .set({ folderId, updatedAt: now })
      .where(and(inArray(libraryEntries.id, ids), isNull(libraryEntries.deletedAt)))
      .run()
    return previous
  }

  trash(ids: string[]): { entryIds: string[]; boardCount: number } {
    const rows = ids.map((id) => this.requireActive(id))
    const now = deletionTime()
    this.db
      .update(libraryEntries)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(libraryEntries.id, ids))
      .run()
    const boards = new Set<string>()
    for (const row of rows) {
      const hits = this.db
        .select({ boardId: boardObjects.boardId })
        .from(boardObjects)
        .where(and(eq(boardObjects.assetId, row.assetId), isNull(boardObjects.deletedAt)))
        .all()
      for (const hit of hits) boards.add(hit.boardId)
    }
    return { entryIds: ids, boardCount: boards.size }
  }

  restoreEntries(
    ids: string[],
    destinationFolderId?: string | null
  ): { restored: string[]; needsDestination: string[] } {
    const restored: string[] = []
    const needsDestination: string[] = []
    const now = new Date()
    for (const id of ids) {
      const row = this.db.select().from(libraryEntries).where(eq(libraryEntries.id, id)).get()
      if (!row?.deletedAt) continue
      const parentOk =
        !row.folderId ||
        this.db
          .select({ id: folders.id })
          .from(folders)
          .where(and(eq(folders.id, row.folderId), isNull(folders.deletedAt)))
          .get()
      if (!parentOk && destinationFolderId === undefined) {
        needsDestination.push(id)
        continue
      }
      this.db
        .update(libraryEntries)
        .set({
          deletedAt: null,
          folderId: parentOk ? row.folderId : destinationFolderId,
          updatedAt: now
        })
        .where(eq(libraryEntries.id, id))
        .run()
      restored.push(id)
    }
    return { restored, needsDestination }
  }

  folderPreview(id: string): FolderDeletePreview {
    const tree = this.folderTree(id)
    const entryRows = this.entriesIn(tree)
    const parentId =
      this.db.select().from(folders).where(eq(folders.id, id)).get()?.parentId ?? null
    const conflicts = this.nameConflicts(tree, entryRows, parentId)
    return {
      entries: entryRows.length,
      folders: tree.length - 1,
      boardCount: this.boardsUsing(entryRows.map((row) => row.assetId)),
      conflicts
    }
  }

  /**
   * Moves the folder's children up to its parent, then trashes the empty folder.
   * Same names are suffixed only when `renameConflicts` is set.
   */
  dissolveFolder(id: string, renameConflicts: boolean): { renamed: string[] } {
    const folder = this.db
      .select()
      .from(folders)
      .where(and(eq(folders.id, id), isNull(folders.deletedAt)))
      .get()
    if (!folder) throw new Error('Folder not found. It may have been deleted.')
    const children = this.db
      .select()
      .from(folders)
      .where(and(eq(folders.parentId, id), isNull(folders.deletedAt)))
      .all()
    const entries = this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.folderId, id), isNull(libraryEntries.deletedAt)))
      .all()
    const conflicts = this.nameConflicts([folder, ...children], entries, folder.parentId).filter(
      (name) =>
        children.some((child) => child.name === name) ||
        entries.some((entry) => entry.name === name)
    )
    if (conflicts.length && !renameConflicts) {
      throw new Error(`These names already exist in the parent folder: ${conflicts.join(', ')}`)
    }
    const taken = new Set(this.siblingNames(folder.parentId, id))
    const renamed: string[] = []
    const now = new Date()
    for (const child of children) {
      const name = renameConflicts ? freshName(taken, child.name) : child.name
      if (name !== child.name) renamed.push(`${child.name} → ${name}`)
      this.db
        .update(folders)
        .set({ parentId: folder.parentId, name, updatedAt: now })
        .where(eq(folders.id, child.id))
        .run()
    }
    for (const entry of entries) {
      const name = renameConflicts ? freshName(taken, entry.name) : entry.name
      if (name !== entry.name) renamed.push(`${entry.name} → ${name}`)
      this.db
        .update(libraryEntries)
        .set({ folderId: folder.parentId, name, updatedAt: now })
        .where(eq(libraryEntries.id, entry.id))
        .run()
    }
    const stamp = deletionTime()
    this.db
      .update(folders)
      .set({ deletedAt: stamp, updatedAt: stamp })
      .where(eq(folders.id, id))
      .run()
    return { renamed }
  }

  restoreFolders(
    ids: string[],
    destinationParentId?: string | null
  ): { restoredFolderIds: string[]; restoredEntryIds: string[]; needsDestination: string[] } {
    const restoredFolderIds: string[] = []
    const restoredEntryIds: string[] = []
    const needsDestination: string[] = []
    const now = new Date()
    const all = this.db.select().from(folders).all()
    for (const id of ids) {
      const folder = all.find((row) => row.id === id)
      if (!folder?.deletedAt) continue
      const parent = folder.parentId ? all.find((row) => row.id === folder.parentId) : null
      const parentOk = !folder.parentId || Boolean(parent && !parent.deletedAt)
      if (!parentOk && destinationParentId === undefined) {
        needsDestination.push(id)
        continue
      }
      const stamp = folder.deletedAt.getTime()
      const tree = [id, ...descendantsAt(all, id, stamp)]
      this.db
        .update(folders)
        .set({
          deletedAt: null,
          updatedAt: now,
          ...(parentOk ? {} : { parentId: destinationParentId })
        })
        .where(eq(folders.id, id))
        .run()
      const rest = tree.filter((folderId) => folderId !== id)
      if (rest.length) {
        this.db
          .update(folders)
          .set({ deletedAt: null, updatedAt: now })
          .where(inArray(folders.id, rest))
          .run()
      }
      const entries = this.db
        .select()
        .from(libraryEntries)
        .where(inArray(libraryEntries.folderId, tree))
        .all()
        .filter((entry) => entry.deletedAt?.getTime() === stamp)
      if (entries.length) {
        this.db
          .update(libraryEntries)
          .set({ deletedAt: null, updatedAt: now })
          .where(
            inArray(
              libraryEntries.id,
              entries.map((entry) => entry.id)
            )
          )
          .run()
        restoredEntryIds.push(...entries.map((entry) => entry.id))
      }
      for (const row of all) {
        if (tree.includes(row.id)) row.deletedAt = null
        if (row.id === id && !parentOk) row.parentId = destinationParentId ?? null
      }
      restoredFolderIds.push(...tree)
    }
    return { restoredFolderIds, restoredEntryIds, needsDestination }
  }

  trashList(kind: 'all' | TrashItem['kind']): TrashItem[] {
    const folderRows = this.folderRows(true)
    const items: TrashItem[] = []
    if (kind === 'all' || kind === 'entry') {
      const rows = this.db
        .select({ entry: libraryEntries, asset: assets })
        .from(libraryEntries)
        .innerJoin(assets, eq(assets.id, libraryEntries.assetId))
        .where(sql`${libraryEntries.deletedAt} is not null`)
        .all()
      for (const row of rows) {
        items.push({
          kind: 'entry',
          id: row.entry.id,
          name: row.entry.name,
          deletedAt: row.entry.deletedAt!.getTime(),
          location: folderPath(folderRows, row.entry.folderId) || 'Library',
          assetId: row.entry.assetId,
          boardId: null
        })
      }
    }
    if (kind === 'all' || kind === 'folder') {
      const rows = this.db
        .select()
        .from(folders)
        .where(sql`${folders.deletedAt} is not null`)
        .all()
      for (const row of rows) {
        items.push({
          kind: 'folder',
          id: row.id,
          name: row.name,
          deletedAt: row.deletedAt!.getTime(),
          location: folderPath(folderRows, row.parentId) || 'Library',
          assetId: null,
          boardId: null
        })
      }
    }
    if (kind === 'all' || kind === 'object') {
      const rows = this.db
        .select({ object: boardObjects, board: boards })
        .from(boardObjects)
        .innerJoin(boards, eq(boards.id, boardObjects.boardId))
        .where(sql`${boardObjects.deletedAt} is not null`)
        .all()
      for (const row of rows) {
        items.push({
          kind: 'object',
          id: row.object.id,
          name: row.board.title,
          deletedAt: row.object.deletedAt!.getTime(),
          location: row.board.deletedAt ? `${row.board.title} (in Trash)` : row.board.title,
          assetId: row.object.assetId,
          boardId: row.object.boardId
        })
      }
    }
    return items.sort((a, b) => b.deletedAt - a.deletedAt)
  }

  /**
   * Hard-deletes the chosen trashed rows, then removes original files nothing still references.
   * The caller deletes those files from disk after this returns.
   */
  purge(input: { entries: string[]; folders: string[]; objects: string[] }): PurgeResult & {
    removedFiles: { sha256: string; ext: string }[]
  } {
    const touched = new Set<string>()
    return this.db.transaction(() => {
      if (input.entries.length) {
        const rows = this.db
          .select()
          .from(libraryEntries)
          .where(
            and(
              inArray(libraryEntries.id, input.entries),
              sql`${libraryEntries.deletedAt} is not null`
            )
          )
          .all()
        for (const row of rows) touched.add(row.assetId)
        this.db
          .delete(libraryEntries)
          .where(
            and(
              inArray(libraryEntries.id, input.entries),
              sql`${libraryEntries.deletedAt} is not null`
            )
          )
          .run()
      }
      if (input.objects.length) {
        const rows = this.db
          .select()
          .from(boardObjects)
          .where(
            and(inArray(boardObjects.id, input.objects), sql`${boardObjects.deletedAt} is not null`)
          )
          .all()
        for (const row of rows) if (row.assetId) touched.add(row.assetId)
        this.db
          .delete(boardObjects)
          .where(
            and(inArray(boardObjects.id, input.objects), sql`${boardObjects.deletedAt} is not null`)
          )
          .run()
      }
      if (input.folders.length) {
        const trashed = this.db
          .select({ id: folders.id })
          .from(folders)
          .where(and(inArray(folders.id, input.folders), sql`${folders.deletedAt} is not null`))
          .all()
          .map((row) => row.id)
        if (trashed.length) {
          this.db
            .update(libraryEntries)
            .set({ folderId: null })
            .where(inArray(libraryEntries.folderId, trashed))
            .run()
          this.db
            .update(folders)
            .set({ parentId: null })
            .where(inArray(folders.parentId, trashed))
            .run()
          this.db.delete(folders).where(inArray(folders.id, trashed)).run()
        }
      }
      const removedFiles: { sha256: string; ext: string }[] = []
      const filesKept: { name: string; reason: string }[] = []
      const queue = [...touched]
      const seen = new Set<string>()
      while (queue.length) {
        const id = queue.shift()!
        if (seen.has(id)) continue
        seen.add(id)
        const asset = this.db.select().from(assets).where(eq(assets.id, id)).get()
        if (!asset) continue
        const reason = this.keepReason(id)
        if (reason) {
          filesKept.push({ name: asset.originalName, reason })
          continue
        }
        const previewId = asset.previewAssetId
        this.db.delete(assets).where(eq(assets.id, id)).run()
        removedFiles.push({ sha256: asset.sha256, ext: asset.ext })
        if (previewId) queue.push(previewId)
      }
      return { filesDeleted: removedFiles.length, filesKept, unlinkErrors: [], removedFiles }
    })
  }

  emptyTrash(): PurgeResult & { removedFiles: { sha256: string; ext: string }[] } {
    const items = this.trashList('all')
    return this.purge({
      entries: items.filter((item) => item.kind === 'entry').map((item) => item.id),
      folders: items.filter((item) => item.kind === 'folder').map((item) => item.id),
      objects: items.filter((item) => item.kind === 'object').map((item) => item.id)
    })
  }

  storage(thumbnailBytes: number): StorageReport {
    const rows = this.db.select({ mime: assets.mime, bytes: assets.bytes }).from(assets).all()
    let imageBytes = 0
    let pdfBytes = 0
    let otherBytes = 0
    for (const row of rows) {
      if (row.mime.startsWith('image/')) imageBytes += row.bytes
      else if (row.mime === 'application/pdf') pdfBytes += row.bytes
      else otherBytes += row.bytes
    }
    const entryCount = this.db
      .select({ n: count() })
      .from(libraryEntries)
      .where(isNull(libraryEntries.deletedAt))
      .get()!.n
    return {
      originalBytes: imageBytes + pdfBytes + otherBytes,
      originalCount: rows.length,
      entryCount,
      imageBytes,
      pdfBytes,
      otherBytes,
      thumbnailBytes
    }
  }

  /** Active entries of one asset, used when a canvas object asks to be shown in the library. */
  entriesForAsset(assetId: string): { id: string; folderId: string | null }[] {
    return this.db
      .select({ id: libraryEntries.id, folderId: libraryEntries.folderId })
      .from(libraryEntries)
      .where(and(eq(libraryEntries.assetId, assetId), isNull(libraryEntries.deletedAt)))
      .all()
  }

  private keepReason(assetId: string): string | null {
    const entry = this.db
      .select({ id: libraryEntries.id })
      .from(libraryEntries)
      .where(eq(libraryEntries.assetId, assetId))
      .get()
    if (entry) return 'Another library entry still uses it, including items in Trash.'
    const object = this.db
      .select({ id: boardObjects.id })
      .from(boardObjects)
      .where(eq(boardObjects.assetId, assetId))
      .get()
    if (object) return 'A board appearance still uses it, including items in Trash.'
    const slide = this.db
      .select({ id: stackSlides.id })
      .from(stackSlides)
      .where(eq(stackSlides.assetId, assetId))
      .get()
    if (slide) return 'An image stack still uses it.'
    const cover = this.db
      .select({ id: boards.id })
      .from(boards)
      .where(eq(boards.coverAssetId, assetId))
      .get()
    if (cover) return 'A board cover still uses it.'
    const preview = this.db
      .select({ id: assets.id })
      .from(assets)
      .where(eq(assets.previewAssetId, assetId))
      .get()
    if (preview) return 'It is the preview image of another file.'
    return null
  }

  private requireActive(id: string) {
    const row = this.db
      .select()
      .from(libraryEntries)
      .where(and(eq(libraryEntries.id, id), isNull(libraryEntries.deletedAt)))
      .get()
    if (!row) throw new Error('That library item is not available.')
    return row
  }

  private folderRows(includeTrashed: boolean): FolderRow[] {
    return this.db
      .select({ id: folders.id, name: folders.name, parentId: folders.parentId })
      .from(folders)
      .where(includeTrashed ? undefined : isNull(folders.deletedAt))
      .all()
  }

  private folderTree(id: string): { id: string; name: string; parentId: string | null }[] {
    const all = this.folderRows(false)
    const ids = [id, ...descendantIds(all, id)]
    return all.filter((row) => ids.includes(row.id))
  }

  private entriesIn(tree: { id: string }[]) {
    if (tree.length === 0) return []
    return this.db
      .select()
      .from(libraryEntries)
      .where(
        and(
          inArray(
            libraryEntries.folderId,
            tree.map((row) => row.id)
          ),
          isNull(libraryEntries.deletedAt)
        )
      )
      .all()
  }

  private boardsUsing(assetIds: string[]): number {
    if (assetIds.length === 0) return 0
    const rows = this.db
      .select({ boardId: boardObjects.boardId })
      .from(boardObjects)
      .where(and(inArray(boardObjects.assetId, assetIds), isNull(boardObjects.deletedAt)))
      .all()
    return new Set(rows.map((row) => row.boardId)).size
  }

  private siblingNames(parentId: string | null, exceptFolderId: string): string[] {
    const folderNames = this.db
      .select({ id: folders.id, name: folders.name })
      .from(folders)
      .where(
        and(
          parentId ? eq(folders.parentId, parentId) : isNull(folders.parentId),
          isNull(folders.deletedAt)
        )
      )
      .all()
      .filter((row) => row.id !== exceptFolderId)
      .map((row) => row.name)
    const entryNames = this.db
      .select({ name: libraryEntries.name, folderId: libraryEntries.folderId })
      .from(libraryEntries)
      .where(
        and(
          parentId ? eq(libraryEntries.folderId, parentId) : isNull(libraryEntries.folderId),
          isNull(libraryEntries.deletedAt)
        )
      )
      .all()
      .map((row) => row.name)
    return [...folderNames, ...entryNames]
  }

  private nameConflicts(
    movingFolders: { id: string; name: string }[],
    movingEntries: { name: string }[],
    parentId: string | null
  ): string[] {
    const taken = new Set(this.siblingNames(parentId, movingFolders[0]?.id ?? ''))
    const conflicts: string[] = []
    for (const folder of movingFolders.slice(1)) {
      if (taken.has(folder.name)) conflicts.push(folder.name)
    }
    for (const entry of movingEntries) {
      if (taken.has(entry.name)) conflicts.push(entry.name)
    }
    return [...new Set(conflicts)]
  }

  private toEntry(
    row: typeof libraryEntries.$inferSelect,
    asset: ReturnType<typeof toAssetInfo>,
    folderRows: FolderRow[]
  ): LibraryEntry {
    return {
      id: row.id,
      assetId: row.assetId,
      folderId: row.folderId,
      name: row.name,
      createdAt: row.createdAt.getTime(),
      folderPath: folderPath(folderRows, row.folderId),
      asset
    }
  }
}

function folderPath(rows: FolderRow[], folderId: string | null): string {
  if (!folderId) return ''
  const byId = new Map(rows.map((row) => [row.id, row]))
  const names: string[] = []
  let cursor: string | null = folderId
  const seen = new Set<string>()
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor)
    const folder = byId.get(cursor)
    if (!folder) break
    names.push(folder.name)
    cursor = folder.parentId
  }
  return names.reverse().join(' / ')
}

function descendantIds(rows: FolderRow[], id: string): string[] {
  const result: string[] = []
  const seen = new Set<string>([id])
  let frontier = [id]
  while (frontier.length) {
    const children = rows
      .filter((row) => row.parentId && frontier.includes(row.parentId) && !seen.has(row.id))
      .map((row) => row.id)
    for (const child of children) seen.add(child)
    result.push(...children)
    frontier = children
  }
  return result
}

function descendantsAt(
  rows: { id: string; parentId: string | null; deletedAt: Date | null }[],
  id: string,
  stamp: number
): string[] {
  const result: string[] = []
  const seen = new Set<string>([id])
  let frontier = [id]
  while (frontier.length) {
    const children = rows
      .filter(
        (row) =>
          row.parentId &&
          frontier.includes(row.parentId) &&
          !seen.has(row.id) &&
          row.deletedAt?.getTime() === stamp
      )
      .map((row) => row.id)
    for (const child of children) seen.add(child)
    result.push(...children)
    frontier = children
  }
  return result
}

function freshName(taken: Set<string>, name: string): string {
  if (!taken.has(name)) {
    taken.add(name)
    return name
  }
  let n = 2
  while (taken.has(`${name} (${n})`)) n++
  const next = `${name} (${n})`
  taken.add(next)
  return next
}
