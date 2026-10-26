import { eq, sql } from 'drizzle-orm'
import type { BoardAppearance, SearchFilter, SearchHit, SearchKind } from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects, boards, folders, libraryEntries } from '../db/schema'

export type { BoardAppearance, SearchFilter, SearchHit, SearchKind }

interface Row {
  kind: SearchKind
  sourceId: string
  assetId: string | null
  page: number | null
  title: string
  snippet: string
  mime: string | null
}

/**
 * Reads the rebuildable search index. Content triggers keep names and notes current.
 * PDF page rows are added by the indexer.
 */
export class SearchRepository {
  constructor(private readonly db: ProjectDb) {}

  search(text: string, filter: SearchFilter = 'all', phrase = false): SearchHit[] {
    const trimmed = text.trim()
    if (!trimmed) return []
    const rows = new Map<string, Row>()
    const fts = ftsQuery(trimmed, phrase)
    if (fts) this.collect(rows, this.matchText(fts))
    if (!phrase && trimmed.length >= 3) this.collect(rows, this.matchNames(trimmed))
    if (!phrase && trimmed.length < 3) this.collect(rows, this.matchLike(trimmed))
    const entryAssets = new Set(
      [...rows.values()]
        .filter((row) => row.kind === 'entry' && row.assetId)
        .map((row) => row.assetId)
    )
    const hits = [...rows.values()].filter((row) => {
      if (row.kind === 'asset' && row.assetId && entryAssets.has(row.assetId)) return false
      return matchesFilter(row, filter)
    })
    return hits.slice(0, 80).map((row) => ({
      kind: row.kind,
      sourceId: row.sourceId,
      assetId: row.assetId,
      page: row.page,
      title: row.title,
      snippet: row.snippet,
      location: this.location(row)
    }))
  }

  appearances(assetId: string): BoardAppearance[] {
    const rows = this.db
      .select({
        objectId: boardObjects.id,
        boardId: boards.id,
        boardTitle: boards.title,
        parentBoardId: boards.parentBoardId,
        x: boardObjects.x,
        y: boardObjects.y
      })
      .from(boardObjects)
      .innerJoin(boards, eq(boards.id, boardObjects.boardId))
      .where(
        sql`${boardObjects.assetId} = ${assetId} AND ${boardObjects.deletedAt} IS NULL AND ${boards.deletedAt} IS NULL`
      )
      .all()
    return rows.map((row) => ({
      objectId: row.objectId,
      boardId: row.boardId,
      boardTitle: row.boardTitle,
      path: this.boardPath(row.boardId),
      x: row.x,
      y: row.y
    }))
  }

  addPdfPage(assetId: string, page: number, text: string, title: string): void {
    const sourceId = `${assetId}:${page}`
    this.db.run(
      sql`DELETE FROM search_documents WHERE kind = 'pdf-page' AND source_id = ${sourceId}`
    )
    if (text.trim()) {
      this.db.run(sql`
        INSERT INTO search_documents (kind, source_id, asset_id, page, title, body)
        VALUES ('pdf-page', ${sourceId}, ${assetId}, ${page}, ${title}, ${text})
      `)
    }
    this.db.run(sql`
      UPDATE search_jobs SET pages_done = ${page}, state = 'running' WHERE asset_id = ${assetId}
    `)
  }

  finishPdf(assetId: string, state: 'done' | 'no-text' | 'locked' | 'failed', note?: string): void {
    this.db.run(sql`
      UPDATE search_jobs SET state = ${state}, note = ${note ?? null} WHERE asset_id = ${assetId}
    `)
  }

  nextPdfJob(): { assetId: string; pagesDone: number; bytes: number; name: string } | null {
    const row = this.db.get<{
      asset_id: string
      pages_done: number
      bytes: number
      original_name: string
    }>(sql`
      SELECT search_jobs.asset_id, search_jobs.pages_done, assets.bytes, assets.original_name
      FROM search_jobs JOIN assets ON assets.id = search_jobs.asset_id
      WHERE search_jobs.state IN ('pending', 'running')
      LIMIT 1
    `)
    if (!row) return null
    return {
      assetId: row.asset_id,
      pagesDone: row.pages_done,
      bytes: row.bytes,
      name: row.original_name
    }
  }

