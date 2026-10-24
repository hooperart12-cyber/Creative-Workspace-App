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

/** A nested-board card placed on a board. */
export interface BoardCard {
  /** The board_objects row id (the card itself). */
  objectId: string
  /** The board the card opens. */
  boardId: string
  title: string
  childBoardCount: number
  x: number
  y: number
}

export interface BoardDetail {
  id: string
  title: string
  parentBoardId: string | null
  isMain: boolean
  /** From the main board down to (and including) this board. */
  breadcrumb: { id: string; title: string }[]
  cards: BoardCard[]
}

export interface CreateBoardInput {
  parentId: string
  title?: string
}

export interface CreateFolderInput {
  parentId: string | null
  name?: string
}
