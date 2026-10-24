import { app, Menu, type MenuItemConstructorOptions } from 'electron'

/**
 * Application menu. Electron's default menu includes page zoom (Ctrl+= / Ctrl+-), which
 * would zoom the whole window instead of the canvas, and Reload, which shouldn't ship.
 * The Edit roles stay so copy/paste/undo work in text fields (the canvas handles its own).
 */
export function installAppMenu(): void {
  const isMac = process.platform === 'darwin'
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(app.isPackaged
          ? []
          : ([{ role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' }] as const)),
        { role: 'togglefullscreen' }
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
