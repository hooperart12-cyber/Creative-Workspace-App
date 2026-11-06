import { existsSync, mkdtempSync } from 'node:fs'
import { copyFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import {
  app,
  BrowserWindow,
  clipboard as systemClipboard,
  dialog,
  ipcMain,
  shell,
  webContents,
  type IpcMainInvokeEvent
} from 'electron'
import { IMAGE_EXTENSIONS, SUPPORTED_IMAGES_LABEL } from '@shared/assets'
import { isDangerousExtension } from '@shared/files'
import type { IpcChannel, IpcEventChannel, IpcEvents, IpcRequests } from '@shared/ipc'
import { isSafeLink } from '@shared/notes'
import type { ClipboardContents, ImportBytesInput, ImportResult } from '@shared/types'
import { localPathsFromUriList, REMOTE_FILE_REASON } from './clipboardFiles'
import { BackupService } from './project/backupService'
import { deleteRecoveryPoint, verifyPoint } from './project/backup'
import { removeDraft, takeDrafts, writeDraft, type NoteDraft } from './project/journal'
import { withProjectLock } from './project/lock'
import { NoteLeases } from './project/noteLeases'
import { exportBoardPackage, importBoardPackage } from './project/boardPackage'
import { exportCollectionPackage, importCollectionPackage } from './project/collectionPackage'
import { writeCollectionExport } from './project/collectionPictures'
import { writeBoardPicture } from './project/boardPicture'
import { extractComicEntries } from './project/comicArchive'
import { exportProjectZip, importProjectZip } from './project/projectZip'
import { stageCollectionPaths } from './project/stageCollectionImport'
import { restoreProject } from './project/restore'
import type { Project } from './project/project'
import type { ProjectRegistry } from './project/projectRegistry'
import type { RecentProjects } from './project/recentProjects'
import { createWindow } from './windows'

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcRequests[C]['args']
) => IpcRequests[C]['result'] | Promise<IpcRequests[C]['result']>

const SAVE_CHANNELS = new Set<string>([
  'project:rename',
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
  'assets:saveCover',
  'assets:recordPdfInfo',
  'assets:setPreview',
  'folder:create',
  'folder:rename',
  'folder:move',
  'folder:delete',
  'library:rename',
  'library:move',
  'library:trash',
  'library:restore',
  'library:importFiles',
  'library:importTree',
  'trash:restoreFolders',
  'trash:purge',
  'trash:empty',
  'notes:create',
  'notes:saveContent',
  'notes:updateStyle',
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
  'relations:repair',
  'relations:restore',
  'relations:fetchPreview',
  'board:importPackage',
  'collections:create',
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
  'collections:addComment',
  'collections:addLink',
  'collections:applyBulk',
  'collections:undoBulk',
  'collections:commitImport',
  'collections:undoImport',
  'collections:setDisplayed',
  'collections:setCrop',
  'collections:placePageLink',
  'collections:movePages',
  'collections:copyPages',
  'collections:touchReader',
  'collections:addNav',
  'collections:renameNav',
  'collections:removeNav',
  'collections:importPackage'
])

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, async (event, ...args) => {
    const saving = SAVE_CHANNELS.has(channel)
    if (saving) send(event.sender.id, 'save:state', { phase: 'saving', error: null })
    try {
      const result = await handler(event, ...(args as IpcRequests[C]['args']))
      if (saving)
        send(event.sender.id, 'save:state', { phase: 'saved', error: null, at: Date.now() })
      return result
    } catch (error) {
      if (saving) {
        send(event.sender.id, 'save:state', {
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error)
        })
      }
      throw error
    }
  })
}

function send<E extends IpcEventChannel>(
  webContentsId: number,
  event: E,
  payload: IpcEvents[E]
): void {
  const target = webContents.fromId(webContentsId)
  if (target && !target.isDestroyed()) target.send(event, payload)
}

