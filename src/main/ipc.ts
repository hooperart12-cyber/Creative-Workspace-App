import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  app,
  BrowserWindow,
  clipboard as systemClipboard,
  dialog,
  ipcMain,
  webContents,
  type IpcMainInvokeEvent
} from 'electron'
import { IMAGE_EXTENSIONS, SUPPORTED_IMAGES_LABEL } from '@shared/assets'
import type { IpcChannel, IpcEventChannel, IpcEvents, IpcRequests } from '@shared/ipc'
import type { ClipboardContents, ImportBytesInput } from '@shared/types'
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
    const project = registry.create(event.sender.id, input.parentDir, input.name)
    const summary = project.summary()
    recent.touch(summary)
    setWindowTitle(event, summary.name)
    return summary
  })

  handle('project:open', (event, path) => {
    const summary = registry.open(event.sender.id, path).summary()
    recent.touch(summary)
    setWindowTitle(event, summary.name)
    return summary
  })

  handle('project:close', (event) => {
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

  handle('assets:importFiles', async (event, paths) => {
    const project = requireProject(event)
    const result = await project.assets.importFiles(paths)
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

  const ownClipboard = async (): Promise<boolean> =>
    !!clipboard && (await systemClipboard.readText().catch(() => '')) === clipboard.marker

  handle('clipboard:get', async (event) => {
    const project = registry.get(event.sender.id)
    if (!project || clipboard?.projectPath !== project.path) return null
    return (await ownClipboard()) ? clipboard.contents : null
  })

  handle('clipboard:importExternal', async (event) => {
    const project = requireProject(event)
    if (await ownClipboard()) return null
    const content = await readExternalClipboard()
    if (!content) return null
    const result =
      content.kind === 'files'
        ? await project.assets.importFiles(content.paths)
        : await project.assets.importByteFiles([content.file])
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
}

/** Image types other programs put on the clipboard, best first (browsers and screenshots use PNG). */
const CLIPBOARD_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp']

/**
 * What another program copied: files (File Explorer / Finder list them as `file:` URLs)
 * or an image. Files win, because copying a file can also carry its icon as an image.
 */
async function readExternalClipboard(): Promise<
  { kind: 'files'; paths: string[] } | { kind: 'image'; file: ImportBytesInput } | null
> {
  try {
    const items = await systemClipboard.read()
    for (const item of items) {
      if (!item.types.includes('text/uri-list')) continue
      const list = await (await item.getType('text/uri-list')).text()
      const paths = list
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.startsWith('file:'))
        .map((url) => fileURLToPath(url))
      if (paths.length) return { kind: 'files', paths }
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

/** e.g. "Pasted image 2026-10-24 19.30.12.png" */
function pastedImageName(type: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}.${pad(d.getSeconds())}`
  return `Pasted image ${stamp}.${type === 'image/jpeg' ? 'jpg' : type.split('/')[1]}`
}

/** Releases a window's project when the window closes. */
export function trackWindow(window: BrowserWindow, registry: ProjectRegistry): void {
  const id = window.webContents.id
  window.on('closed', () => registry.release(id))
}
