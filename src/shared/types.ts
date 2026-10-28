import type { ImageCrop } from './crop'
import type { NoteAppearance, NoteContent, NoteSizing } from './notes'
import type { StackSettings } from './stacks'

/** Summary of an open project, as seen by the renderer. */
export interface ProjectSummary {
  id: string
  name: string
  /** Absolute path of the `.cwproj` folder. */
  path: string
  mainBoardId: string
  boardCount: number
  assetCount: number
  createdAt: number
  updatedAt: number
}

export interface RecentProject {
  name: string
  path: string
  lastOpenedAt: number
}

export interface CreateProjectInput {
  /** Directory the `.cwproj` folder is created in. */
  parentDir: string
  name: string
}

/** A board in the project's board hierarchy (flat list; the renderer builds the tree). */
export interface BoardListItem {
  id: string
  title: string
  parentBoardId: string | null
}

/** A library folder (flat list; the renderer builds the tree). */
export interface FolderListItem {
  id: string
  name: string
  parentId: string | null
}

export interface ProjectTree {
  mainBoardId: string
  boards: BoardListItem[]
  folders: FolderListItem[]
}

export interface Point {
  x: number
  y: number
}

/** A board's camera: screen = world * zoom + (x, y). */
export interface Viewport {
  x: number
  y: number
  zoom: number
}

/** A file in the project library (§8). The original is stored unmodified (ADR-005). */
export interface AssetInfo {
  id: string
  sha256: string
  originalName: string
  mime: string
  /** Extension of the stored original, without the dot. */
  ext: string
  bytes: number
  /** Pixel size as displayed (EXIF orientation applied); null for files that aren't images. */
  width: number | null
  height: number | null
  hasAlpha: boolean | null
  /** PDF page count. Null for other files, and for a PDF until its password is entered. */
  pageCount: number | null
  /** Image asset used as a generic file's preview. Shared by every card and library entry. */
  previewAssetId: string | null
  /** The preview image, when one is attached and still in the library. */
  preview: { sha256: string; width: number; height: number } | null
}

/** Which stored file of an asset to load: a generated thumbnail (longest side in px) or the original. */
export type AssetVariant = 256 | 1024 | 'original'

/** A file handed over as bytes (pasted screenshots, images dragged from a browser). */
export interface ImportBytesInput {
  name: string
  bytes: Uint8Array
}

export interface ImportResult {
  imported: AssetInfo[]
  /** Files that weren't imported, with a reason the user can read. */
  skipped: { name: string; reason: string }[]
  /** Large files that were still imported. */
  warnings: { name: string; message: string }[]
  /** Library entries created for this import. */
  entryIds: string[]
}

export type LibraryScope = 'folder' | 'project'
export type LibrarySort = 'name' | 'imported' | 'size' | 'type'
export type LibraryTypeFilter = 'all' | 'image' | 'pdf' | 'other'
export type DuplicatePolicy = 'skip' | 'entry'

/** One named library row. `asset` is the stored original it points at. */
export interface LibraryEntry {
  id: string
  assetId: string
  folderId: string | null
  name: string
  createdAt: number
  /** Folder names from the library root, empty at the top level. */
  folderPath: string
  asset: AssetInfo
}

export interface LibraryQuery {
  folderId: string | null
  /** `folder` is the current folder and its subfolders. At the root that is the whole library. */
  scope: LibraryScope
  /** When true, only entries directly inside `folderId` (the sidebar). */
  direct?: boolean
  /** Only entries that are not in a folder. */
  unfiled?: boolean
  query?: string
  type?: LibraryTypeFilter
  sort?: LibrarySort
  direction?: 'asc' | 'desc'
  offset?: number
  limit?: number
}

export interface LibraryPage {
  entries: LibraryEntry[]
  total: number
  /** Every matching id, in sort order, so Select all covers more than the visible page. */
  ids: string[]
  /** Stored original for each id, in the same order. */
  assetIds: string[]
}

export interface LibraryDetails {
  entry: LibraryEntry
  /** Other entries that share this original, including this one. */
  sameOriginal: { id: string; name: string; folderPath: string }[]
  appearances: { objectId: string; boardId: string; boardTitle: string }[]
  /** Tags on this entry plus tags on its original. */
  tags?: TagPill[]
}

export interface StorageReport {
  originalBytes: number
  originalCount: number
  entryCount: number
  imageBytes: number
  pdfBytes: number
  otherBytes: number
  thumbnailBytes: number
}

export interface FolderDeletePreview {
  entries: number
  folders: number
  boardCount: number
  conflicts: string[]
}

export interface ImportProgress {
  found: number
  processed: number
  imported: number
  skipped: number
  failed: number
  bytes: number
}

