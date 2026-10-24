import type {
  BoardDetail,
  BoardListItem,
  ClipboardContents,
  CreateBoardInput,
  CreateFolderInput,
  CreateProjectInput,
  FolderListItem,
  ObjectPatch,
  Point,
  ProjectSummary,
  ProjectTree,
  RecentProject,
  Viewport
} from './types'

/**
 * Every request the renderer can make to the main process.
 * Adding a channel here forces a matching handler in `src/main/ipc.ts`
 * and exposes it on `window.api` via the preload script.
 */
export interface IpcRequests {
  'dialog:pickDirectory': { args: []; result: string | null }
  'dialog:pickProject': { args: []; result: string | null }
  'project:create': { args: [input: CreateProjectInput]; result: ProjectSummary }
  'project:open': { args: [path: string]; result: ProjectSummary }
  'project:close': { args: []; result: void }
  'project:current': { args: []; result: ProjectSummary | null }
  'project:rename': { args: [name: string]; result: ProjectSummary }
  'recent:list': { args: []; result: RecentProject[] }
  'recent:remove': { args: [path: string]; result: RecentProject[] }
  'tree:get': { args: []; result: ProjectTree }
  'board:get': { args: [id: string]; result: BoardDetail }
  'board:create': { args: [input: CreateBoardInput]; result: BoardListItem & { objectId: string } }
  'board:rename': { args: [id: string, title: string]; result: void }
  'board:move': { args: [id: string, newParentId: string]; result: void }
  /** Returns the board's card id, so the delete can be undone with `objects:restore`. */
  'board:delete': { args: [id: string]; result: { cardId: string | null } }
  'board:setViewport': { args: [id: string, viewport: Viewport]; result: void }
  'objects:update': { args: [patches: ObjectPatch[]]; result: void }
  'objects:delete': { args: [ids: string[]]; result: void }
  'objects:restore': { args: [ids: string[]]; result: void }
  'objects:moveToBoard': { args: [ids: string[], targetBoardId: string, at?: Point]; result: void }
  'objects:copyTo': { args: [ids: string[], targetBoardId: string, at: Point]; result: string[] }
  'clipboard:set': { args: [contents: ClipboardContents | null]; result: void }
  'clipboard:get': { args: []; result: ClipboardContents | null }
  'folder:create': { args: [input: CreateFolderInput]; result: FolderListItem }
  'folder:rename': { args: [id: string, name: string]; result: void }
  'folder:move': { args: [id: string, newParentId: string | null]; result: void }
  'folder:delete': { args: [id: string]; result: void }
  'window:openNew': { args: [options?: { boardId?: string }]; result: void }
}

/** Events pushed from the main process to renderer windows. */
export interface IpcEvents {
  /** A project this window has open was changed (possibly by another window). */
  'project:changed': ProjectSummary
  /** Boards or folders of the open project changed; refetch the tree and current board. */
  'project:contentChanged': null
}

export type IpcChannel = keyof IpcRequests
export type IpcEventChannel = keyof IpcEvents

export const IPC_CHANNELS = [
  'dialog:pickDirectory',
  'dialog:pickProject',
  'project:create',
  'project:open',
  'project:close',
  'project:current',
  'project:rename',
  'recent:list',
  'recent:remove',
  'tree:get',
  'board:get',
  'board:create',
  'board:rename',
  'board:move',
  'board:delete',
  'board:setViewport',
  'objects:update',
  'objects:delete',
  'objects:restore',
  'objects:moveToBoard',
  'objects:copyTo',
  'clipboard:set',
  'clipboard:get',
  'folder:create',
  'folder:rename',
  'folder:move',
  'folder:delete',
  'window:openNew'
] as const satisfies readonly IpcChannel[]

/** The API exposed to the renderer as `window.api`. */
export type Api = {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcRequests[C]['args']
  ): Promise<IpcRequests[C]['result']>
  on<E extends IpcEventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}
