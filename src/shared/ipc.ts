import type {
  BoardDetail,
  BoardListItem,
  CanvasObject,
  ClipboardContents,
  CreateBoardInput,
  CreateFolderInput,
  CreateImagesInput,
  CreateNoteInput,
  CreateProjectInput,
  FolderListItem,
  ImportBytesInput,
  ImportResult,
  NoteLeaseAction,
  NoteStylePatch,
  ObjectPatch,
  Point,
  ProjectSummary,
  ProjectTree,
  RecentProject,
  SaveNoteInput,
  SaveNoteResult,
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
  'objects:createImages': { args: [input: CreateImagesInput]; result: string[] }
  /** Copies files into the library (images only for now). Unsupported files are listed as skipped. */
  'assets:importFiles': { args: [paths: string[]]; result: ImportResult }
  'assets:importBytes': { args: [files: ImportBytesInput[]]; result: ImportResult }
  /** Asks where to save, then copies the stored original there. False if cancelled. */
  'assets:saveOriginal': { args: [assetId: string]; result: boolean }
  'dialog:pickImages': { args: []; result: string[] }
  /** App objects copied with Ctrl+C/X. Null once something else has been copied to the system clipboard. */
  'clipboard:set': { args: [contents: ClipboardContents | null]; result: void }
  'clipboard:get': { args: []; result: ClipboardContents | null }
  /**
   * Imports what another program put on the system clipboard: files copied in File Explorer
   * or Finder, or an image (browser "Copy image", screenshots). Null if there's nothing to import.
   */
  'clipboard:importExternal': { args: []; result: ImportResult | null }
  'folder:create': { args: [input: CreateFolderInput]; result: FolderListItem }
  'folder:rename': { args: [id: string, name: string]; result: void }
  'folder:move': { args: [id: string, newParentId: string | null]; result: void }
  'folder:delete': { args: [id: string]; result: void }
  'window:openNew': { args: [options?: { boardId?: string }]; result: void }
  /** Creates an empty (or pre-filled) note and returns it. */
  'notes:create': { args: [input: CreateNoteInput]; result: CanvasObject }
  /** Saves a note's text unless another window saved since `baseRevision`. */
  'notes:saveContent': { args: [input: SaveNoteInput]; result: SaveNoteResult }
  'notes:updateStyle': { args: [patches: NoteStylePatch[]]; result: void }
  /** Fresh copies of notes (after another window changed them). */
  'notes:get': { args: [ids: string[]]; result: CanvasObject[] }
  /** Starts or stops editing a note in this window; `ok` is false if another window is editing it. */
  'notes:lease': { args: [id: string, action: NoteLeaseAction]; result: { ok: boolean } }
  /** Notes other windows are editing right now. */
  'notes:editedElsewhere': { args: []; result: string[] }
  /** After `notes:leaseLost`: this window saved the note and stopped editing it. */
  'notes:handedOver': { args: [id: string]; result: void }
  /** Opens a link from a note in the default browser or mail app (web and mail links only). */
  'links:open': { args: [url: string]; result: void }
  /** The window finished saving after `window:flushRequest`, and may close. */
  'window:flushed': { args: []; result: void }
}

/** Events pushed from the main process to renderer windows. */
export interface IpcEvents {
  /** A project this window has open was changed (possibly by another window). */
  'project:changed': ProjectSummary
  /** Boards or folders of the open project changed; refetch the tree and current board. */
  'project:contentChanged': null
  /** Only these objects changed (note text saves): refetch just them. */
  'objects:changed': { boardId: string; objectIds: string[] }
  /** Notes being edited in other windows changed. */
  'notes:editedElsewhere': string[]
  /** Another window took over editing this note. */
  'notes:leaseLost': { objectId: string }
  /** The window is closing: save open notes, then call `window:flushed`. */
  'window:flushRequest': null
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
  'objects:createImages',
  'assets:importFiles',
  'assets:importBytes',
  'assets:saveOriginal',
  'dialog:pickImages',
  'clipboard:set',
  'clipboard:get',
  'clipboard:importExternal',
  'folder:create',
  'folder:rename',
  'folder:move',
  'folder:delete',
  'window:openNew',
  'notes:create',
  'notes:saveContent',
  'notes:updateStyle',
  'notes:get',
  'notes:lease',
  'notes:editedElsewhere',
  'notes:handedOver',
  'links:open',
  'window:flushed'
] as const satisfies readonly IpcChannel[]

/** The API exposed to the renderer as `window.api`. */
export type Api = {
  invoke<C extends IpcChannel>(
    channel: C,
    ...args: IpcRequests[C]['args']
  ): Promise<IpcRequests[C]['result']>
  on<E extends IpcEventChannel>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
  /** Path on disk of a dropped or pasted file; empty for files that only exist in memory. */
  pathForFile(file: File): string
}