export function registerIpcHandlers(registry: ProjectRegistry, recent: RecentProjects): void {
  const importCancel = new Map<number, { cancelled: boolean }>()
  const backups = new BackupService(app.getPath('userData'), () => registry.all())
  backups.start()
  const requireProject = (event: IpcMainInvokeEvent): Project => {
    const project = registry.get(event.sender.id)
    if (!project) throw new Error('No project is open in this window.')
    return project
  }

  /** Tells every window showing this project (including the sender) that it changed. */
  const broadcastChanged = (project: Project): void => {
    const summary = project.summary()
    for (const owner of registry.ownersOf(project)) send(owner, 'project:changed', summary)
  }

  /** Boards or folders changed: windows refetch their tree and current board. */
  const broadcastContent = (project: Project): void => {
    for (const owner of registry.ownersOf(project)) send(owner, 'project:contentChanged', null)
    broadcastChanged(project)
  }

  const setTitles = (project: Project, name: string): void => {
    for (const owner of registry.ownersOf(project)) {
      const contents = webContents.fromId(owner)
      if (contents)
        BrowserWindow.fromWebContents(contents)?.setTitle(`${name} — Creative Workspace`)
    }
  }

  const setWindowTitle = (event: IpcMainInvokeEvent, name?: string): void => {
    BrowserWindow.fromWebContents(event.sender)?.setTitle(
      name ? `${name} — Creative Workspace` : 'Creative Workspace'
    )
  }

  handle('dialog:pickDirectory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose where to create the project',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('dialog:pickProject', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Open a project (.cwproj folder)',
      properties: ['openDirectory']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle('project:create', (event, input) => {
    releaseWindowLeases(event.sender.id)
    const project = registry.create(event.sender.id, input.parentDir, input.name)
    const summary = project.summary()
    recent.touch(summary)
    setWindowTitle(event, summary.name)
    void backups.onOpened(project)
    return summary
  })

  handle('project:open', async (event, path) => {
    releaseWindowLeases(event.sender.id)
    const project = await registry.open(event.sender.id, path, {
      vaultFor: (id) => backups.vaultFor(id).root
    })
    const summary = project.summary()
    recent.touch(summary)
    setWindowTitle(event, summary.name)
    void backups.onOpened(project)
    return summary
  })

  handle('project:close', (event) => {
    releaseWindowLeases(event.sender.id)
    registry.release(event.sender.id)
    setWindowTitle(event)
  })

  handle('project:current', (event) => registry.get(event.sender.id)?.summary() ?? null)

  handle('project:rename', (event, name) => {
    const project = requireProject(event)
    const summary = project.rename(name)
    recent.touch(summary)
    setTitles(project, summary.name)
    broadcastContent(project)
    return summary
  })

  handle('tree:get', (event) => {
    const project = requireProject(event)
    return {
      mainBoardId: project.mainBoardId,
      boards: project.boards.list(),
      folders: project.folders.list()
    }
  })

  handle('board:get', (event, id) => {
    const project = requireProject(event)
    const board = project.tags.decorateBoard(project.stacks.attach(project.boards.get(id)))
    return {
      ...board,
      objects: project.collections.attach(project.relations.decorate(board.objects))
    }
  })

  handle('board:create', (event, input) => {
    const project = requireProject(event)
    const board = project.boards.create(input.parentId, input.title, input.at)
    broadcastContent(project)
    return board
  })

  handle('board:rename', (event, id, title) => {
    const project = requireProject(event)
    if (id === project.mainBoardId) {
      // The main board's title is the project name.
      const summary = project.rename(title)
      recent.touch(summary)
      setTitles(project, summary.name)
    } else {
      project.boards.rename(id, title)
    }
    broadcastContent(project)
  })

  handle('board:move', (event, id, newParentId) => {
    const project = requireProject(event)
    project.boards.move(id, newParentId)
    broadcastContent(project)
  })

  handle('board:delete', (event, id) => {
    const project = requireProject(event)
    const cardId = project.boards.cardIdOf(id)
    project.boards.delete(id)
    broadcastContent(project)
    return { cardId }
  })

  handle('board:setViewport', (event, id, viewport) => {
    requireProject(event).boards.setViewport(id, viewport)
  })

  // Every canvas edit is broadcast so other windows showing the project refresh.
  handle('objects:update', (event, patches) => {
    const project = requireProject(event)
    project.objects.update(patches)
    broadcastContent(project)
  })

  handle('objects:delete', (event, ids) => {
    const project = requireProject(event)
    project.objects.delete(ids)
    broadcastContent(project)
  })

  handle('objects:restore', (event, ids, boardId) => {
    const project = requireProject(event)
    project.objects.restore(ids, boardId)
    broadcastContent(project)
  })

  handle('objects:moveToBoard', (event, ids, targetBoardId, at) => {
    const project = requireProject(event)
    project.objects.moveToBoard(ids, targetBoardId, at)
    broadcastContent(project)
  })

  handle('objects:copyTo', (event, ids, targetBoardId, at) => {
    const project = requireProject(event)
    const created = project.objects.copyTo(ids, targetBoardId, at)
    broadcastContent(project)
    return created
  })

  handle('objects:createImages', (event, input) => {
    const project = requireProject(event)
    const ids = project.objects.createImages(input)
    broadcastContent(project)
    return ids
  })

  handle('objects:createFromAssets', (event, input) => {
    const project = requireProject(event)
    const ids = project.objects.createFromAssets(input)
    broadcastContent(project)
    return ids
  })

  handle('objects:read', (event, id) => {
    const project = requireProject(event)
    return project.objects.read(id)
  })

  handle('objects:setFileAppearance', (event, id, appearance) => {
    const project = requireProject(event)
    project.objects.setFileAppearance(id, appearance)
    broadcastContent(project)
  })

  const stackWrite = (event: IpcMainInvokeEvent, run: (project: Project) => void): void => {
    const project = requireProject(event)
    run(project)
    broadcastContent(project)
  }
  handle('stacks:createEmpty', (event, boardId, at) => {
    const project = requireProject(event)
    const result = project.stacks.createEmpty(boardId, at)
    broadcastContent(project)
    return result
  })
  handle('stacks:createFromObjects', (event, objectIds, mode) => {
    const project = requireProject(event)
    const result = project.stacks.createFromObjects(objectIds, mode)
    broadcastContent(project)
    return result
  })
  handle('stacks:createFromAssets', (event, boardId, assetIds, at) => {
    const project = requireProject(event)
    const result = project.stacks.createFromAssets(boardId, assetIds, at)
    broadcastContent(project)
    return result
  })
  handle('stacks:add', (event, input) => {
    const project = requireProject(event)
    const result = project.stacks.add(input)
    broadcastContent(project)
    return result
  })
  handle('stacks:remove', (event, stackId, slideId, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.remove(stackId, slideId, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:extract', (event, stackId, slideId, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.extract(stackId, slideId, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:reorder', (event, stackId, slideIds, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.reorder(stackId, slideIds, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:setCover', (event, stackId, slideId, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.setCover(stackId, slideId, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:setDisplayed', (event, stackId, slideId, expectedShown) => {
    stackWrite(event, (project) => project.stacks.setDisplayed(stackId, slideId, expectedShown))
  })
  handle('stacks:updateSettings', (event, stackId, patch, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.updateSettings(stackId, patch, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:unstack', (event, stackId, mode, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.unstack(stackId, mode, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:setSlideCrop', (event, stackId, slideId, crop, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.setSlideCrop(stackId, slideId, crop, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:setImageCrop', (event, objectId, crop, expectedRevision) => {
    const project = requireProject(event)
    const result = project.stacks.setImageCrop(objectId, crop, expectedRevision)
    broadcastContent(project)
    return result
  })
  handle('stacks:undoImageCrop', (event, undo) => {
    stackWrite(event, (project) => project.stacks.undoImageCrop(undo))
  })
  handle('stacks:undo', (event, undo) => {
    stackWrite(event, (project) => project.stacks.undo(undo))
  })

  handle('assets:importFiles', async (event, paths, options) => {
    const project = requireProject(event)
    const result = await project.assets.importFiles(paths, options)
    broadcastChanged(project)
    return result
  })

  handle('assets:importBytes', async (event, files) => {
    const project = requireProject(event)
    const result = await project.assets.importByteFiles(files)
    broadcastChanged(project)
    return result
  })

  handle('assets:saveOriginal', async (event, assetId) => {
    const project = requireProject(event)
    const asset = project.assets.get(assetId)
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(window, {
      title: 'Save original file',
      defaultPath: join(app.getPath('downloads'), asset.originalName)
    })
    if (result.canceled || !result.filePath) return false
    await project.assets.exportOriginal(assetId, result.filePath)
    return true
  })

  handle('assets:openCopy', async (event, assetId) => {
    const project = requireProject(event)
    const asset = project.assets.get(assetId)
    if (isDangerousExtension(asset.ext)) {
      throw new Error('This file type can’t be opened from the app.')
    }
    const window = BrowserWindow.fromWebContents(event.sender)!
    const picked = await dialog.showOpenDialog(window, {
      title: 'Choose a folder for the working copy',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const destination = uniquePath(picked.filePaths[0], asset.originalName)
    await copyFile(project.assets.originalPath(asset.sha256, asset.ext), destination)
    const error = await shell.openPath(destination)
    if (error) throw new Error(error)
    return destination
  })

  handle('assets:saveCover', async (event, assetId, png) => {
    const project = requireProject(event)
    await project.assets.saveCover(assetId, png)
    broadcastContent(project)
  })

  handle('assets:readRange', (event, assetId, start, end) => {
    const project = requireProject(event)
    return project.assets.readRange(assetId, start, end)
  })

  handle('assets:recordPdfInfo', (event, assetId, info) => {
    const project = requireProject(event)
    const before = project.assets.get(assetId)
    project.assets.recordPdfInfo(assetId, info)
    if (!before.width) project.objects.fitDocumentPages(assetId)
    broadcastContent(project)
  })

  handle('assets:setPreview', (event, assetId, previewAssetId) => {
    const project = requireProject(event)
    project.assets.setPreview(assetId, previewAssetId)
    broadcastContent(project)
  })

  handle('dialog:pickImages', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Add images',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: `Images (${SUPPORTED_IMAGES_LABEL})`, extensions: [...IMAGE_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  handle('dialog:pickFiles', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Add files',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'All files', extensions: ['*'] }]
    })
    return result.canceled ? [] : result.filePaths
  })

  // One clipboard for the whole app, so you can copy in one window and paste in another.
  // It only holds object ids, and is tied to the project they came from. Copying also puts
  // a short note on the system clipboard: if that note is gone, something newer was copied
  // elsewhere (a browser image, a screenshot, files) and Paste uses that instead.
  let clipboard: { projectPath: string; contents: ClipboardContents; marker: string } | null = null

  handle('clipboard:set', async (event, contents) => {
    const project = requireProject(event)
    if (!contents) {
      clipboard = null
      return
    }
    const count = contents.objectIds.length
    const marker = `${count} item${count === 1 ? '' : 's'} copied in Creative Workspace`
    await systemClipboard.writeText(marker)
    clipboard = { projectPath: project.path, contents, marker }
  })

  const ownClipboard = async (): Promise<boolean> => {
    if (!clipboard) return false
    const items = await readSystemClipboard()
    const text = items.find((item) => item.types.includes('text/plain'))
    if (!text) return false
    const value = await text
      .getType('text/plain')
      .then((blob) => blob.text())
      .catch(() => '')
    return value === clipboard.marker
  }

  handle('clipboard:get', async (event) => {
    const project = registry.get(event.sender.id)
    if (!project || clipboard?.projectPath !== project.path) return null
    return (await ownClipboard()) ? clipboard.contents : null
  })

  handle('clipboard:readText', () => systemClipboard.readText())

  handle('clipboard:importExternal', async (event) => {
    const project = requireProject(event)
    if (await ownClipboard()) return null
    const content = await readExternalClipboard()
    if (!content) return null
    let result: ImportResult
    if (content.kind === 'files') {
      result = await project.assets.importFiles(content.paths)
      // Links to other computers were never opened (see localPathsFromUriList).
      result.skipped.push(...content.remote.map((name) => ({ name, reason: REMOTE_FILE_REASON })))
    } else {
      result = await project.assets.importByteFiles([content.file])
    }
    broadcastChanged(project)
    return result
  })

  handle('folder:create', (event, input) => {
    const project = requireProject(event)
    const folder = project.folders.create(input.parentId, input.name)
    broadcastContent(project)
    return folder
  })

  handle('folder:rename', (event, id, name) => {
    const project = requireProject(event)
    project.folders.rename(id, name)
    broadcastContent(project)
  })

  handle('folder:move', (event, id, newParentId) => {
    const project = requireProject(event)
    project.folders.move(id, newParentId)
    broadcastContent(project)
  })

  handle('folder:delete', (event, id, mode = 'tree', renameConflicts = false) => {
    const project = requireProject(event)
    const renamed =
      mode === 'dissolve' ? project.library.dissolveFolder(id, renameConflicts).renamed : []
    if (mode !== 'dissolve') project.folders.delete(id)
    broadcastContent(project)
    return { renamed }
  })

  handle('folder:deletePreview', (event, id) => {
    const project = requireProject(event)
    return project.library.folderPreview(id)
  })

  handle('library:list', (event, query) => requireProject(event).library.list(query))
  handle('library:details', (event, id) => {
    const project = requireProject(event)
    return project.tags.decorateLibrary(project.library.details(id))
  })
  handle('library:rename', (event, id, name) => {
    const project = requireProject(event)
    const previous = project.library.rename(id, name)
    broadcastContent(project)
    return previous
  })
  handle('library:move', (event, ids, folderId) => {
    const project = requireProject(event)
    const previous = project.library.move(ids, folderId)
    broadcastContent(project)
    return previous
  })
  handle('library:trash', (event, ids) => {
    const project = requireProject(event)
    const result = project.library.trash(ids)
    broadcastContent(project)
    return result
  })
  handle('library:restore', (event, ids, destinationFolderId) => {
    const project = requireProject(event)
    const result = project.library.restoreEntries(ids, destinationFolderId)
    broadcastContent(project)
    return result
  })
  handle('library:entriesForAsset', (event, assetId) =>
    requireProject(event).library.entriesForAsset(assetId)
  )
  handle('library:storage', async (event) => {
    const project = requireProject(event)
    return project.library.storage(await project.assets.thumbnailBytes())
  })

  const runImport = async (
    event: IpcMainInvokeEvent,
    work: (signal: { cancelled: boolean }) => Promise<import('@shared/types').ImportResult>
  ) => {
    const project = requireProject(event)
    const signal = { cancelled: false }
    importCancel.set(event.sender.id, signal)
    try {
      const result = await work(signal)
      broadcastContent(project)
      return result
    } finally {
      importCancel.delete(event.sender.id)
    }
  }

  handle('library:importFiles', (event, paths, options) =>
    runImport(event, (signal) =>
      requireProject(event).assets.importPaths(paths, {
        ...options,
        signal,
        onProgress: (progress) => send(event.sender.id, 'library:importProgress', progress)
      })
    )
  )
  handle('library:importTree', (event, root, options) =>
    runImport(event, (signal) =>
      requireProject(event).assets.importTree(root, {
        ...options,
        signal,
        onProgress: (progress) => send(event.sender.id, 'library:importProgress', progress)
      })
    )
  )
  handle('library:cancelImport', (event) => {
    const signal = importCancel.get(event.sender.id)
    if (signal) signal.cancelled = true
  })

  const finishPurge = async (project: Project, result: ReturnType<Project['library']['purge']>) => {
    return withProjectLock(project.path, async () => {
      const unlinkErrors: string[] = []
      for (const file of result.removedFiles) {
        try {
          await project.assets.deleteStoredFiles(file.sha256, file.ext)
        } catch (error) {
          unlinkErrors.push(error instanceof Error ? error.message : String(error))
        }
      }
      broadcastContent(project)
      return { filesDeleted: result.filesDeleted, filesKept: result.filesKept, unlinkErrors }
    })
  }

  handle('trash:list', (event, kind) => requireProject(event).library.trashList(kind))
  handle('trash:restoreFolders', (event, ids, destinationParentId) => {
    const project = requireProject(event)
    const result = project.library.restoreFolders(ids, destinationParentId)
    broadcastContent(project)
    return result
  })
  handle('trash:purge', async (event, input) => {
    const project = requireProject(event)
    return finishPurge(project, project.library.purge(input))
  })
  handle('trash:empty', async (event) => {
    const project = requireProject(event)
    return finishPurge(project, project.library.emptyTrash())
  })

  handle('dialog:pickFolder', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Choose a folder to import',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  handle('recent:list', () => recent.list())
  handle('recent:remove', (_event, path) => recent.remove(path))

  handle('window:openNew', async (event, options) => {
    const window = createWindow({ boardId: options?.boardId })
    const project = await registry.share(event.sender.id, window.webContents.id)
    if (project) window.setTitle(`${project.summary().name} — Creative Workspace`)
    trackWindow(window, registry)
  })

  handle('window:openReader', async (event, options) => {
    const window = createWindow({ pdfObjectId: options.objectId })
    const project = await registry.share(event.sender.id, window.webContents.id)
    if (project) window.setTitle(`${project.summary().name} — Creative Workspace`)
    trackWindow(window, registry)
  })

  // ── Notes ──────────────────────────────────────────────────────────────────

  handle('notes:create', (event, input) => {
    const project = requireProject(event)
    const note = project.notes.create(input)
    broadcastContent(project)
    return note
  })

  // Text saves happen every second or so while typing: other windows refetch just that note.
  handle('notes:saveContent', (event, input) => {
    const project = requireProject(event)
    const result = project.notes.saveContent(input)
    const boardId = project.notes.boardOf(input.id)
    if (result.ok && boardId) {
      for (const owner of registry.ownersOf(project)) {
        send(owner, 'objects:changed', { boardId, objectIds: [input.id] })
      }
    }
    return result
  })

  handle('notes:updateStyle', (event, patches) => {
    const project = requireProject(event)
    project.notes.updateStyle(patches)
    broadcastContent(project)
  })

  handle('notes:get', (event, ids) => requireProject(event).notes.get(ids))

  handle('notes:lease', async (event, id, action) => {
    const project = requireProject(event)
    const owner = event.sender.id
    let ok = true
    if (action === 'acquire') ok = leases.acquire(project.path, id, owner).ok
    else if (action === 'release') leases.release(project.path, id, owner)
    else {
      const previous = leases.takeOver(project.path, id, owner)
      if (previous !== undefined && previous !== owner) {
        // Let the other window save what it has first, so this one starts from it.
        const key = `${project.path}\n${id}`
        await new Promise<void>((resolve) => {
          const timer = setTimeout(done, HANDOVER_TIMEOUT_MS)
          function done() {
            clearTimeout(timer)
            pendingHandover.delete(key)
            resolve()
          }
          pendingHandover.set(key, done)
          send(previous, 'notes:leaseLost', { objectId: id })
        })
      }
    }
    broadcastLeases(project)
    return { ok }
  })

  handle('notes:handedOver', (event, id) => {
    const project = registry.get(event.sender.id)
    if (project) pendingHandover.get(`${project.path}\n${id}`)?.()
  })

  handle('notes:editedElsewhere', (event) => {
    const project = registry.get(event.sender.id)
    return project ? leases.editedElsewhere(project.path, event.sender.id) : []
  })

  handle('links:open', async (_event, url) => {
    if (!isSafeLink(url) || url.startsWith('cw:'))
      throw new Error('Only web and email links can be opened.')
    await shell.openExternal(url)
  })

  handle('relations:createConnection', (event, boardId, data) => {
    const project = requireProject(event)
    const created = project.relations.createConnection(boardId, data.start, data.end, data)
    broadcastContent(project)
    return created
  })
  handle('relations:updateConnection', (event, id, baseRevision, data) => {
    const project = requireProject(event)
    const saved = project.relations.updateConnection(id, baseRevision, data)
    broadcastContent(project)
    return saved
  })
  handle('relations:createLink', (event, boardId, at, data) => {
    const project = requireProject(event)
    const created = project.relations.createLink(boardId, at, data)
    broadcastContent(project)
    return created
  })
  handle('relations:updateLink', (event, id, baseRevision, data) => {
    const project = requireProject(event)
    const saved = project.relations.updateLink(id, baseRevision, data)
    broadcastContent(project)
    return saved
  })
  handle('relations:setObjectLink', (event, id, baseRevision, destination) => {
    const project = requireProject(event)
    const saved = project.relations.setObjectLink(id, baseRevision, destination)
    broadcastContent(project)
    return saved
  })
  handle('relations:createComment', (event, boardId, at, data, body) => {
    const project = requireProject(event)
    const created = project.relations.createComment(boardId, at, data, body)
    broadcastContent(project)
    return created
  })
  handle('relations:updateComment', (event, id, baseRevision, data) => {
    const project = requireProject(event)
    const saved = project.relations.updateComment(id, baseRevision, data)
    broadcastContent(project)
    return saved
  })
  handle('relations:addReply', (event, id, baseRevision, body) => {
    const project = requireProject(event)
    const saved = project.relations.addReply(id, baseRevision, body)
    broadcastContent(project)
    return saved
  })
  handle('relations:editReply', (event, commentId, messageId, baseRevision, body) => {
    const project = requireProject(event)
    const saved = project.relations.editReply(commentId, messageId, baseRevision, body)
    broadcastContent(project)
    return saved
  })
  handle('relations:deleteReply', (event, commentId, messageId, baseRevision) => {
    const project = requireProject(event)
    const saved = project.relations.deleteReply(commentId, messageId, baseRevision)
    broadcastContent(project)
    return saved
  })
  handle('relations:setBoardView', (event, boardId, patch) => {
    const project = requireProject(event)
    project.relations.setBoardView(boardId, patch)
    broadcastContent(project)
  })
  handle('relations:integrity', (event) => requireProject(event).relations.integrity())
  handle('relations:repair', (event, id, action) => {
    const project = requireProject(event)
    const saved = project.relations.repair(id, action)
    broadcastContent(project)
    return saved
  })
  handle('relations:restore', (event, id, baseRevision, data, linkedBoardId) => {
    const project = requireProject(event)
    const saved = project.relations.restore(id, baseRevision, data, linkedBoardId)
    broadcastContent(project)
    return saved
  })
  handle('relations:fetchPreview', async (event, id, baseRevision) => {
    const project = requireProject(event)
    const { fetchLinkPreview } = await import('./project/linkPreview')
    const saved = await fetchLinkPreview(project, id, baseRevision)
    broadcastContent(project)
    return saved
  })

  handle('window:flushed', (event) => {
    const close = pendingClose.get(event.sender.id)
    pendingClose.delete(event.sender.id)
    close?.()
  })

  /** Tells each window of a project which notes other windows are editing. */
  const broadcastLeases = (project: Project): void => {
    for (const owner of registry.ownersOf(project)) {
      send(owner, 'notes:editedElsewhere', leases.editedElsewhere(project.path, owner))
    }
  }

  handle('backup:status', (event) => backups.status(requireProject(event)))
  handle('backup:create', (event) => backups.create(requireProject(event), 'manual'))
  handle('backup:verify', (event, id) => {
    const project = requireProject(event)
    return verifyPoint(backups.vaultFor(project.id).root, id, 'checksum')
  })
  handle('backup:delete', async (event, id) => {
    const project = requireProject(event)
    await deleteRecoveryPoint(backups.vaultFor(project.id).root, id)
  })
  handle('backup:restore', async (event, id, parentDir, name) => {
    const project = requireProject(event)
    const root = backups.vaultFor(project.id).root
    const manifest = (await backups.status(project)).points.find((point) => point.id === id)
    if (!manifest) throw new Error('That recovery point was not found.')
    return restoreProject({
      vaultRoot: root,
      manifest,
      parentDir,
      name,
      migrationsFolder: app.isPackaged
        ? join(process.resourcesPath, 'drizzle')
        : join(app.getAppPath(), 'drizzle'),
      vaultFor: (projectId) => backups.vaultFor(projectId).root
    })
  })
  handle('backup:settings', (event) => backups.settings(requireProject(event).id))
  handle('backup:saveSettings', (event, patch) =>
    backups.saveSettings(requireProject(event).id, patch)
  )
  handle('project:exportZip', async (event, destination) => {
    const project = requireProject(event)
    await withProjectLock(project.path, () =>
      exportProjectZip({ sqlite: project.connection, projectPath: project.path, destination })
    )
  })
  handle('board:exportPackage', async (event, boardId, destination, includeComments) => {
    const project = requireProject(event)
    await exportBoardPackage({ project, boardId, destination, includeComments })
  })
  handle('board:importPackage', async (event, zipPath, parentBoardId) => {
    const project = requireProject(event)
    const saved = await importBoardPackage({ project, zipPath, parentBoardId })
    broadcastContent(project)
    return saved
  })
  handle('board:writePicture', async (event, pngBase64, destination, format) => {
    requireProject(event)
    await writeBoardPicture({
      png: Buffer.from(pngBase64, 'base64'),
      destination,
      format
    })
  })
  handle('project:importZip', async (_event, zipPath, parentDir, name) =>
    importProjectZip({
      zipPath,
      parentDir,
      name,
      migrationsFolder: app.isPackaged
        ? join(process.resourcesPath, 'drizzle')
        : join(app.getAppPath(), 'drizzle'),
      vaultFor: (projectId) => backups.vaultFor(projectId).root
    })
  )
  handle('dialog:pickSaveZip', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(window, {
      title: 'Export project',
      filters: [{ name: 'Zip archive', extensions: ['zip'] }]
    })
    return result.canceled ? null : (result.filePath ?? null)
  })
  handle('dialog:pickZip', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Import a project archive',
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('dialog:pickSavePicture', async (event, format) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(window, {
      title: format === 'pdf' ? 'Export PDF' : 'Export PNG',
      filters: [
        format === 'pdf'
          ? { name: 'PDF', extensions: ['pdf'] }
          : { name: 'PNG', extensions: ['png'] }
      ]
    })
    return result.canceled ? null : (result.filePath ?? null)
  })
  handle('dialog:pickSaveCollection', async (event, kind) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(window, {
      title: kind === 'pdf' ? 'Export PDF' : 'Export collection package',
      filters:
        kind === 'pdf'
          ? [{ name: 'PDF', extensions: ['pdf'] }]
          : [{ name: 'Collection package', extensions: ['zip'] }]
    })
    return result.canceled ? null : (result.filePath ?? null)
  })
  handle('dialog:pickCollectionPackage', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Import a collection package',
      filters: [{ name: 'Collection package', extensions: ['zip'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('dialog:pickSaveBoardPackage', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showSaveDialog(window, {
      title: 'Export board package',
      filters: [{ name: 'Board package', extensions: ['zip'] }]
    })
    return result.canceled ? null : (result.filePath ?? null)
  })
  handle('dialog:pickBoardPackage', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)!
    const result = await dialog.showOpenDialog(window, {
      title: 'Import a board package',
      filters: [{ name: 'Board package', extensions: ['zip'] }],
      properties: ['openFile']
    })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  handle('search:query', (event, request) => requireProject(event).search.searchPage(request))
  handle('tags:list', (event, options) => requireProject(event).tags.list(options))
  handle('tags:oneOffs', (event) => requireProject(event).tags.listOneOffs())
  handle('tags:summary', (event, targets) => requireProject(event).tags.directSummary(targets))
  handle('tags:create', (event, name, color) => {
    const project = requireProject(event)
    const tag = project.tags.createReusable(name, color)
    broadcastContent(project)
    return tag
  })
  handle('tags:createOneOff', (event, name, target, color) => {
    const project = requireProject(event)
    const tag = project.tags.createOneOff(name, target, color)
    broadcastContent(project)
    return tag
  })
  handle('tags:removeOneOff', (event, id) => {
    const project = requireProject(event)
    project.tags.removeOneOff(id)
    broadcastContent(project)
  })
  handle('tags:assign', (event, tagId, target) => {
    const project = requireProject(event)
    const assignment = project.tags.assign(tagId, target)
    if (assignment.created) broadcastContent(project)
    return assignment
  })
  handle('tags:unassign', (event, tagId, target) => {
    const project = requireProject(event)
    const removed = project.tags.unassign(tagId, target)
    if (removed) broadcastContent(project)
    return removed
  })
  handle('tags:addMany', (event, tagIds, targets) => {
    const project = requireProject(event)
    const added = project.tags.addMany(tagIds, targets)
    if (added.length) broadcastContent(project)
    return added
  })
  handle('tags:removeMany', (event, tagIds, targets) => {
    const project = requireProject(event)
    const removed = project.tags.removeMany(tagIds, targets)
    if (removed.length) broadcastContent(project)
    return removed
  })
  handle('tags:replaceDirect', (event, tagIds, targets) => {
    const project = requireProject(event)
    const replaced = project.tags.replaceDirect(tagIds, targets)
    broadcastContent(project)
    return replaced
  })
  handle('tags:revertAdd', (event, ids) => {
    const project = requireProject(event)
    project.tags.revertAdd(ids)
    broadcastContent(project)
  })
  handle('tags:revertRemove', (event, rows) => {
    const project = requireProject(event)
    project.tags.revertRemove(rows)
    broadcastContent(project)
  })
  handle('tags:revertReplace', (event, targets, expectedIds, restore) => {
    const project = requireProject(event)
    project.tags.revertReplace(targets, expectedIds, restore)
    broadcastContent(project)
  })
  handle('tags:rename', (event, id, name) => {
    const project = requireProject(event)
    const tag = project.tags.rename(id, name)
    broadcastContent(project)
    return tag
  })
  handle('tags:recolor', (event, id, color) => {
    const project = requireProject(event)
    const tag = project.tags.recolor(id, color)
    broadcastContent(project)
    return tag
  })
  handle('tags:archive', (event, id) => {
    const project = requireProject(event)
    const tag = project.tags.archive(id)
    broadcastContent(project)
    return tag
  })
  handle('tags:unarchive', (event, id) => {
    const project = requireProject(event)
    const tag = project.tags.unarchive(id)
    broadcastContent(project)
    return tag
  })
  handle('tags:trash', (event, id) => {
    const project = requireProject(event)
    const result = project.tags.trash(id)
    broadcastContent(project)
    return result
  })
  handle('tags:restore', (event, id, name) => {
    const project = requireProject(event)
    const result = project.tags.restore(id, name)
    if (result.status === 'restored') broadcastContent(project)
    return result
  })
  handle('tags:purge', (event, id) => {
    const project = requireProject(event)
    const result = project.tags.purge(id)
    broadcastContent(project)
    return result
  })
  handle('tags:merge', (event, sourceId, destinationId) => {
    const project = requireProject(event)
    const result = project.tags.merge(sourceId, destinationId)
    broadcastContent(project)
    return result
  })
  handle('tags:promote', (event, id, choice) => {
    const project = requireProject(event)
    const result = project.tags.promote(id, choice)
    if (result.status === 'promoted') broadcastContent(project)
    return result
  })
  handle('tags:visibility', (event, boardId, visibility) => {
    const project = requireProject(event)
    project.tags.setVisibility(boardId, visibility)
    broadcastContent(project)
  })
  handle('search:appearances', (event, assetId) =>
    requireProject(event).search.appearances(assetId)
  )
  handle('search:rebuild', (event) => requireProject(event).search.rebuild())
  handle('search:nextPdf', (event) => requireProject(event).search.nextPdfJob())
  handle('search:addPdfPage', (event, assetId, page, text, title) => {
    requireProject(event).search.addPdfPage(assetId, page, text, title)
  })
  handle('search:finishPdf', (event, assetId, state, note) => {
    requireProject(event).search.finishPdf(assetId, state, note)
  })
  handle('assets:get', (event, id) => requireProject(event).assets.get(id))
  handle('recovery:writeDraft', (event, draft) => {
    writeDraft(requireProject(event).path, draft as NoteDraft)
  })
  handle('recovery:clearDraft', (event, objectId) => {
    removeDraft(requireProject(event).path, objectId)
  })
  handle('collections:outline', (event) => requireProject(event).collections.outline())
  handle('collections:templates', (event) => requireProject(event).collections.templates())
  handle('collections:create', (event, input) => {
    const project = requireProject(event)
    const created = project.collections.create(input)
    broadcastContent(project)
    return created
  })
  handle('collections:detail', (event, id) => requireProject(event).collections.detail(id))
  handle('collections:rename', (event, id, title) => {
    const project = requireProject(event)
    project.collections.rename(id, title)
    broadcastContent(project)
  })
  handle('collections:move', (event, id, folderId) => {
    const project = requireProject(event)
    project.collections.move(id, folderId)
    broadcastContent(project)
  })
  handle('collections:trash', (event, id) => {
    const project = requireProject(event)
    project.collections.trash(id)
    broadcastContent(project)
  })
  handle('collections:restore', (event, id) => {
    const project = requireProject(event)
    project.collections.restore(id)
    broadcastContent(project)
  })
  handle('collections:reorder', (event, kind, id, beforeId) => {
    const project = requireProject(event)
    project.collections.reorderSibling(kind, id, beforeId)
    broadcastContent(project)
  })
  handle('collections:createFolder', (event, parentId, name) => {
    const project = requireProject(event)
    const created = project.collections.createFolder(parentId, name)
    broadcastContent(project)
    return created
  })
  handle('collections:renameFolder', (event, id, name) => {
    const project = requireProject(event)
    project.collections.renameFolder(id, name)
    broadcastContent(project)
  })
  handle('collections:moveFolder', (event, id, parentId) => {
    const project = requireProject(event)
    project.collections.moveFolder(id, parentId)
    broadcastContent(project)
  })
  handle('collections:trashFolder', (event, id) => {
    const project = requireProject(event)
    project.collections.trashFolder(id)
    broadcastContent(project)
  })
  handle('collections:restoreFolder', (event, id) => {
    const project = requireProject(event)
    project.collections.restoreFolder(id)
    broadcastContent(project)
  })
  handle('collections:trashedFolders', (event) => {
    return requireProject(event).collections.trashedFolders()
  })
  handle('collections:trashedCollections', (event) => {
    return requireProject(event).collections.trashedCollections()
  })
  handle('collections:saveTemplate', (event, name, collectionId) => {
    const project = requireProject(event)
    const saved = project.collections.saveTemplate(name, collectionId)
    broadcastContent(project)
    return saved
  })
  handle('collections:renameTemplate', (event, id, name) => {
    const project = requireProject(event)
    project.collections.renameTemplate(id, name)
    broadcastContent(project)
  })
  handle('collections:updateTemplate', (event, id, data) => {
    const project = requireProject(event)
    project.collections.updateTemplate(id, data)
    broadcastContent(project)
  })
  handle('collections:insertPages', (event, input) => {
    const project = requireProject(event)
    const inserted = project.collections.insertPages(input)
    broadcastContent(project)
    return inserted
  })
  handle('collections:undoPages', (event, pageIds) => {
    const project = requireProject(event)
    project.collections.undoPages(pageIds)
    broadcastContent(project)
  })
  handle('collections:reorderPages', (event, collectionId, pageIds, beforeId) => {
    const project = requireProject(event)
    project.collections.reorder(collectionId, pageIds, beforeId)
    broadcastContent(project)
  })
  handle('collections:orderPages', (event, collectionId, pageIds) => {
    const project = requireProject(event)
    project.collections.orderPages(collectionId, pageIds)
    broadcastContent(project)
  })
  handle('collections:trashPages', (event, pageIds) => {
    const project = requireProject(event)
    const trashed = project.collections.trashPages(pageIds)
    broadcastContent(project)
    return trashed
  })
  handle('collections:restorePages', (event, pageIds) => {
    const project = requireProject(event)
    const restored = project.collections.restorePages(pageIds)
    broadcastContent(project)
    return restored
  })
  handle('collections:updatePage', (event, id, revision, patch, base) =>
    requireProject(event).collections.updatePage(id, revision, patch, base)
  )
  handle('collections:setStage', (event, pageId, stageId, state, note) => {
    requireProject(event).collections.setStage(pageId, stageId, state, note ?? '')
  })
  handle('collections:lockSpread', (event, pageId, partnerId) => {
    const project = requireProject(event)
    const locked = project.collections.lockSpread(pageId, partnerId)
    broadcastContent(project)
    return locked
  })
  handle('collections:unlockSpread', (event, pageId) => {
    const project = requireProject(event)
    project.collections.unlockSpread(pageId)
    broadcastContent(project)
  })
  handle('collections:setSpan', (event, pageId, span) => {
    const project = requireProject(event)
    project.collections.setSpan(pageId, span)
    broadcastContent(project)
  })
  handle('collections:updateSettings', (event, id, patch) => {
    const project = requireProject(event)
    project.collections.updateSettings(id, patch)
    broadcastContent(project)
  })
  handle('collections:rememberPlanner', (event, id, patch) => {
    requireProject(event).collections.rememberPlanner(id, patch)
  })
  handle('collections:placeCard', (event, boardId, collectionId) => {
    const project = requireProject(event)
    const card = project.collections.createAppearance(boardId, collectionId)
    broadcastContent(project)
    return card
  })
  handle('collections:setAppearance', (event, objectId, patch) => {
    const project = requireProject(event)
    project.collections.setAppearance(objectId, patch)
    broadcastContent(project)
  })
  handle('collections:comments', (event, pageId) =>
    requireProject(event).collections.comments(pageId)
  )
  handle('collections:addComment', (event, pageId, body) => {
    const project = requireProject(event)
    return project.collections.addComment(pageId, body)
  })
  handle('collections:links', (event, pageId) => requireProject(event).collections.links(pageId))
  handle('collections:addLink', (event, pageId, destination) =>
    requireProject(event).collections.addLink(pageId, destination)
  )
  handle('collections:search', (event, collectionId, query) =>
    requireProject(event).collections.search(collectionId, query)
  )
  handle('collections:applyBulk', (event, ids, operation, confirmReplace) => {
    const project = requireProject(event)
    const result = project.collections.applyBulk(ids, operation, confirmReplace)
    broadcastContent(project)
    return result
  })
  handle('collections:undoBulk', (event, entries) => {
    const project = requireProject(event)
    project.collections.undoBulk(entries)
    broadcastContent(project)
  })
  handle('collections:stagePaths', (_event, paths) => stageCollectionPaths(paths))
  handle('collections:commitImport', async (event, collectionId, beforeId, files, actions) => {
    const project = requireProject(event)
    const needed = new Set(actions.flatMap((action) => action.names))
    const chosen = files.filter((file) => file.accepted && needed.has(file.name))
    const temp = mkdtempSync(join(tmpdir(), 'cw-import-'))
    try {
      const paths = new Map<string, string>()
      const archives = new Map<string, typeof chosen>()
      for (const file of chosen) {
        if (file.filePath) paths.set(file.name, file.filePath)
        else if (file.archive) {
          const list = archives.get(file.archive.zipPath) ?? []
          list.push(file)
          archives.set(file.archive.zipPath, list)
        }
      }
      for (const [zipPath, entries] of archives) {
        const extracted = await extractComicEntries(
          zipPath,
          entries.map((entry) => entry.archive?.entry ?? ''),
          temp
        )
        for (const entry of entries) {
          const full = entry.archive ? extracted.get(entry.archive.entry) : undefined
          if (!full) throw new Error('A staged file was not in the archive.')
          paths.set(entry.name, full)
        }
      }
      const assetIds = new Map<string, string>()
      for (const [name, path] of paths) {
        const result = await project.assets.importFiles([path])
        const asset = result.imported[0]
        if (!asset) throw new Error(result.skipped[0]?.reason ?? `${name} was not imported.`)
        assetIds.set(name, asset.id)
      }
      const committed = actions.map((action) => {
        const assets = action.names.map((name) => {
          const assetId = assetIds.get(name)
          if (!assetId) throw new Error(`${name} was not imported.`)
          return { assetId, name }
        })
        return action.kind === 'fill'
          ? { kind: 'fill' as const, pageId: action.pageId, assets }
          : { kind: 'page' as const, assets }
      })
      const record = project.collections.commitImport(collectionId, beforeId, committed)
      broadcastContent(project)
      return record
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })
  handle('collections:undoImport', (event, record) => {
    const project = requireProject(event)
    project.collections.undoImport(record)
    broadcastContent(project)
  })
  handle('collections:versions', (event, pageId) =>
    requireProject(event).collections.versions(pageId)
  )
  handle('collections:setDisplayed', (event, pageId, versionId, revision) => {
    const project = requireProject(event)
    const saved = project.collections.setDisplayed(pageId, versionId, revision)
    broadcastContent(project)
    return saved
  })
  handle('collections:setCrop', (event, versionId, crop) => {
    const project = requireProject(event)
    project.collections.setCrop(versionId, crop)
    broadcastContent(project)
  })
  handle('collections:placePageLink', (event, boardId, collectionId, pageId) => {
    const project = requireProject(event)
    const page = project.collections.pages(collectionId).find((item) => item.id === pageId)
    if (!page) throw new Error('That page is not in this collection.')
    const link = project.relations.createLink(
      boardId,
      { x: 80, y: 80 },
      {
        version: 1,
        title: page.title || 'Page',
        destination: { kind: 'page', collectionId, pageId, title: page.title || 'Page' }
      }
    )
    broadcastContent(project)
    return { id: link.id }
  })
  handle('collections:movePages', (event, pageIds, toCollectionId, beforeId) => {
    const project = requireProject(event)
    const moved = project.collections.movePages(pageIds, toCollectionId, beforeId)
    broadcastContent(project)
    return {
      unmapped: moved.unmapped.map((stage) => ({
        pageId: stage.pageId,
        stageName: stage.stageName,
        note: stage.note
      }))
    }
  })
  handle('collections:copyPages', (event, pageIds, toCollectionId, beforeId) => {
    const project = requireProject(event)
    const copied = project.collections.copyPages(pageIds, toCollectionId, beforeId)
    broadcastContent(project)
    return { pageIds: copied.pageIds }
  })
  handle('collections:reader', (event, collectionId) =>
    requireProject(event).collections.reader(collectionId)
  )
  handle('collections:touchReader', (event, collectionId, state) => {
    requireProject(event).collections.touchReader(collectionId, state)
  })
  handle('collections:nav', (event, collectionId) =>
    requireProject(event).collections.nav(collectionId)
  )
  handle('collections:addNav', (event, collectionId, pageId, kind, title) => {
    const project = requireProject(event)
    const created = project.collections.addNav(collectionId, pageId, kind, title)
    broadcastContent(project)
    return created
  })
  handle('collections:renameNav', (event, id, title) => {
    const project = requireProject(event)
    project.collections.renameNav(id, title)
    broadcastContent(project)
  })
  handle('collections:removeNav', (event, id) => {
    const project = requireProject(event)
    project.collections.removeNav(id)
    broadcastContent(project)
  })
  handle(
    'collections:exportSequence',
    (event, collectionId, destination, format, spread, omitUnavailable) =>
      writeCollectionExport({
        project: requireProject(event),
        collectionId,
        destination,
        format,
        spread,
        omitUnavailable
      })
  )
  handle('collections:exportPackage', (event, collectionId, destination, includeComments) =>
    exportCollectionPackage({
      project: requireProject(event),
      collectionId,
      destination,
      includeComments
    })
  )
  handle('collections:importPackage', async (event, zipPath) => {
    const project = requireProject(event)
    const imported = await importCollectionPackage(project, zipPath)
    broadcastContent(project)
    return imported
  })

  handle('recovery:list', (event) => {
    const project = requireProject(event)
    return takeDrafts(project.path, (objectId) => {
      const row = project.connection
        .prepare('SELECT revision, data FROM board_objects WHERE id = ?')
        .get(objectId) as { revision: number; data: string } | undefined
      if (!row) return null
      const data = JSON.parse(row.data) as { content?: unknown }
      return { revision: row.revision, contentJson: JSON.stringify(data.content ?? null) }
    }).map((item) => {
      const board = project.connection
        .prepare('SELECT board_id FROM board_objects WHERE id = ?')
        .get(item.draft.objectId) as { board_id: string } | undefined
      return {
        objectId: item.draft.objectId,
        baseRevision: item.draft.baseRevision,
        plainText: item.draft.plainText,
        writtenAt: item.draft.writtenAt,
        assessment: item.assessment.kind as 'restore' | 'conflict' | 'missing',
        boardId: board?.board_id ?? null,
        contentJson: JSON.stringify(item.draft.content)
      }
    })
  })

  releaseWindowLeases = (owner: number): void => {
    const project = registry.get(owner)
    if (leases.releaseOwner(owner) && project) {
      for (const other of registry.ownersOf(project)) {
        if (other !== owner) {
          send(other, 'notes:editedElsewhere', leases.editedElsewhere(project.path, other))
        }
      }
    }
  }
}

const leases = new NoteLeases()
/** Windows waiting to close until they've saved their open note. */
const pendingClose = new Map<number, () => void>()

/**
 * A quit closes every window, but a window that's editing a note pauses its close to save first,
 * and pausing it cancels the quit. macOS won't quit on its own when the last window closes, so
 * the quit would be lost. Remember it, and finish it once the window has saved and closed.
 */
let quitRequested = false
app.on('before-quit', () => {
  quitRequested = true
})
/** Take-overs waiting for the previous editor to save, by project path and note id. */
const pendingHandover = new Map<string, () => void>()
const HANDOVER_TIMEOUT_MS = 3000
let releaseWindowLeases: (owner: number) => void = () => {}

/** Image types other programs put on the clipboard, best first (browsers and screenshots use PNG). */
const CLIPBOARD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * What another program copied: files (File Explorer / Finder list them as `file:` URLs)
 * or an image. Files win, because copying a file can also carry its icon as an image.
 */
async function readExternalClipboard(): Promise<
  | { kind: 'files'; paths: string[]; remote: string[] }
  | { kind: 'image'; file: ImportBytesInput }
  | null
> {
  try {
    const items = await readSystemClipboard()
    for (const item of items) {
      if (!item.types.includes('text/uri-list')) continue
      const list = await (await item.getType('text/uri-list')).text()
      const { paths, remote } = localPathsFromUriList(list)
      if (paths.length || remote.length) return { kind: 'files', paths, remote }
    }
    for (const item of items) {
      const type = CLIPBOARD_IMAGE_TYPES.find((t) => item.types.includes(t))
      if (!type) continue
      const blob = (await item.getType(type)) as Blob
      const bytes = new Uint8Array(await blob.arrayBuffer())
      return { kind: 'image', file: { name: pastedImageName(type), bytes } }
    }
  } catch {
    // An unreadable clipboard just means there's nothing to paste.
  }
  return null
}

/**
 * Right after something is copied, another program (Windows clipboard history, a clipboard
 * manager) may hold the clipboard for a moment and a read comes back empty. Retry briefly.
 */
async function readSystemClipboard(): Promise<Electron.ClipboardItem[]> {
  const read = () => systemClipboard.read().catch(() => [])
  let items = await read()
  for (const delay of [50, 150, 300]) {
    if (items.some((item) => item.types.length > 0)) break
    await new Promise((resolve) => setTimeout(resolve, delay))
    items = await read()
  }
  return items
}

/** e.g. "Pasted image 2026-10-24 19.30.12.png" */
function pastedImageName(type: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
  return `Pasted image ${stamp}.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`
}

/** How long a closing window may take to save an open note before it closes anyway. */
const FLUSH_TIMEOUT_MS = 4000

/**
 * Releases a window's project when the window closes. A window that is editing a note
 * first gets a moment to save it.
 */
export function trackWindow(window: BrowserWindow, registry: ProjectRegistry): void {
  const id = window.webContents.id
  let asked = false
  window.on('close', (event) => {
    if (asked || !leases.holds(id) || window.webContents.isDestroyed()) return
    asked = true
    event.preventDefault()
    pendingClose.set(id, () => window.close())
    send(id, 'window:flushRequest', null)
    setTimeout(() => {
      if (pendingClose.delete(id) && !window.isDestroyed()) window.close()
    }, FLUSH_TIMEOUT_MS)
  })
  window.on('closed', () => {
    pendingClose.delete(id)
    releaseWindowLeases(id)
    registry.release(id)
    if (asked && quitRequested) {
      quitRequested = false
      app.quit()
    }
  })
}

/** A path in `folder` that doesn't already exist, so a working copy never overwrites a file. */
function uniquePath(folder: string, name: string): string {
  const ext = extname(name)
  const stem = basename(name, ext)
  let candidate = join(folder, name || 'file')
  for (let n = 2; existsSync(candidate); n++) {
    candidate = join(folder, `${stem} (${n})${ext}`)
  }
  return candidate
}
