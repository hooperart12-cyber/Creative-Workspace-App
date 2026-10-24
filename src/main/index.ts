import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { registerIpcHandlers, trackWindow } from './ipc'
import { ProjectRegistry } from './project/projectRegistry'
import { RecentProjects } from './project/recentProjects'
import { createWindow } from './windows'

// Database migrations ship next to the app (see electron-builder.yml extraResources).
const migrationsFolder = app.isPackaged
  ? join(process.resourcesPath, 'drizzle')
  : join(app.getAppPath(), 'drizzle')

const registry = new ProjectRegistry(migrationsFolder)

// Only one app instance; a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  void app.whenReady().then(() => {
    const recent = new RecentProjects(join(app.getPath('userData'), 'recent-projects.json'))
    registerIpcHandlers(registry, recent)
    trackWindow(createWindow(), registry)

    app.on('activate', () => {
      // macOS: re-create a window when the dock icon is clicked and none are open.
      if (BrowserWindow.getAllWindows().length === 0) trackWindow(createWindow(), registry)
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => registry.closeAll())
}
