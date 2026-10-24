import { BrowserWindow, dialog, ipcMain, webContents, type IpcMainInvokeEvent } from 'electron'
import type { IpcChannel, IpcEventChannel, IpcEvents, IpcRequests } from '@shared/ipc'
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
    const board = project.boards.create(input.parentId, input.title)
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
    project.boards.delete(id)
    broadcastContent(project)
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

/** Releases a window's project when the window closes. */
export function trackWindow(window: BrowserWindow, registry: ProjectRegistry): void {
  const id = window.webContents.id
  window.on('closed', () => registry.release(id))
}