export type TrashKind = 'entry' | 'folder' | 'object'

export interface TrashItem {
  kind: TrashKind
  id: string
  name: string
  deletedAt: number
  location: string
  assetId: string | null
  boardId: string | null
}

export interface PurgeResult {
  filesDeleted: number
  filesKept: { name: string; reason: string }[]
  /** Originals the database no longer points at, but the disk delete failed. */
  unlinkErrors: string[]
}

export interface CreateImagesInput {
  boardId: string
  assetIds: string[]
  /** World point the images are centred on. */
  center: Point
  /** Shift right until the images don't cover existing objects (toolbar, paste without a point). */
  avoidOverlap?: boolean
}

/** Anything placed on a board canvas (§4, §5). M2 has `board` cards; M3 adds images, notes, documents. */
export interface CanvasObject {
  id: string
  boardId: string
  type: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  zIndex: number
  locked: boolean
  groupId: string | null
  linkedBoardId: string | null
  assetId: string | null
  data: Record<string, unknown>
  /** Number of content saves (notes); a save based on an older revision is refused. */
  revision: number
  /** Present for `board` cards: details of the board the card opens. */
  board?: { title: string; childBoardCount: number }
  /** Present for objects that show a library file (images). */
  asset?: AssetInfo
  /** Effective tags for this appearance: its own tags, plus the original's tags for a file. */
  tags?: TagPill[]
  /** Present for a stack: its slides, in order, with each slide's own crop. */
  slides?: StackSlide[]
}

/** One image inside a stack. Tags on a slide are separate from the stack and from the asset. */
export interface StackSlide {
  id: string
  assetId: string
  position: number
  crop: ImageCrop | null
  asset?: AssetInfo
  tags?: TagPill[]
}

export interface StackSlideSnapshot {
  id: string
  assetId: string
  position: number
  crop: ImageCrop | null
  layout: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
    crop: ImageCrop | null
  } | null
  sourceObjectId: string | null
  tags: TagAssignment[]
}

export interface StackContentSnapshot {
  revision: number
  settings: StackSettings
  slides: StackSlideSnapshot[]
  geometry: { x: number; y: number; width: number; height: number }
}

export type StackUndo =
  | { op: 'create'; stackId: string; revision: number; removedIds: string[] }
  | {
      op: 'content'
      stackId: string
      revision: number
      before: StackContentSnapshot
      removedIds: string[]
      createdIds: string[]
      applyGeometry: boolean
      revivedIds?: string[]
    }
  | { op: 'display'; stackId: string; shown: string | null; previous: string | null }

export interface StackResult {
  stackId: string
  revision: number
  createdIds: string[]
  removedIds: string[]
  undo: StackUndo
}

/** Changes to an object's placement or arrangement (undoable). */
export interface ObjectPatch {
  id: string
  x?: number
  y?: number
  width?: number
  height?: number
  rotation?: number
  zIndex?: number
  locked?: boolean
  groupId?: string | null
}

export interface BoardDetail {
  id: string
  title: string
  parentBoardId: string | null
  isMain: boolean
  /** From the main board down to (and including) this board. */
  breadcrumb: { id: string; title: string }[]
  objects: CanvasObject[]
  /** Last saved camera position for this board. */
  viewport: Viewport
  /** How tag pills are drawn on this board. */
  tagVisibility: TagVisibility
  /** Tags on the board itself. They do not appear on cards that link to it. */
  tags?: TagPill[]
}

export interface ClipboardContents {
  mode: 'copy' | 'cut'
  objectIds: string[]
  sourceBoardId: string
}

export interface CreateBoardInput {
  parentId: string
  title?: string
  /** Where to place the new board's card (top-left, world coordinates). Defaults to below existing content. */
  at?: Point
}

export interface CreateFolderInput {
  parentId: string | null
  name?: string
}

export interface CreateNoteInput {
  boardId: string
  /** Top-left corner, world coordinates. */
  at: Point
  width?: number
  height?: number
  /** Text to start with (e.g. "save my version as a copy"); empty if not given. */
  content?: NoteContent
  appearance?: Partial<NoteAppearance>
  sizing?: NoteSizing
}

export interface SaveNoteInput {
  id: string
  /** The revision the edit started from. */
  baseRevision: number
  content: NoteContent
  /** New height for auto-height notes (measured by the window that edited the text). */
  height?: number
}

export type SaveNoteResult =
  | { ok: true; revision: number }
  /** Someone else saved first: their version, so the user can choose. */
  | { ok: false; reason: 'conflict'; revision: number; content: NoteContent | null }
  /** The note was moved to the trash (maybe in another window). */
  | { ok: false; reason: 'deleted' }

