import { join } from 'node:path'
import { BrowserWindow, shell } from 'electron'

export interface WindowOptions {
  /** Board to show first (passed to the renderer in the URL hash). */
  boardId?: string
  /** PDF card to open in the reader. This window does not replace the board window. */
  pdfObjectId?: string
}

/** Creates an app window. Each window navigates, zooms and scrolls independently (§2). */
export function createWindow(options: WindowOptions = {}): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: 'Creative Workspace',
    backgroundColor: '#f6f5f2',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  window.once('ready-to-show', () => window.show())
  // The main process sets the title (project name); don't let the page's <title> overwrite it.
  window.on('page-title-updated', (event) => event.preventDefault())

  // External links open in the default browser, never inside the app.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // Block navigation away from the app page (hash changes are allowed).
  window.webContents.on('will-navigate', (event, url) => {
    const strip = (u: string) => u.split('#')[0]
    if (strip(url) !== strip(window.webContents.getURL())) event.preventDefault()
  })

  const hash = options.pdfObjectId
    ? `pdf=${encodeURIComponent(options.pdfObjectId)}`
    : options.boardId
      ? `board=${encodeURIComponent(options.boardId)}`
      : ''
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    void window.loadURL(hash ? `${devServerUrl}#${hash}` : devServerUrl)
  } else {
    void window.loadFile(join(import.meta.dirname, '../renderer/index.html'), { hash })
  }
  return window
}
