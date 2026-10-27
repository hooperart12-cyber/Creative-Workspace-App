import { existsSync } from 'node:fs'
import { copyFile } from 'node:fs/promises'
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
import { NoteLeases } from './project/noteLeases'
import type { Project } from './project/project'
import type { ProjectRegistry } from './project/projectRegistry'
import type { RecentProjects } from './project/recentProjects'
import { createWindow } from './windows'

type Handler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: IpcRequests[C]['args']
) => IpcRequests[C]['result'] | Promise<IpcRequests[C]['result']>

function handle<C extends IpcChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...(args as IpcRequests[C]['args'])))
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
    return summary
  })

  handle('project:open', (event, path) => {
    releaseWindowLeases(event.sender.id)
    const summary = registry.open(event.sender.id, path).summary()
    recent.touch(summary)
    setWindowTitle(event, summary.name)
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

  handle('board:get', (event, id) => requireProject(event).boards.get(id))

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

  handle('objects:restore', (event, ids) => {
    const project = requireProject(event)
    project.objects.restore(ids)
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

  handle('folder:delete', (event, id) => {
    const project = requireProject(event)
    project.folders.delete(id)
    broadcastContent(project)
  })

  handle('recent:list', () => recent.list())
  handle('recent:remove', (_event, path) => recent.remove(path))

  handle('window:openNew', (event, options) => {
    const window = createWindow({ boardId: options?.boardId })
    const project = registry.share(event.sender.id, window.webContents.id)
    if (project) window.setTitle(`${project.summary().name} — Creative Workspace`)
    trackWindow(window, registry)
  })

  handle('window:openReader', (event, options) => {
    const window = createWindow({ pdfObjectId: options.objectId })
    const project = registry.share(event.sender.id, window.webContents.id)
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
    if (!isSafeLink(url)) throw new Error('Only web and email links can be opened.')
    await shell.openExternal(url)
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
