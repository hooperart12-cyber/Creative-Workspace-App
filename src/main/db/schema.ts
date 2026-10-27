/**
 * Project database schema (one SQLite file per project, see docs/DECISIONS.md ADR-004).
 *
 * Cloud-ready rules: UUID text primary keys, created_at/updated_at on every row,
 * soft delete via deleted_at. Never use auto-increment ids.
 * After editing this file run `npm run db:generate` to create a migration.
 */
import { sql } from 'drizzle-orm'
import {
  type AnySQLiteColumn,
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .notNull()
    .default(sql`(cast(unixepoch('subsec') * 1000 as integer))`)
}

const softDelete = {
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' })
}

/** Single-row table describing the project itself. */
export const projectMeta = sqliteTable('project_meta', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  mainBoardId: text('main_board_id').notNull(),
  ...timestamps
})

/** Library folders (§8). Exist only in the database; moving assets never touches files. */
export const folders = sqliteTable(
  'folders',
  {
    id: text('id').primaryKey(),
    parentId: text('parent_id').references((): AnySQLiteColumn => folders.id),
    name: text('name').notNull(),
    sortOrder: real('sort_order').notNull().default(0),
    ...timestamps,
    ...softDelete
  },
  (t) => [index('folders_parent_idx').on(t.parentId)]
)

/** Imported files (§7, §8). Originals live at assets/<sha[0..2]>/<sha>.<ext> and are never modified. */
export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    sha256: text('sha256').notNull(),
    originalName: text('original_name').notNull(),
    mime: text('mime').notNull(),
    ext: text('ext').notNull(),
    bytes: integer('bytes').notNull(),
    width: integer('width'),
    height: integer('height'),
    hasAlpha: integer('has_alpha', { mode: 'boolean' }),
    /** Set for PDFs once the file can be read. Null for other files and locked PDFs. */
    pageCount: integer('page_count'),
    /** Manually attached preview for formats the app cannot render (§7). Shared by every entry. */
    previewAssetId: text('preview_asset_id').references((): AnySQLiteColumn => assets.id),
    ...timestamps,
    ...softDelete
  },
  (t) => [uniqueIndex('assets_sha256_idx').on(t.sha256)]
)

/**
 * A named place for a stored original (ADR-016). Several entries can share one asset.
 * Trashing an entry does not hide board appearances of that asset.
 */
export const libraryEntries = sqliteTable(
  'library_entries',
  {
    id: text('id').primaryKey(),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id),
    folderId: text('folder_id').references(() => folders.id),
    name: text('name').notNull(),
    ...timestamps,
    ...softDelete
  },
  (t) => [
    index('library_entries_folder_idx').on(t.folderId),
    index('library_entries_asset_idx').on(t.assetId),
    index('library_entries_deleted_idx').on(t.deletedAt),
    index('library_entries_name_idx').on(t.name)
  ]
)

/** Boards (§3). Nested via parent_board_id; the main board has no parent. */
export const boards = sqliteTable(
  'boards',
  {
    id: text('id').primaryKey(),
    parentBoardId: text('parent_board_id').references((): AnySQLiteColumn => boards.id),
    title: text('title').notNull(),
    coverAssetId: text('cover_asset_id').references(() => assets.id),
    /** Last viewport, restored when the board is reopened. */
    viewportX: real('viewport_x').notNull().default(0),
    viewportY: real('viewport_y').notNull().default(0),
    viewportZoom: real('viewport_zoom').notNull().default(1),
    /** Canvas tag pills: hidden, shown for the item under the pointer or selected, or always on. */
    tagVisibility: text('tag_visibility').notNull().default('hover'),
    ...timestamps,
    ...softDelete
  },
  (t) => [index('boards_parent_idx').on(t.parentBoardId)]
)

/** Everything placed on a board canvas (§4, §5). Type-specific fields go in `data` (JSON). */
export const boardObjects = sqliteTable(
  'board_objects',
  {
    id: text('id').primaryKey(),
    boardId: text('board_id')
      .notNull()
      .references(() => boards.id),
    /** 'image' | 'text' | 'board' | 'document' | 'file' | … */
    type: text('type').notNull(),
    x: real('x').notNull().default(0),
    y: real('y').notNull().default(0),
    width: real('width').notNull().default(100),
    height: real('height').notNull().default(100),
    rotation: real('rotation').notNull().default(0),
    /** Fractional ordering so reordering touches one row. */
    zIndex: real('z_index').notNull().default(0),
    locked: integer('locked', { mode: 'boolean' }).notNull().default(false),
    groupId: text('group_id'),
    assetId: text('asset_id').references(() => assets.id),
    linkedBoardId: text('linked_board_id').references(() => boards.id),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull().default({}),
    /**
     * Counts saves of the object's content (note text). A save names the revision it was based
     * on and is refused if another window saved in between, so edits never silently overwrite.
     */
    revision: integer('revision').notNull().default(0),
    ...timestamps,
    ...softDelete
  },
  (t) => [
    index('board_objects_board_idx').on(t.boardId),
    index('board_objects_asset_idx').on(t.assetId),
    index('board_objects_linked_board_idx').on(t.linkedBoardId)
  ]
)

/** One image inside a stack (§9). Crop and layout belong to this appearance, not the asset. */
export const stackSlides = sqliteTable(
  'stack_slides',
  {
    id: text('id').primaryKey(),
    stackId: text('stack_id')
      .notNull()
      .references(() => boardObjects.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id),
    position: real('position').notNull().default(0),
    cropX: integer('crop_x'),
    cropY: integer('crop_y'),
    cropW: integer('crop_w'),
    cropH: integer('crop_h'),
    layoutX: real('layout_x'),
    layoutY: real('layout_y'),
    layoutWidth: real('layout_width'),
    layoutHeight: real('layout_height'),
    layoutRotation: real('layout_rotation'),
    layoutCropX: integer('layout_crop_x'),
    layoutCropY: integer('layout_crop_y'),
    layoutCropW: integer('layout_crop_w'),
    layoutCropH: integer('layout_crop_h'),
    sourceObjectId: text('source_object_id'),
    ...timestamps
  },
  (t) => [
    index('stack_slides_stack_idx').on(t.stackId, t.position),
    index('stack_slides_asset_idx').on(t.assetId)
  ]
)

/**
 * Tag library (§12). Partial unique indexes live in `0005_tags.sql` because Drizzle cannot
 * express them. `reusable = false` is a one-off owned by exactly one item.
 */
export const tags = sqliteTable('tags', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  normalizedName: text('normalized_name').notNull(),
  color: text('color'),
  reusable: integer('reusable', { mode: 'boolean' }).notNull().default(true),
  ownerType: text('owner_type'),
  ownerId: text('owner_id'),
  archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
  ...timestamps,
  ...softDelete
})

/** One reusable tag on one asset, library entry, canvas object (including a board card), or board. */
export const taggings = sqliteTable(
  'taggings',
  {
    id: text('id').primaryKey(),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
    targetType: text('target_type').notNull(),
    targetId: text('target_id').notNull(),
    createdAt: timestamps.createdAt
  },
  (t) => [index('taggings_target_idx').on(t.targetType, t.targetId)]
)