  /** Drops the index and fills it again from the project. PDF pages are queued. */
  rebuild(): void {
    this.db.run(sql`DELETE FROM search_documents`)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, title, body)
      SELECT 'board', id, title, title FROM boards WHERE deleted_at IS NULL
    `)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, title, body)
      SELECT 'note', id,
        COALESCE(NULLIF(substr(trim(json_extract(data, '$.plainText')), 1, 80), ''), 'Note'),
        COALESCE(json_extract(data, '$.plainText'), '')
      FROM board_objects WHERE type = 'text' AND deleted_at IS NULL
    `)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, asset_id, title, body)
      SELECT 'entry', library_entries.id, library_entries.asset_id, library_entries.name, assets.original_name
      FROM library_entries JOIN assets ON assets.id = library_entries.asset_id
      WHERE library_entries.deleted_at IS NULL
    `)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, title, body)
      SELECT 'folder', id, name, name FROM folders WHERE deleted_at IS NULL
    `)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, asset_id, title, body)
      SELECT 'asset', id, id, original_name, ext FROM assets
    `)
    this.db.run(sql`DELETE FROM search_jobs`)
    this.db.run(sql`
      INSERT INTO search_jobs (asset_id, state)
      SELECT id, 'pending' FROM assets WHERE mime = 'application/pdf'
    `)
  }

  private matchText(match: string): Row[] {
    try {
      return this.db.all<Row>(sql`
        SELECT d.kind AS kind, d.source_id AS sourceId, d.asset_id AS assetId, d.page AS page,
          d.title AS title, snippet(search_text, 1, '[', ']', '…', 12) AS snippet, a.mime AS mime
        FROM search_text
        JOIN search_documents d ON d.id = search_text.rowid
        LEFT JOIN assets a ON a.id = d.asset_id
        WHERE search_text MATCH ${match}
        ORDER BY bm25(search_text)
        LIMIT 80
      `)
    } catch {
      return []
    }
  }

  private matchNames(text: string): Row[] {
    const query = text.replace(/["*]/g, ' ').trim()
    if (query.length < 3) return []
    try {
      return this.db.all<Row>(sql`
        SELECT d.kind AS kind, d.source_id AS sourceId, d.asset_id AS assetId, d.page AS page,
          d.title AS title, d.title AS snippet, a.mime AS mime
        FROM search_names
        JOIN search_documents d ON d.id = search_names.rowid
        LEFT JOIN assets a ON a.id = d.asset_id
        WHERE search_names MATCH ${query}
        LIMIT 80
      `)
    } catch {
      return []
    }
  }

  private matchLike(text: string): Row[] {
    const needle = `%${text.replace(/[\\%_]/g, '')}%`
    return this.db.all<Row>(sql`
      SELECT d.kind AS kind, d.source_id AS sourceId, d.asset_id AS assetId, d.page AS page,
        d.title AS title, d.title AS snippet, a.mime AS mime
      FROM search_documents d
      LEFT JOIN assets a ON a.id = d.asset_id
      WHERE d.title LIKE ${needle}
      LIMIT 80
    `)
  }

  private collect(rows: Map<string, Row>, found: Row[]): void {
    for (const row of found) {
      const key = `${row.kind}:${row.sourceId}`
      if (!rows.has(key)) rows.set(key, row)
    }
  }

  private location(row: Row): string {
    if (row.kind === 'board') return this.boardPath(row.sourceId)
    if (row.kind === 'note') {
      const object = this.db
        .select({ boardId: boardObjects.boardId })
        .from(boardObjects)
        .where(eq(boardObjects.id, row.sourceId))
        .get()
      return object ? this.boardPath(object.boardId) : 'Note'
    }
    if (row.kind === 'folder') return this.folderPath(row.sourceId)
    if (row.kind === 'entry') {
      const entry = this.db
        .select({ folderId: libraryEntries.folderId })
        .from(libraryEntries)
        .where(eq(libraryEntries.id, row.sourceId))
        .get()
      return entry?.folderId ? this.folderPath(entry.folderId) : 'Library'
    }
    if (row.kind === 'pdf-page' && row.page) return `Page ${row.page}`
    return 'Library'
  }

  private boardPath(id: string): string {
    const titles: string[] = []
    let current: string | null = id
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      seen.add(current)
      const row: { title: string; parentBoardId: string | null } | undefined = this.db
        .select({ title: boards.title, parentBoardId: boards.parentBoardId })
        .from(boards)
        .where(eq(boards.id, current))
        .get()
      if (!row) break
      titles.push(row.title)
      current = row.parentBoardId
    }
    return titles.reverse().join(' / ')
  }

  private folderPath(id: string): string {
    const names: string[] = []
    let current: string | null = id
    const seen = new Set<string>()
    while (current && !seen.has(current)) {
      seen.add(current)
      const row: { name: string; parentId: string | null } | undefined = this.db
        .select({ name: folders.name, parentId: folders.parentId })
        .from(folders)
        .where(eq(folders.id, current))
        .get()
      if (!row) break
      names.push(row.name)
      current = row.parentId
    }
    return names.reverse().join(' / ')
  }
}

function ftsQuery(text: string, phrase: boolean): string {
  const cleaned = text.replace(/["*^():{}]/g, ' ').trim()
  if (!cleaned) return ''
  if (phrase) return `"${cleaned}"`
  return cleaned
    .split(/\s+/)
    .map((word) => `${word}*`)
    .join(' AND ')
}

function matchesFilter(row: Row, filter: SearchFilter): boolean {
  if (row.kind === 'asset' && row.assetId) {
    // An active library entry already represents this file.
  }
  if (filter === 'all') return true
  if (filter === 'board') return row.kind === 'board'
  if (filter === 'note') return row.kind === 'note'
  if (filter === 'folder') return row.kind === 'folder'
  if (filter === 'pdf') return row.kind === 'pdf-page' || row.mime === 'application/pdf'
  if (filter === 'image') return !!row.mime?.startsWith('image/')
  if (filter === 'file') {
    return (
      (row.kind === 'entry' || row.kind === 'asset') &&
      !!row.mime &&
      !row.mime.startsWith('image/') &&
      row.mime !== 'application/pdf'
    )
  }
  return false
}