/** Whole-note changes (undoable on the canvas). */
export interface NoteStylePatch {
  id: string
  appearance?: Partial<NoteAppearance>
  sizing?: NoteSizing
  height?: number
}

export type NoteLeaseAction = 'acquire' | 'release' | 'takeOver'

export type RecoveryKind = 'baseline' | 'hourly' | 'manual' | 'premigration'

export interface RecoveryAsset {
  sha256: string
  ext: string
  bytes: number
}

export interface RecoveryManifest {
  formatVersion: 1
  id: string
  projectId: string
  projectName: string
  createdAt: number
  kind: RecoveryKind
  protected: boolean
  changeRevision: number | null
  assets: RecoveryAsset[]
  database: { sha256: string; bytes: number }
}

export interface RetentionLimits {
  hourly: number
  daily: number
  weekly: number
  monthly: number
}

export interface BackupSettings {
  customRoot: string | null
  fallbackToDefault: boolean
  retention: RetentionLimits
}

export interface BackupStatus {
  location: string
  usingFallback: boolean
  lastSuccessAt: number | null
  lastError: string | null
  nextEligibleAt: number | null
  bytes: number
  sameVolume: boolean
  inProgress: boolean
  points: RecoveryManifest[]
}

export type SearchKind =
  'board' | 'note' | 'entry' | 'folder' | 'pdf-page' | 'asset' | 'object' | 'stack' | 'slide'
export type SearchFilter = 'all' | 'board' | 'note' | 'pdf' | 'image' | 'file' | 'folder'

export interface SearchHit {
  kind: SearchKind
  sourceId: string
  assetId: string | null
  page: number | null
  title: string
  snippet: string
  location: string
  /** Library entry that satisfied the query, when the hit is that entry or a page found through it. */
  entryId?: string | null
  /** Canvas object that satisfied the query. */
  objectId?: string | null
  /** Board that owns `objectId`, or the board hit itself. */
  boardId?: string | null
  /** Tags that made this hit match, and whether each one is on the item, its original, or its stack. */
  matchedTags?: { id: string; name: string; source: 'direct' | 'asset' | 'stack' }[]
  /** Stack that owns a slide hit, or the stack hit itself. */
  stackId?: string | null
  /** Slide that matched, when `kind` is `slide`. */
  slideId?: string | null
  /** Name of the parent stack, when `kind` is `slide`. */
  stackTitle?: string | null
}

export interface SearchRequest {
  text?: string
  phrase?: boolean
  filter?: SearchFilter
  tags?: { included: string[]; mode: 'all' | 'any'; excluded: string[] }
  /** `direct` ignores tags inherited from the original file. */
  tagMatch?: 'effective' | 'direct'
  scope?: { type: 'project' } | { type: 'board'; id: string } | { type: 'folder'; id: string }
  cursor?: string | null
  limit?: number
}

export interface SearchPage {
  hits: SearchHit[]
  nextCursor: string | null
}

export type TagTargetType = 'asset' | 'entry' | 'object' | 'board' | 'slide'
export type TagVisibility = 'hidden' | 'hover' | 'always'

export interface TagRecord {
  id: string
  name: string
  color: string | null
  reusable: boolean
  archived: boolean
  deleted: boolean
  ownerType: TagTargetType | null
  ownerId: string | null
  assignmentCount: number
}

export interface TagTarget {
  type: TagTargetType
  id: string
}

/** A reusable assignment, or a one-off tag row. `id` is the assignment's own identity. */
export interface TagAssignment {
  id: string
  tagId: string
  targetType: TagTargetType
  targetId: string
  oneOff?: { name: string; color: string | null }
}

export interface TagPill {
  id: string
  name: string
  color: string | null
  source: 'direct' | 'asset'
  oneOff: boolean
  assignmentId: string | null
}

export type RestoreTagResult =
  { status: 'restored'; tag: TagRecord } | { status: 'name-taken'; suggestedName: string }

export type PromoteTagResult =
  | { status: 'promoted'; tag: TagRecord }
  | { status: 'use-existing'; existing: TagRecord }
  | { status: 'trashed-exists'; existing: TagRecord }

export interface BoardAppearance {
  objectId: string
  boardId: string
  boardTitle: string
  path: string
  x: number
  y: number
  /** Set when the appearance is a slide inside a stack. */
  slideId?: string | null
}

export interface NoteDraftInfo {
  objectId: string
  baseRevision: number
  plainText: string
  writtenAt: number
  assessment: 'restore' | 'conflict' | 'missing'
  boardId: string | null
  contentJson: string
}
