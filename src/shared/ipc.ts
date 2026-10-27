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
  DuplicatePolicy,
  FolderDeletePreview,
  FolderListItem,
  ImportBytesInput,
  ImportProgress,
  ImportResult,
  LibraryDetails,
  LibraryPage,
  LibraryQuery,
  NoteLeaseAction,
  NoteStylePatch,
  ObjectPatch,
  Point,
  ProjectSummary,
  ProjectTree,
  PurgeResult,
  StorageReport,
  RecentProject,
  SaveNoteInput,
  SaveNoteResult,
  TrashItem,
  TrashKind,
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
  'objects:restore': { args: [ids: string[], boardId?: string]; result: void }
  'objects:moveToBoard': { args: [ids: string[], targetBoardId: string, at?: Point]; result: void }
  'objects:copyTo': { args: [ids: string[], targetBoardId: string, at: Point]; result: string[] }
  'objects:createImages': { args: [input: CreateImagesInput]; result: string[] }
  /** Places images, PDFs and other files. The card type follows the file. */
  'objects:createFromAssets': { args: [input: CreateImagesInput]; result: string[] }
  'objects:read': { args: [id: string]; result: CanvasObject | null }
  'objects:setFileAppearance': {
    args: [id: string, appearance: 'compact' | 'preview']
    result: void
  }
  /**
   * Copies files into the library. `imagesOnly` is the Image tool: other files are skipped.
   * Drop, paste and the File tool omit it and also store PDFs and generic files.
   */
  'assets:importFiles': {
    args: [paths: string[], options?: { imagesOnly?: boolean }]
    result: ImportResult
  }
  'assets:importBytes': { args: [files: ImportBytesInput[]]; result: ImportResult }
  /** Asks where to save, then copies the stored original there. False if cancelled. */
  'assets:saveOriginal': { args: [assetId: string]; result: boolean }
  /** Writes a working copy into a chosen folder and opens that copy. Null if cancelled. */
  'assets:openCopy': { args: [assetId: string]; result: string | null }
  /** Saves a rendered PDF cover (PNG bytes) as the file's thumbnail. */
  'assets:saveCover': { args: [assetId: string, png: Uint8Array]; result: void }
  /** Bytes `[start, end)` of a stored original. The PDF reader reads the file this way. */
  'assets:readRange': {
    args: [assetId: string, start: number, end: number]
    result: Uint8Array
  }
  /** Page size learned after unlocking a PDF. The password itself is never sent. */
  'assets:recordPdfInfo': {
    args: [assetId: string, info: { pageCount: number; width: number; height: number }]
    result: void
  }
  /** Attaches or clears a file's preview image. Does not delete the image asset. */
  'assets:setPreview': { args: [assetId: string, previewAssetId: string | null]; result: void }
  'dialog:pickImages': { args: []; result: string[] }
  'dialog:pickFiles': { args: []; result: string[] }
  /** App objects copied with Ctrl+C/X. Null once something else has been copied to the system clipboard. */
  'clipboard:set': { args: [contents: ClipboardContents | null]; result: void }
  'clipboard:get': { args: []; result: ClipboardContents | null }
  /** Plain text currently on the system clipboard (empty when there is none). */
  'clipboard:readText': { args: []; result: string }
  /**
   * Imports what another program put on the system clipboard: files copied in File Explorer
   * or Finder, or an image (browser "Copy image", screenshots). Null if there's nothing to import.
   */
  'clipboard:importExternal': { args: []; result: ImportResult | null }
  'folder:create': { args: [input: CreateFolderInput]; result: FolderListItem }
  'folder:rename': { args: [id: string, name: string]; result: void }
  'folder:move': { args: [id: string, newParentId: string | null]; result: void }
  'folder:delete': {
    args: [id: string, mode?: 'tree' | 'dissolve', renameConflicts?: boolean]
    result: { renamed: string[] }
  }
  'folder:deletePreview': { args: [id: string]; result: FolderDeletePreview }
  'library:list': { args: [query: LibraryQuery]; result: LibraryPage }
  'library:details': { args: [id: string]; result: LibraryDetails }
  'library:rename': { args: [id: string, name: string]; result: string }
  'library:move': {
    args: [ids: string[], folderId: string | null]
    result: { id: string; folderId: string | null }[]
  }
  'library:trash': { args: [ids: string[]]; result: { entryIds: string[]; boardCount: number } }
  'library:restore': {
    args: [ids: string[], destinationFolderId?: string | null]
    result: { restored: string[]; needsDestination: string[] }
  }
  'library:entriesForAsset': {
    args: [assetId: string]
    result: { id: string; folderId: string | null }[]
  }
  'library:storage': { args: []; result: StorageReport }
  'library:importFiles': {
    args: [
      paths: string[],
      options: {
        folderId: string | null
        duplicates: DuplicatePolicy
        structure?: 'preserve' | 'flatten'
      }
    ]
    result: ImportResult
  }
  'library:importTree': {
    args: [
      root: string,
      options: {
        folderId: string | null
        duplicates: DuplicatePolicy
        structure: 'preserve' | 'flatten'
      }
    ]
    result: ImportResult
  }
  'library:cancelImport': { args: []; result: void }
  'trash:list': { args: [kind: 'all' | TrashKind]; result: TrashItem[] }
  'trash:restoreFolders': {
    args: [ids: string[], destinationParentId?: string | null]
    result: { restoredFolderIds: string[]; restoredEntryIds: string[]; needsDestination: string[] }
  }
  'trash:purge': {
    args: [input: { entries: string[]; folders: string[]; objects: string[] }]
    result: PurgeResult
  }
  'trash:empty': { args: []; result: PurgeResult }
  'dialog:pickFolder': { args: []; result: string | null }
  'window:openNew': { args: [options?: { boardId?: string }]; result: void }
  /** Opens the PDF reader in its own window. Closing it does not close the project. */
  'window:openReader': { args: [options: { objectId: string }]; result: void }
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
  /** Import progress for the window that started it. */
  'library:importProgress': ImportProgress
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
  'objects:createFromAssets',
  'objects:read',
  'objects:setFileAppearance',
  'assets:importFiles',
  'assets:importBytes',
  'assets:saveOriginal',
  'assets:openCopy',
  'assets:saveCover',
  'assets:readRange',
  'assets:recordPdfInfo',
  'assets:setPreview',
  'dialog:pickImages',
  'dialog:pickFiles',
  'clipboard:set',
  'clipboard:get',
  'clipboard:readText',
  'clipboard:importExternal',
  'folder:create',
  'folder:rename',
  'folder:move',
  'folder:delete',
  'folder:deletePreview',
  'library:list',
  'library:details',
  'library:rename',
  'library:move',
  'library:trash',
  'library:restore',
  'library:entriesForAsset',
  'library:storage',
  'library:importFiles',
  'library:importTree',
  'library:cancelImport',
  'trash:list',
  'trash:restoreFolders',
  'trash:purge',
  'trash:empty',
  'dialog:pickFolder',
  'window:openNew',
  'window:openReader',
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
