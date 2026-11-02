import { eq, sql, type SQL } from 'drizzle-orm'
import type {
  BoardAppearance,
  SearchFilter,
  SearchHit,
  SearchKind,
  SearchPage,
  SearchRequest
} from '@shared/types'
import type { ProjectDb } from '../db/client'
import { boardObjects, boards, folders } from '../db/schema'

export type { BoardAppearance, SearchFilter, SearchHit, SearchKind }

interface HitRow {
  kind: SearchKind
  source_id: string
  asset_id: string | null
  page: number | null
  title: string
  mime: string | null
  entry_id: string | null
  object_id: string | null
  board_id: string | null
  folder_id: string | null
  target_type: string
  target_id: string
  inherits_asset: number
  doc_id: number | null
}

interface Cursor {
  title: string
  kind: string
  sourceId: string
  page: number
  objectId: string
  entryId: string
}

/**
 * Reads the rebuildable search index. Content triggers keep names and notes current.
 * PDF page rows are added by the indexer.
 */
export class SearchRepository {
  constructor(private readonly db: ProjectDb) {}

  search(text: string, filter: SearchFilter = 'all', phrase = false): SearchHit[] {
    return this.searchPage({ text, filter, phrase, limit: 100 }).hits
  }

  /**
   * Text matches and tag matches are filtered in SQL, then paginated.
   * A PDF page is returned only for a text match, and only for the asset, entry, or
   * appearance whose own tags satisfied the predicate. Tag-only search returns those
   * items themselves, not one hit per page.
   */
  searchPage(request: SearchRequest): SearchPage {
    const text = request.text?.trim() ?? ''
    const included = request.tags?.included ?? []
    const excluded = request.tags?.excluded ?? []
    const hasTags = included.length > 0 || excluded.length > 0
    if (!text && !hasTags) return { hits: [], nextCursor: null }
    const limit = Math.min(100, Math.max(1, request.limit ?? 50))
    const tagMatch = request.tagMatch === 'direct' ? 'direct' : 'effective'
    const mode = request.tags?.mode === 'any' ? 'any' : 'all'
    const filter = request.filter ?? 'all'
    const scope = request.scope ?? { type: 'project' as const }
    const cursor = decodeCursor(request.cursor)
    const textParts = textHitParts(text, !!request.phrase)
    if (text && textParts.length === 0) return { hits: [], nextCursor: null }

    const tagSql = tagPredicate(included, excluded, mode, tagMatch, hasTags)
    const rows = this.db.all<HitRow>(sql`
      WITH RECURSIVE
      board_tree AS (
        SELECT id FROM boards WHERE id = ${scope.type === 'board' ? scope.id : ''}
        UNION ALL
        SELECT b.id FROM boards b
        JOIN board_tree t ON b.parent_board_id = t.id
        WHERE b.deleted_at IS NULL
      ),
      folder_tree AS (
        SELECT id FROM folders WHERE id = ${scope.type === 'folder' ? scope.id : ''}
        UNION ALL
        SELECT f.id FROM folders f
        JOIN folder_tree t ON f.parent_id = t.id
        WHERE f.deleted_at IS NULL
      ),
      subjects AS (
        SELECT 'asset' AS kind, a.id AS source_id, a.id AS asset_id, NULL AS page,
          a.original_name AS title, a.mime AS mime, NULL AS entry_id, NULL AS object_id,
          NULL AS board_id, NULL AS folder_id, 'asset' AS target_type, a.id AS target_id,
          0 AS inherits_asset, NULL AS doc_id
        FROM assets a WHERE a.deleted_at IS NULL
        UNION ALL
        SELECT 'entry', e.id, e.asset_id, NULL, e.name, a.mime, e.id, NULL, NULL, e.folder_id,
          'entry', e.id, 1, NULL
        FROM library_entries e JOIN assets a ON a.id = e.asset_id
        WHERE e.deleted_at IS NULL
        UNION ALL
        SELECT           CASE
            WHEN o.type = 'text' THEN 'note'
            WHEN o.type = 'stack' THEN 'stack'
            WHEN o.type IN ('connection', 'link', 'comment') THEN o.type
            ELSE 'object'
          END,
          o.id, o.asset_id, NULL,
          CASE
            WHEN o.type = 'text' THEN COALESCE(
              (SELECT d.title FROM search_documents d WHERE d.kind = 'note' AND d.source_id = o.id),
              'Note')
            WHEN o.type = 'stack' THEN COALESCE(NULLIF(json_extract(o.data, '$.name'), ''), 'Stack')
            WHEN o.type = 'board' THEN COALESCE(lb.title, 'Board card')
            WHEN o.type = 'connection' THEN COALESCE(NULLIF(json_extract(o.data, '$.label.text'), ''), 'Connection')
            WHEN o.type = 'link' THEN COALESCE(NULLIF(json_extract(o.data, '$.title'), ''), 'Link')
            WHEN o.type = 'comment' THEN 'Comment'
            ELSE COALESCE(a.original_name, 'File')
          END,
          a.mime, NULL, o.id, o.board_id, NULL, 'object', o.id,
          CASE WHEN o.asset_id IS NOT NULL AND o.type IN ('image', 'document', 'file') THEN 1 ELSE 0 END,
          NULL
        FROM board_objects o
        JOIN boards b ON b.id = o.board_id AND b.deleted_at IS NULL
        LEFT JOIN assets a ON a.id = o.asset_id
        LEFT JOIN boards lb ON lb.id = o.linked_board_id
        WHERE o.deleted_at IS NULL AND o.type IN ('image', 'document', 'file', 'text', 'board', 'stack', 'connection', 'link', 'comment')
        UNION ALL
        SELECT 'slide', sl.id, sl.asset_id, NULL, a.original_name, a.mime, NULL, o.id, o.board_id,
          NULL, 'slide', sl.id, 1, NULL
        FROM stack_slides sl
        JOIN board_objects o ON o.id = sl.stack_id AND o.deleted_at IS NULL AND o.type = 'stack'
        JOIN boards b ON b.id = o.board_id AND b.deleted_at IS NULL
        JOIN assets a ON a.id = sl.asset_id AND a.deleted_at IS NULL
        UNION ALL
        SELECT 'board', b.id, NULL, NULL, b.title, NULL, NULL, NULL, b.id, NULL, 'board', b.id, 0, NULL
        FROM boards b WHERE b.deleted_at IS NULL
        UNION ALL
        SELECT 'folder', f.id, NULL, NULL, f.name, NULL, NULL, NULL, NULL, f.id, 'folder', f.id, 0, NULL
        FROM folders f WHERE f.deleted_at IS NULL
      )
      ${textParts.length ? sql`, text_hits AS (${sql.join(textParts, sql` UNION `)})` : sql``}
      SELECT DISTINCT kind, source_id, asset_id, page, title, mime, entry_id, object_id, board_id,
        folder_id, target_type, target_id, inherits_asset, doc_id
      FROM (
        ${
          textParts.length
            ? sql`
              SELECT s.kind, s.source_id, s.asset_id, NULL AS page, s.title, s.mime, s.entry_id,
                s.object_id, s.board_id, s.folder_id, s.target_type, s.target_id, s.inherits_asset, t.doc_id
              FROM text_hits t
              JOIN subjects s ON s.kind = t.kind AND s.source_id = t.source_id
              WHERE t.kind != 'pdf-page'
              UNION ALL
              SELECT s.kind, s.source_id, s.asset_id, NULL, s.title, s.mime, s.entry_id,
                s.object_id, s.board_id, s.folder_id, s.target_type, s.target_id, s.inherits_asset, t.doc_id
              FROM text_hits t
              JOIN subjects s ON s.kind = 'slide' AND s.asset_id = t.asset_id
              WHERE t.kind = 'asset'
              UNION ALL
              SELECT s.kind, s.source_id, s.asset_id, NULL, s.title, s.mime, s.entry_id,
                s.object_id, s.board_id, s.folder_id, s.target_type, s.target_id, s.inherits_asset, NULL
              FROM subjects s
              WHERE s.kind = 'stack' AND lower(s.title) LIKE ${'%' + text.toLowerCase().replace(/[\\%_]/g, '') + '%'}
              UNION ALL
              SELECT 'pdf-page', t.source_id, t.asset_id, t.page, t.title, a.mime,
                ${
                  hasTags
                    ? sql`s.entry_id, s.object_id, s.board_id, s.folder_id, s.target_type, s.target_id, s.inherits_asset`
                    : sql`NULL, NULL, NULL, NULL, 'asset', t.asset_id, 0`
                },
                t.doc_id
              FROM text_hits t
              JOIN assets a ON a.id = t.asset_id AND a.deleted_at IS NULL
              ${
                hasTags
                  ? sql`JOIN subjects s ON s.asset_id = t.asset_id AND s.kind IN ('asset', 'entry', 'object')
                      AND NOT (s.kind = 'object' AND s.inherits_asset = 0)`
                  : sql``
              }
              WHERE t.kind = 'pdf-page'
            `
            : sql`
              SELECT kind, source_id, asset_id, page, title, mime, entry_id, object_id, board_id,
                folder_id, target_type, target_id, inherits_asset, doc_id
              FROM subjects
            `
        }
      ) s
      WHERE ${tagSql}
        AND ${filterSql(filter)}
        AND ${scope.type === 'project' ? sql`1` : scope.type === 'board' ? sql`(s.board_id IN (SELECT id FROM board_tree) OR (s.kind = 'board' AND s.source_id IN (SELECT id FROM board_tree)))` : sql`s.folder_id IN (SELECT id FROM folder_tree)`}
        AND ${hasTags ? sql`s.kind != 'folder'` : sql`1`}
        AND ${
          hasTags
            ? sql`1`
            : sql`NOT (s.kind = 'asset' AND EXISTS (
                SELECT 1 FROM library_entries e WHERE e.asset_id = s.source_id AND e.deleted_at IS NULL
              ))`
        }
        AND ${
          cursor
            ? sql`(s.title, s.kind, s.source_id, ifnull(s.page, -1), ifnull(s.object_id, ''), ifnull(s.entry_id, ''))
                > (${cursor.title}, ${cursor.kind}, ${cursor.sourceId}, ${cursor.page}, ${cursor.objectId}, ${cursor.entryId})`
            : sql`1`
        }
      ORDER BY s.title, s.kind, s.source_id, ifnull(s.page, -1), ifnull(s.object_id, ''), ifnull(s.entry_id, '')
      LIMIT ${limit + 1}
    `)
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    return {
      hits: this.attachStackTitles(pageRows.map((row) => this.toHit(row, included))),
      nextCursor: rows.length > limit && last ? encodeCursor(last) : null
    }
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
    const slides = this.db.all<{
      objectId: string
      boardId: string
      boardTitle: string
      x: number
      y: number
      slideId: string
    }>(sql`
      SELECT o.id AS objectId, b.id AS boardId, b.title AS boardTitle, o.x AS x, o.y AS y, sl.id AS slideId
      FROM stack_slides sl
      JOIN board_objects o ON o.id = sl.stack_id AND o.deleted_at IS NULL
      JOIN boards b ON b.id = o.board_id AND b.deleted_at IS NULL
      WHERE sl.asset_id = ${assetId}
    `)
    return [
      ...rows.map((row) => ({
        objectId: row.objectId,
        boardId: row.boardId,
        boardTitle: row.boardTitle,
        path: this.boardPath(row.boardId),
        x: row.x,
        y: row.y
      })),
      ...slides.map((row) => ({
        objectId: row.objectId,
        boardId: row.boardId,
        boardTitle: row.boardTitle,
        path: this.boardPath(row.boardId),
        x: row.x,
        y: row.y,
        slideId: row.slideId
      }))
    ]
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
      INSERT INTO search_documents (kind, source_id, title, body)
      SELECT 'connection', id,
        COALESCE(NULLIF(substr(trim(json_extract(data, '$.label.text')), 1, 80), ''), 'Connection'),
        COALESCE(json_extract(data, '$.label.text'), '')
      FROM board_objects WHERE type = 'connection' AND deleted_at IS NULL
    `)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, title, body)
      SELECT 'link', id,
        COALESCE(NULLIF(substr(trim(json_extract(data, '$.title')), 1, 80), ''), 'Link'),
        trim(COALESCE(json_extract(data, '$.title'), '') || ' ' || COALESCE(json_extract(data, '$.description'), ''))
      FROM board_objects WHERE type = 'link' AND deleted_at IS NULL
    `)
    this.db.run(sql`
      INSERT INTO search_documents (kind, source_id, title, body)
      SELECT 'comment', o.id, 'Comment',
        COALESCE((SELECT group_concat(m.body, ' ') FROM comment_messages m WHERE m.comment_id = o.id AND m.deleted_at IS NULL), '')
      FROM board_objects o WHERE o.type = 'comment' AND o.deleted_at IS NULL
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

  /** Slide hits carry the parent stack's name so a group header can open that stack. */
  private attachStackTitles(hits: SearchHit[]): SearchHit[] {
    const ids = [
      ...new Set(hits.flatMap((hit) => (hit.kind === 'slide' && hit.stackId ? [hit.stackId] : [])))
    ]
    if (ids.length === 0) return hits
    const rows = this.db.all<{ id: string; name: string | null }>(sql`
      SELECT id, json_extract(data, '$.name') AS name
      FROM board_objects
      WHERE id IN (${sql.join(
        ids.map((id) => sql`${id}`),
        sql`, `
      )})
    `)
    const names = new Map(rows.map((row) => [row.id, stackTitleOf(row.name)]))
    return hits.map((hit) =>
      hit.kind === 'slide' && hit.stackId
        ? { ...hit, stackTitle: names.get(hit.stackId) ?? 'Stack' }
        : hit
    )
  }

  private toHit(row: HitRow, included: string[]): SearchHit {
    return {
      kind: row.kind,
      sourceId: row.source_id,
      assetId: row.asset_id,
      page: row.page,
      title: row.title,
      snippet: this.snippet(row),
      location: this.location(row),
      entryId: row.entry_id,
      objectId: row.object_id,
      boardId: row.board_id,
      matchedTags: this.matchedTags(row, included),
      stackId:
        row.kind === 'slide' || row.kind === 'stack' ? (row.object_id ?? row.source_id) : null,
      slideId: row.kind === 'slide' ? row.source_id : null
    }
  }

  private snippet(row: HitRow): string {
    if (row.doc_id == null) return ''
    try {
      const found = this.db.get<{ snippet: string }>(sql`
        SELECT snippet(search_text, 1, '[', ']', '…', 12) AS snippet
        FROM search_text WHERE rowid = ${row.doc_id}
      `)
      return found?.snippet ?? ''
    } catch {
      return ''
    }
  }

  private matchedTags(
    row: HitRow,
    included: string[]
  ): { id: string; name: string; source: 'direct' | 'asset' | 'stack' }[] {
    if (included.length === 0) return []
    const ids = sql.join(
      included.map((id) => sql`${id}`),
      sql`, `
    )
    const direct = this.db.all<{ id: string; name: string }>(sql`
      SELECT t.id, t.name FROM tags t
      WHERE t.deleted_at IS NULL AND t.id IN (${ids}) AND (
        EXISTS (
          SELECT 1 FROM taggings g
          WHERE g.tag_id = t.id AND g.target_type = ${row.target_type} AND g.target_id = ${row.target_id}
        )
        OR (t.reusable = 0 AND t.owner_type = ${row.target_type} AND t.owner_id = ${row.target_id})
      )
    `)
    const inherited =
      row.inherits_asset && row.asset_id
        ? this.db.all<{ id: string; name: string }>(sql`
            SELECT t.id, t.name FROM tags t
            WHERE t.deleted_at IS NULL AND t.id IN (${ids}) AND (
              EXISTS (
                SELECT 1 FROM taggings g
                WHERE g.tag_id = t.id AND g.target_type = 'asset' AND g.target_id = ${row.asset_id}
              )
              OR (t.reusable = 0 AND t.owner_type = 'asset' AND t.owner_id = ${row.asset_id})
            )
          `)
        : []
    const contextual =
      row.kind === 'slide' && row.object_id
        ? this.db.all<{ id: string; name: string }>(sql`
            SELECT t.id, t.name FROM tags t
            WHERE t.deleted_at IS NULL AND t.id IN (${ids}) AND (
              EXISTS (
                SELECT 1 FROM taggings g
                WHERE g.tag_id = t.id AND g.target_type = 'object' AND g.target_id = ${row.object_id}
              )
              OR (t.reusable = 0 AND t.owner_type = 'object' AND t.owner_id = ${row.object_id})
            )
          `)
        : []
    const seen = new Set([...direct, ...inherited].map((tag) => tag.id))
    return [
      ...direct.map((tag) => ({ ...tag, source: 'direct' as const })),
      ...inherited
        .filter((tag) => !seen.has(tag.id))
        .map((tag) => ({ ...tag, source: 'asset' as const })),
      ...contextual
        .filter((tag) => !seen.has(tag.id))
        .map((tag) => {
          seen.add(tag.id)
          return { ...tag, source: 'stack' as const }
        })
    ]
  }

  private location(row: HitRow): string {
    if (row.kind === 'board') return this.boardPath(row.source_id)
    if (
      row.kind === 'note' ||
      row.kind === 'object' ||
      row.kind === 'stack' ||
      row.kind === 'slide' ||
      row.kind === 'connection' ||
      row.kind === 'link' ||
      row.kind === 'comment'
    ) {
      return row.board_id ? this.boardPath(row.board_id) : 'Board'
    }
    if (row.kind === 'folder') return this.folderPath(row.source_id)
    if (row.kind === 'entry') return row.folder_id ? this.folderPath(row.folder_id) : 'Library'
    if (row.kind === 'pdf-page' && row.page) {
      const place = row.board_id
        ? this.boardPath(row.board_id)
        : row.folder_id
          ? this.folderPath(row.folder_id)
          : ''
      return place ? `${place} · Page ${row.page}` : `Page ${row.page}`
    }
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

function textHitParts(text: string, phrase: boolean): SQL[] {
  if (!text) return []
  const parts: SQL[] = []
  const fts = ftsQuery(text, phrase)
  if (fts) {
    parts.push(sql`
      SELECT d.kind AS kind, d.source_id AS source_id, d.asset_id AS asset_id, d.page AS page,
        d.title AS title, d.id AS doc_id
      FROM search_text JOIN search_documents d ON d.id = search_text.rowid
      WHERE search_text MATCH ${fts}
    `)
  }
  if (!phrase && text.length >= 3) {
    const query = text.replace(/["*]/g, ' ').trim()
    if (query) {
      parts.push(sql`
        SELECT d.kind, d.source_id, d.asset_id, d.page, d.title, d.id
        FROM search_names JOIN search_documents d ON d.id = search_names.rowid
        WHERE search_names MATCH ${query}
      `)
    }
  }
  if (!phrase && text.length < 3) {
    const needle = `%${text.replace(/[\\%_]/g, '')}%`
    parts.push(sql`
      SELECT d.kind, d.source_id, d.asset_id, d.page, d.title, d.id
      FROM search_documents d WHERE d.title LIKE ${needle}
    `)
  }
  return parts
}

function tagOnSubject(tagId: string, tagMatch: 'effective' | 'direct'): SQL {
  return sql`(
    EXISTS (
      SELECT 1 FROM taggings g
      JOIN tags tg ON tg.id = g.tag_id AND tg.deleted_at IS NULL
      WHERE g.tag_id = ${tagId} AND g.target_type = s.target_type AND g.target_id = s.target_id
    )
    OR EXISTS (
      SELECT 1 FROM tags tg
      WHERE tg.id = ${tagId} AND tg.deleted_at IS NULL AND tg.reusable = 0
        AND tg.owner_type = s.target_type AND tg.owner_id = s.target_id
    )
    OR (
      ${tagMatch} = 'effective' AND s.inherits_asset = 1 AND (
        EXISTS (
          SELECT 1 FROM taggings g
          JOIN tags tg ON tg.id = g.tag_id AND tg.deleted_at IS NULL
          WHERE g.tag_id = ${tagId} AND g.target_type = 'asset' AND g.target_id = s.asset_id
        )
        OR EXISTS (
          SELECT 1 FROM tags tg
          WHERE tg.id = ${tagId} AND tg.deleted_at IS NULL AND tg.reusable = 0
            AND tg.owner_type = 'asset' AND tg.owner_id = s.asset_id
        )
      )
    )
    OR (
      ${tagMatch} = 'effective' AND s.kind = 'slide' AND s.object_id IS NOT NULL AND (
        EXISTS (
          SELECT 1 FROM taggings g
          JOIN tags tg ON tg.id = g.tag_id AND tg.deleted_at IS NULL
          WHERE g.tag_id = ${tagId} AND g.target_type = 'object' AND g.target_id = s.object_id
        )
        OR EXISTS (
          SELECT 1 FROM tags tg
          WHERE tg.id = ${tagId} AND tg.deleted_at IS NULL AND tg.reusable = 0
            AND tg.owner_type = 'object' AND tg.owner_id = s.object_id
        )
      )
    )
  )`
}

function tagPredicate(
  included: string[],
  excluded: string[],
  mode: 'all' | 'any',
  tagMatch: 'effective' | 'direct',
  hasTags: boolean
): SQL {
  if (!hasTags) return sql`1`
  const include =
    included.length === 0
      ? sql`1`
      : mode === 'any'
        ? sql`(${sql.join(
            included.map((id) => tagOnSubject(id, tagMatch)),
            sql` OR `
          )})`
        : sql`(${sql.join(
            included.map((id) => tagOnSubject(id, tagMatch)),
            sql` AND `
          )})`
  const exclude =
    excluded.length === 0
      ? sql`1`
      : sql`(${sql.join(
          excluded.map((id) => sql`NOT ${tagOnSubject(id, tagMatch)}`),
          sql` AND `
        )})`
  return sql`${include} AND ${exclude}`
}

function filterSql(filter: SearchFilter): SQL {
  if (filter === 'board') return sql`s.kind = 'board'`
  if (filter === 'note') return sql`s.kind = 'note'`
  if (filter === 'folder') return sql`s.kind = 'folder'`
  if (filter === 'connection' || filter === 'link' || filter === 'comment')
    return sql`s.kind = ${filter}`
  if (filter === 'pdf') return sql`(s.kind = 'pdf-page' OR s.mime = 'application/pdf')`
  if (filter === 'image') return sql`(s.mime LIKE 'image/%' OR s.kind = 'stack')`
  if (filter === 'file') {
    return sql`s.kind IN ('entry', 'asset', 'object') AND s.mime IS NOT NULL AND s.mime NOT LIKE 'image/%' AND s.mime != 'application/pdf'`
  }
  return sql`1`
}

function stackTitleOf(value: string | null): string {
  const name = value?.trim() ?? ''
  return name ? name.slice(0, 80) : 'Stack'
}

function encodeCursor(row: HitRow): string {
  return JSON.stringify({
    title: row.title,
    kind: row.kind,
    sourceId: row.source_id,
    page: row.page ?? -1,
    objectId: row.object_id ?? '',
    entryId: row.entry_id ?? ''
  } satisfies Cursor)
}

function decodeCursor(value: string | null | undefined): Cursor | null {
  if (!value) return null
  try {
    const parsed = JSON.parse(value) as Cursor
    if (typeof parsed.title !== 'string' || typeof parsed.sourceId !== 'string') return null
    return parsed
  } catch {
    return null
  }
}
