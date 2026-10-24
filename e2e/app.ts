import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/** A running app with its own temporary settings folder and project folder. */
export interface TestApp {
  app: ElectronApplication
  page: Page
  dataDir: string
  projectsDir: string
  close: () => Promise<void>
}

export async function launchApp(dirs?: { dataDir: string; projectsDir: string }): Promise<TestApp> {
  const dataDir = dirs?.dataDir ?? mkdtempSync(join(tmpdir(), 'cw-e2e-data-'))
  const projectsDir = dirs?.projectsDir ?? mkdtempSync(join(tmpdir(), 'cw-e2e-projects-'))
  const app = await electron.launch({
    args: [resolve('.')],
    env: { ...process.env, CW_USER_DATA_DIR: dataDir, ELECTRON_RENDERER_URL: '' }
  })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page, dataDir, projectsDir, close: () => app.close() }
}

export function cleanup(t: TestApp): void {
  rmSync(t.dataDir, { recursive: true, force: true })
  rmSync(t.projectsDir, { recursive: true, force: true })
}

/** Creates a project directly through the app API (native folder pickers can't be automated). */
export async function createProject(page: Page, parentDir: string, name: string): Promise<void> {
  await page.evaluate(
    ([dir, n]) => window.api.invoke('project:create', { parentDir: dir, name: n }),
    [parentDir, name] as const
  )
  await page.reload()
  await page.getByTestId('canvas').waitFor()
}

export interface ObjectInfo {
  id: string
  title?: string
  x: number
  y: number
  width: number
  height: number
  linkedBoardId: string | null
}

/** Objects on the open board (the canvas draws to <canvas>, so read them from app state). */
export function objects(page: Page): Promise<ObjectInfo[]> {
  return page.evaluate(() =>
    (window as unknown as CwWindow).__cw.workspace.getState().board.objects.map((o) => ({
      id: o.id,
      title: o.board?.title,
      x: o.x,
      y: o.y,
      width: o.width,
      height: o.height,
      linkedBoardId: o.linkedBoardId
    }))
  )
}

/** Page coordinates of the centre of a card, from the canvas camera. */
export async function cardCenter(page: Page, title: string): Promise<{ x: number; y: number }> {
  const box = (await page.getByTestId('canvas').boundingBox())!
  const vp = await page.evaluate(
    () => (window as unknown as CwWindow).__cw.canvas.getState().viewport
  )
  const o = (await objects(page)).find((x) => x.title === title)
  if (!o) throw new Error(`No card titled ${title}`)
  return {
    x: box.x + (o.x + o.width / 2) * vp.zoom + vp.x,
    y: box.y + (o.y + o.height / 2) * vp.zoom + vp.y
  }
}

export async function breadcrumb(page: Page): Promise<string[]> {
  return page.getByRole('list', { name: 'Breadcrumb' }).getByRole('listitem').allTextContents()
}

/** Drags with intermediate moves, like a real hand (the canvas needs mousemove events). */
export async function dragTo(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number }
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
}

type CwWindow = Window & {
  __cw: {
    workspace: {
      getState: () => {
        board: {
          objects: {
            id: string
            x: number
            y: number
            width: number
            height: number
            linkedBoardId: string | null
            board?: { title: string }
          }[]
        }
      }
    }
    canvas: { getState: () => { viewport: { x: number; y: number; zoom: number } } }
  }
}
