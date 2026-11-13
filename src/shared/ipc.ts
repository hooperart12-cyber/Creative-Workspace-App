import type { BulkOperation, BulkUndoEntry } from './collectionBulk'
import type { ExportFormat, ExportSpread, ExportWarning } from './collectionExport'
import type { ReaderDocument } from './reader'
import type { ImportAction, StagedSource } from './collectionImport'
import type {
  CollectionDetail,
  CollectionOutline,
  CollectionTemplateInfo,
  PagePatch,
  PageRole,
  PageStatus,
  TemplateData
} from './collections'
import type { Destination } from './destinations'
import type { ImageCrop } from './crop'
import type { StackSettings } from './stacks'
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
  BackupSettings,
  BackupStatus,
  BoardAppearance,
  NoteDraftInfo,
  RecoveryManifest,
  SearchPage,
  SearchRequest,
  StackResult,
  StackUndo,
  PromoteTagResult,
  RestoreTagResult,
  TagAssignment,
  TagRecord,
  TagTarget,
  TagVisibility,
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
  'stacks:createEmpty': { args: [boardId: string, at: Point]; result: StackResult }
  'stacks:createFromObjects': {
    args: [objectIds: string[], mode: 'combine' | 'copy']
    result: StackResult
  }
  'stacks:createFromAssets': {
    args: [boardId: string, assetIds: string[], at: Point]
    result: StackResult
  }
  'stacks:add': {
    args: [
      input: {
        stackId: string
        expectedRevision: number
        assetIds?: string[]
        objectIds?: string[]
        mode: 'move' | 'copy'
      }
    ]
    result: StackResult
  }
  'stacks:remove': {
    args: [stackId: string, slideId: string, expectedRevision: number]
    result: StackResult
  }
  'stacks:extract': {
    args: [stackId: string, slideId: string, expectedRevision: number]
    result: StackResult
  }
  'stacks:reorder': {
    args: [stackId: string, slideIds: string[], expectedRevision: number]
    result: StackResult
  }
  'stacks:setCover': {
    args: [stackId: string, slideId: string, expectedRevision: number]
    result: StackResult
  }
  'stacks:setDisplayed': {
    args: [stackId: string, slideId: string | null, expectedShown: string | null]
    result: void
  }
  'stacks:updateSettings': {
    args: [
      stackId: string,
      patch: { sizing?: StackSettings['sizing']; rememberLast?: boolean; name?: string | null },
      expectedRevision: number
    ]
    result: StackResult
  }
  'stacks:unstack': {
    args: [stackId: string, mode: 'separate' | 'restore', expectedRevision: number]
    result: StackResult
  }
  'stacks:setSlideCrop': {
    args: [stackId: string, slideId: string, crop: ImageCrop | null, expectedRevision: number]
    result: StackResult
  }
  'stacks:setImageCrop': {
    args: [objectId: string, crop: ImageCrop | null, expectedRevision: number]
    result: {
      revision: number
      undo: {
        objectId: string
        revision: number
        crop: ImageCrop | null
        width: number
        height: number
      }
    }
  }
  'stacks:undoImageCrop': {
    args: [
      undo: {
        objectId: string
        revision: number
        crop: ImageCrop | null
        width: number
        height: number
      }
    ]
    result: void
  }
  'stacks:undo': { args: [undo: StackUndo]; result: void }
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
  'relations:createConnection': {
    args: [boardId: string, data: import('./connections').ConnectionData]
    result: { id: string; revision: number }
  }
  'relations:updateConnection': {
    args: [id: string, baseRevision: number, data: import('./connections').ConnectionData]
    result: { revision: number }
  }
  'relations:createLink': {
    args: [boardId: string, at: Point, data: Record<string, unknown>]
    result: { id: string; revision: number }
  }
  'relations:updateLink': {
    args: [id: string, baseRevision: number, data: Record<string, unknown>]
    result: { revision: number }
  }
  'relations:setObjectLink': {
    args: [
      id: string,
      baseRevision: number,
      destination: import('./destinations').Destination | null
    ]
    result: { revision: number }
  }
  'relations:createComment': {
    args: [boardId: string, at: Point, data: import('./comments').CommentData, body: string]
    result: { id: string; revision: number; messageId: string }
  }
  'relations:updateComment': {
    args: [id: string, baseRevision: number, data: import('./comments').CommentData]
    result: { revision: number }
  }
  'relations:addReply': {
    args: [id: string, baseRevision: number, body: string]
    result: { revision: number; messageId: string }
  }
  'relations:editReply': {
    args: [commentId: string, messageId: string, baseRevision: number, body: string]
    result: { revision: number }
  }
  'relations:deleteReply': {
    args: [commentId: string, messageId: string, baseRevision: number]
    result: { revision: number }
  }
  'relations:setBoardView': {
    args: [
      boardId: string,
      patch: { connectionDisplay?: string; crossingStyle?: string; commentView?: string }
    ]
    result: void
  }
  'relations:integrity': {
    args: []
    result: { kind: string; id: string; boardId: string; detail: string }[]
  }
  'relations:repair': {
    args: [id: string, action: 'keep' | 'reattach' | 'clear']
    result: {
      type: string
      revision: number
      before: Record<string, unknown>
      previousLink: string | null
    }
  }
  'relations:restore': {
    args: [
      id: string,
      baseRevision: number,
      data: Record<string, unknown>,
      linkedBoardId?: string | null
    ]
    result: { revision: number }
  }
  'relations:fetchPreview': {
    args: [id: string, baseRevision: number]
    result: { revision: number }
  }
  /** The window finished saving after `window:flushRequest`, and may close. */
  'window:flushed': { args: []; result: void }
  'backup:status': { args: []; result: BackupStatus }
  'backup:create': { args: []; result: RecoveryManifest }
  'backup:verify': { args: [id: string]; result: { ok: true } | { ok: false; errors: string[] } }
  'backup:delete': { args: [id: string]; result: void }
  'backup:restore': {
    args: [id: string, parentDir: string, name: string]
    result: { path: string }
  }
  'backup:settings': { args: []; result: BackupSettings }
  'backup:saveSettings': { args: [patch: Partial<BackupSettings>]; result: BackupSettings }
  'project:exportZip': { args: [destination: string]; result: void }
  'project:importZip': { args: [zipPath: string, parentDir: string, name: string]; result: string }
  'board:exportPackage': {
    args: [boardId: string, destination: string, includeComments: boolean]
    result: void
  }
  'board:importPackage': {
    args: [zipPath: string, parentBoardId: string]
    result: { boardId: string }
  }
  'board:writePicture': {
    args: [pngBase64: string, destination: string, format: 'png' | 'pdf']
    result: void
  }
  'dialog:pickSaveZip': { args: []; result: string | null }
  'dialog:pickZip': { args: []; result: string | null }
  'dialog:pickSavePicture': { args: [format: 'png' | 'pdf']; result: string | null }
  'dialog:pickSaveBoardPackage': { args: []; result: string | null }
  'dialog:pickBoardPackage': { args: []; result: string | null }
  'search:query': { args: [request: SearchRequest]; result: SearchPage }
  'search:appearances': { args: [assetId: string]; result: BoardAppearance[] }
  'search:rebuild': { args: []; result: void }
  'search:nextPdf': {
    args: []
    result: { assetId: string; pagesDone: number; bytes: number; name: string } | null
  }
  'search:addPdfPage': {
    args: [assetId: string, page: number, text: string, title: string]
    result: void
  }
  'search:finishPdf': {
    args: [assetId: string, state: 'done' | 'no-text' | 'locked' | 'failed', note?: string]
    result: void
  }
  'tags:list': {
    args: [options?: { query?: string; includeArchived?: boolean; trash?: boolean }]
    result: TagRecord[]
  }
  'tags:oneOffs': { args: []; result: TagRecord[] }
  'tags:summary': {
    args: [targets: TagTarget[]]
    result: { id: string; name: string; color: string | null; present: number; total: number }[]
  }
  'tags:create': { args: [name: string, color?: string | null]; result: TagRecord }
  'tags:createOneOff': {
    args: [name: string, target: TagTarget, color?: string | null]
    result: TagRecord
  }
  'tags:removeOneOff': { args: [id: string]; result: void }
  'tags:assign': {
    args: [tagId: string, target: TagTarget]
    result: TagAssignment & { created: boolean }
  }
  'tags:unassign': { args: [tagId: string, target: TagTarget]; result: TagAssignment | null }
  'tags:addMany': { args: [tagIds: string[], targets: TagTarget[]]; result: TagAssignment[] }
  'tags:removeMany': { args: [tagIds: string[], targets: TagTarget[]]; result: TagAssignment[] }
  'tags:replaceDirect': {
    args: [tagIds: string[], targets: TagTarget[]]
    result: { before: TagAssignment[]; after: TagAssignment[] }
  }
  'tags:revertAdd': { args: [ids: string[]]; result: void }
  'tags:revertRemove': { args: [rows: TagAssignment[]]; result: void }
  'tags:revertReplace': {
    args: [targets: TagTarget[], expectedIds: string[], restore: TagAssignment[]]
    result: void
  }
  'tags:rename': { args: [id: string, name: string]; result: TagRecord }
  'tags:recolor': { args: [id: string, color: string | null]; result: TagRecord }
  'tags:archive': { args: [id: string]; result: TagRecord }
  'tags:unarchive': { args: [id: string]; result: TagRecord }
  'tags:trash': { args: [id: string]; result: { tag: TagRecord; assignments: number } }
  'tags:restore': { args: [id: string, name?: string]; result: RestoreTagResult }
  'tags:purge': { args: [id: string]; result: { assignments: number } }
  'tags:merge': {
    args: [sourceId: string, destinationId: string]
    result: { moved: number; destination: TagRecord }
  }
  'tags:promote': {
    args: [id: string, choice?: { useExisting?: boolean; restoreTrashed?: boolean }]
    result: PromoteTagResult
  }
  'tags:visibility': { args: [boardId: string, visibility: TagVisibility]; result: void }
  'assets:get': { args: [id: string]; result: import('./types').AssetInfo }
  'recovery:writeDraft': {
    args: [
      draft: {
        objectId: string
        baseRevision: number
        content: import('./notes').NoteContent
        plainText: string
        writtenAt: number
      }
    ]
    result: void
  }
  'recovery:clearDraft': { args: [objectId: string]; result: void }
  'recovery:list': { args: []; result: NoteDraftInfo[] }
  'collections:outline': { args: []; result: CollectionOutline }
  'collections:templates': { args: []; result: CollectionTemplateInfo[] }
  'collections:create': {
    args: [
      input: {
        title: string
        folderId?: string | null
        templateId?: string | null
        direction?: 'ltr' | 'rtl'
        placeholderCount?: number
      }
    ]
    result: { id: string; pageIds: string[] }
  }
  'collections:detail': { args: [id: string]; result: CollectionDetail }
  'collections:rename': { args: [id: string, title: string]; result: void }
  'collections:move': { args: [id: string, folderId: string | null]; result: void }
  'collections:trash': { args: [id: string]; result: void }
  'collections:restore': { args: [id: string]; result: void }
  'collections:reorder': {
    args: [kind: 'folder' | 'collection', id: string, beforeId: string | null]
    result: void
  }
  'collections:createFolder': {
    args: [parentId: string | null, name: string]
    result: { id: string }
  }
  'collections:renameFolder': { args: [id: string, name: string]; result: void }
  'collections:moveFolder': { args: [id: string, parentId: string | null]; result: void }
  'collections:trashFolder': { args: [id: string]; result: void }
  'collections:restoreFolder': { args: [id: string]; result: void }
  'collections:trashedFolders': { args: []; result: { id: string; name: string }[] }
  'collections:trashedCollections': { args: []; result: { id: string; title: string }[] }
  'collections:saveTemplate': {
    args: [name: string, collectionId: string]
    result: { id: string }
  }
  'collections:renameTemplate': { args: [id: string, name: string]; result: void }
  'collections:updateTemplate': { args: [id: string, data: TemplateData]; result: void }
  'collections:insertPages': {
    args: [
      input: {
        collectionId: string
        count: number
        beforeId?: string | null
        title?: string
        notes?: string
        role?: PageRole | null
        status?: PageStatus
        tagIds?: string[]
      }
    ]
    result: { pageIds: string[] }
  }
  'collections:undoPages': { args: [pageIds: string[]]; result: void }
  'collections:reorderPages': {
    args: [collectionId: string, pageIds: string[], beforeId: string | null]
    result: void
  }
  'collections:orderPages': {
    args: [collectionId: string, pageIds: string[]]
    result: void
  }
  'collections:trashPages': { args: [pageIds: string[]]; result: { pageIds: string[] } }
  'collections:restorePages': { args: [pageIds: string[]]; result: { pageIds: string[] } }
  'collections:updatePage': {
    args: [id: string, revision: number, patch: PagePatch, base?: PagePatch]
    result: { revision: number }
  }
  'collections:setStage': {
    args: [pageId: string, stageId: string, state: PageStatus, note?: string]
    result: void
  }
  'collections:lockSpread': {
    args: [pageId: string, partnerId: string]
    result: { spreadId: string }
  }
  'collections:unlockSpread': { args: [pageId: string]; result: void }
  'collections:setSpan': { args: [pageId: string, span: 1 | 2]; result: void }
  'collections:updateSettings': {
    args: [
      id: string,
      patch: {
        title?: string
        description?: string
        direction?: 'ltr' | 'rtl'
        firstPageSide?: 'left' | 'right'
        numberStart?: number
        nextCollectionId?: string | null
      }
    ]
    result: void
  }
  'collections:rememberPlanner': {
    args: [
      id: string,
      patch: {
        view?: 'grid' | 'spread'
        density?: 'compact' | 'balanced' | 'detailed'
        gridSize?: number
        spreadZoom?: number
        pageId?: string | null
      }
    ]
    result: void
  }
  'collections:placeCard': {
    args: [boardId: string, collectionId: string]
    result: { id: string }
  }
  'collections:setAppearance': {
    args: [
      objectId: string,
      patch: {
        display?: 'compact' | 'cover'
        openWith?: 'planner' | 'reader' | 'last'
        lastOpened?: 'planner' | 'reader'
      }
    ]
    result: void
  }
  'collections:comments': { args: [pageId: string]; result: { id: string; body: string }[] }
  'collections:addComment': { args: [pageId: string, body: string]; result: { id: string } }
  'collections:links': {
    args: [pageId: string]
    result: { id: string; destination: Destination | null }[]
  }
  'collections:addLink': {
    args: [pageId: string, destination: Destination]
    result: { id: string }
  }
  'collections:search': {
    args: [collectionId: string, query: string]
    result: { ids: string[] }
  }
  'collections:applyBulk': {
    args: [ids: string[], operation: BulkOperation, confirmReplace: boolean]
    result: {
      changed: string[]
      alreadyMatching: string[]
      incompatible: { id: string; reason: string }[]
      undo: BulkUndoEntry[]
    }
  }
  'collections:undoBulk': {
    args: [entries: BulkUndoEntry[]]
    result: void
  }
  'collections:stagePaths': {
    args: [paths: string[]]
    result: { files: StagedSource[]; error: string | null }
  }
  'collections:commitImport': {
    args: [
      collectionId: string,
      beforeId: string | null,
      files: StagedSource[],
      actions: ImportAction[]
    ]
    result: {
      created: string[]
      filled: {
        pageId: string
        versionIds: string[]
        previousDisplayed: string | null
        revision: number
      }[]
    }
  }
  'collections:undoImport': {
    args: [
      record: {
        created: string[]
        filled: {
          pageId: string
          versionIds: string[]
          previousDisplayed: string | null
          revision: number
        }[]
      }
    ]
    result: void
  }
  'collections:versions': {
    args: [pageId: string]
    result: {
      id: string
      name: string
      assetId: string
      fileName: string
      sha256: string | null
      width: number | null
      height: number | null
      missing: boolean
      crop: { x: number; y: number; w: number; h: number } | null
    }[]
  }
  'collections:reader': { args: [collectionId: string]; result: ReaderDocument }
  'collections:touchReader': {
    args: [
      collectionId: string,
      state: { pageId: string; layout: string; zoom: number; x: number; y: number }
    ]
    result: void
  }
  'collections:nav': {
    args: [collectionId: string]
    result: { id: string; pageId: string; kind: string; title: string; available: boolean }[]
  }
  'collections:addNav': {
    args: [collectionId: string, pageId: string, kind: 'toc' | 'bookmark', title: string]
    result: { id: string }
  }
  'collections:renameNav': { args: [id: string, title: string]; result: void }
  'collections:removeNav': { args: [id: string]; result: void }
  'collections:exportSequence': {
    args: [
      collectionId: string,
      destination: string,
      format: ExportFormat,
      spread: ExportSpread,
      omitUnavailable: boolean
    ]
    result: { files: string[]; warnings: ExportWarning[] }
  }
  'collections:exportPackage': {
    args: [collectionId: string, destination: string, includeComments: boolean]
    result: void
  }
  'collections:importPackage': {
    args: [zipPath: string]
    result: { collectionId: string; unresolved: string[] }
  }
  'dialog:pickSaveCollection': { args: [kind: 'pdf' | 'zip']; result: string | null }
  'dialog:pickCollectionPackage': { args: []; result: string | null }
  'collections:setDisplayed': {
    args: [pageId: string, versionId: string | null, revision: number]
    result: { revision: number }
  }
  'collections:addVersion': {
    args: [pageId: string, filePath: string]
    result: { id: string }
  }
  'collections:pageTags': {
    args: [pageIds: string[]]
    result: { pageId: string; tagId: string }[]
  }
  'collections:relinkVersion': {
    args: [versionId: string, assetId: string]
    result: { cropCleared: boolean }
  }
  'collections:relinkFile': {
    args: [versionId: string, filePath: string]
    result: { cropCleared: boolean }
  }
  'collections:previewFolderMatch': {
    args: [collectionId: string, folder: string]
    result: { versionId: string; filePath: string; fileName: string }[]
  }
  'collections:applyFolderMatch': {
    args: [pairs: { versionId: string; filePath: string }[]]
    result: { count: number }
  }
  'collections:stageBoard': { args: [boardId: string]; result: StagedSource[] }
  'collections:stageClipboard': {
    args: []
    result: { files: StagedSource[]; error: string | null }
  }
  'collections:setCrop': {
    args: [versionId: string, crop: { x: number; y: number; w: number; h: number } | null]
    result: void
  }
  'collections:placePageLink': {
    args: [boardId: string, collectionId: string, pageId: string]
    result: { id: string }
  }
  'collections:movePages': {
    args: [pageIds: string[], toCollectionId: string, beforeId: string | null]
    result: { unmapped: { pageId: string; stageName: string; note: string }[] }
  }
  'collections:copyPages': {
    args: [pageIds: string[], toCollectionId: string, beforeId: string | null]
    result: { pageIds: string[] }
  }
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
  /** A project write finished or failed. Backup errors are not reported here. */
  'save:state': { phase: 'saving' | 'saved' | 'failed'; error: string | null; at?: number }
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
  'stacks:createEmpty',
  'stacks:createFromObjects',
  'stacks:createFromAssets',
  'stacks:add',
  'stacks:remove',
  'stacks:extract',
  'stacks:reorder',
  'stacks:setCover',
  'stacks:setDisplayed',
  'stacks:updateSettings',
  'stacks:unstack',
  'stacks:setSlideCrop',
  'stacks:setImageCrop',
  'stacks:undoImageCrop',
  'stacks:undo',
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
  'relations:createConnection',
  'relations:updateConnection',
  'relations:createLink',
  'relations:updateLink',
  'relations:setObjectLink',
  'relations:createComment',
  'relations:updateComment',
  'relations:addReply',
  'relations:editReply',
  'relations:deleteReply',
  'relations:setBoardView',
  'relations:integrity',
  'relations:repair',
  'relations:restore',
  'relations:fetchPreview',
  'window:flushed',
  'backup:status',
  'backup:create',
  'backup:verify',
  'backup:delete',
  'backup:restore',
  'backup:settings',
  'backup:saveSettings',
  'project:exportZip',
  'project:importZip',
  'board:exportPackage',
  'board:importPackage',
  'board:writePicture',
  'dialog:pickSaveZip',
  'dialog:pickZip',
  'dialog:pickSavePicture',
  'dialog:pickSaveBoardPackage',
  'dialog:pickBoardPackage',
  'search:query',
  'search:appearances',
  'search:rebuild',
  'search:nextPdf',
  'search:addPdfPage',
  'search:finishPdf',
  'tags:list',
  'tags:oneOffs',
  'tags:summary',
  'tags:create',
  'tags:createOneOff',
  'tags:removeOneOff',
  'tags:assign',
  'tags:unassign',
  'tags:addMany',
  'tags:removeMany',
  'tags:replaceDirect',
  'tags:revertAdd',
  'tags:revertRemove',
  'tags:revertReplace',
  'tags:rename',
  'tags:recolor',
  'tags:archive',
  'tags:unarchive',
  'tags:trash',
  'tags:restore',
  'tags:purge',
  'tags:merge',
  'tags:promote',
  'tags:visibility',
  'assets:get',
  'recovery:writeDraft',
  'recovery:clearDraft',
  'recovery:list',
  'collections:outline',
  'collections:templates',
  'collections:create',
  'collections:detail',
  'collections:rename',
  'collections:move',
  'collections:trash',
  'collections:restore',
  'collections:reorder',
  'collections:createFolder',
  'collections:renameFolder',
  'collections:moveFolder',
  'collections:trashFolder',
  'collections:restoreFolder',
  'collections:trashedFolders',
  'collections:trashedCollections',
  'collections:saveTemplate',
  'collections:renameTemplate',
  'collections:updateTemplate',
  'collections:insertPages',
  'collections:undoPages',
  'collections:reorderPages',
  'collections:orderPages',
  'collections:trashPages',
  'collections:restorePages',
  'collections:updatePage',
  'collections:setStage',
  'collections:lockSpread',
  'collections:unlockSpread',
  'collections:setSpan',
  'collections:updateSettings',
  'collections:rememberPlanner',
  'collections:placeCard',
  'collections:setAppearance',
  'collections:comments',
  'collections:addComment',
  'collections:links',
  'collections:addLink',
  'collections:search',
  'collections:applyBulk',
  'collections:undoBulk',
  'collections:stagePaths',
  'collections:commitImport',
  'collections:undoImport',
  'collections:versions',
  'collections:setDisplayed',
  'collections:addVersion',
  'collections:pageTags',
  'collections:relinkVersion',
  'collections:relinkFile',
  'collections:previewFolderMatch',
  'collections:applyFolderMatch',
  'collections:stageBoard',
  'collections:stageClipboard',
  'collections:setCrop',
  'collections:placePageLink',
  'collections:movePages',
  'collections:copyPages',
  'collections:reader',
  'collections:touchReader',
  'collections:nav',
  'collections:addNav',
  'collections:renameNav',
  'collections:removeNav',
  'collections:exportSequence',
  'collections:exportPackage',
  'collections:importPackage',
  'dialog:pickSaveCollection',
  'dialog:pickCollectionPackage'
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
