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
    for (const owner of registry.ownersOf(project)) {
      const contents = webContents.fromId(owner)
      if (contents)
        BrowserWindow.fromWebContents(contents)?.setTitle(`${summary.name} — Creative Workspace`)
    }
    broadcastChanged(project)
    return summary
  })

  handle('recent:list', () => recent.list())
  handle('recent:remove', (_event, path) => recent.remove(path))

  handle('window:openNew', (event) => {
    const window = createWindow()
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
