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
  /** Library folder; null is the library's top level. */
  folderId: string | null
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
  /** Present for `board` cards: details of the board the card opens. */
  board?: { title: string; childBoardCount: number }
  /** Present for objects that show a library file (images). */
  asset?: AssetInfo
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
