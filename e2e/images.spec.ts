import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import sharp from 'sharp'
import { cleanup, createProject, launchApp, objects, toScreen, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

/** A half-transparent PNG, written next to the test projects. */
async function makePng(name: string, width: number, height: number): Promise<string> {
  const bytes = await sharp({
    create: { width, height, channels: 4, background: { r: 200, g: 40, b: 90, alpha: 0.5 } }
  })
    .png()
    .toBuffer()
  const path = join(t.projectsDir, name)
  writeFileSync(path, bytes)
  return path
}

/** Stored originals in the project (assets/<xx>/<sha>.<ext>). */
function storedOriginals(): string[] {
  return readdirSync(t.projectsDir, { recursive: true, encoding: 'utf8' }).filter((p) =>
    /assets[\\/][0-9a-f]{2}[\\/][0-9a-f]{64}\.(png|jpg|webp)$/.test(p)
  )
}

async function pixelAt(page: Page, p: { x: number; y: number }) {
  const shot = await page.screenshot({
    clip: { x: Math.round(p.x), y: Math.round(p.y), width: 1, height: 1 }
  })
  const [r, g, b] = await sharp(shot).removeAlpha().raw().toBuffer()
  return { r, g, b, pinkish: r - g > 50 && r - b > 20 }
}

const images = async (page: Page = t.page) =>
  (await objects(page)).filter((o) => o.type === 'image')

/** Makes the next "Add images" file picker return these files. */
async function stubPicker(paths: string[]) {
  await t.app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never
  }, paths)
}

async function addImageWithToolbar(path: string) {
  await stubPicker([path])
  await t.page.getByRole('button', { name: 'Add images' }).click()
  await expect.poll(async () => (await images()).length).toBeGreaterThan(0)
}

/** Clicks the middle of an image (selecting it and focusing the canvas). */
async function clickImage(id: string) {
  const o = (await images()).find((x) => x.id === id)!
  const c = await toScreen(t.page, { x: o.x + o.width / 2, y: o.y + o.height / 2 })
  await t.page.mouse.click(c.x, c.y)
  return c
}

test('add an image from the toolbar: original stored byte-for-byte, thumbnails served', async () => {
  await createProject(t.page, t.projectsDir, 'Images')
  const source = await makePng('wide.png', 1600, 800)
  const sourceBytes = readFileSync(source)
  await addImageWithToolbar(source)

  const [image] = await images()
  // Large images arrive at most 800 canvas units on their longest side, proportionally.
  expect(image).toMatchObject({ width: 800, height: 400, rotation: 0 })
  expect(image.asset).toMatchObject({ width: 1600, height: 800, originalName: 'wide.png' })

  // The stored original is identical to the source, and the source is untouched.
  const [stored] = storedOriginals()
  expect(stored).toContain(`${sha256(sourceBytes)}.png`)
  expect(readFileSync(join(t.projectsDir, stored)).equals(sourceBytes)).toBe(true)
  expect(readFileSync(source).equals(sourceBytes)).toBe(true)

  // It's drawn on the canvas: the pixel in its middle is the image's pink, not the background.
  const middle = await toScreen(t.page, { x: image.x + 400, y: image.y + 200 })
  await expect.poll(() => pixelAt(t.page, middle)).toMatchObject({ pinkish: true })

  // The UI can load the thumbnail and the original through the asset protocol (and the CSP).
  const projectId = await t.page.evaluate(
    async () => (await window.api.invoke('project:current'))?.id
  )
  const base = `cw-asset://${projectId}/${image.asset!.sha256}`
  const loaded = await t.page.evaluate(
    (url) =>
      new Promise<number[]>((resolve, reject) => {
        const img = new Image()
        img.onload = () => resolve([img.naturalWidth, img.naturalHeight])
        img.onerror = reject
        img.src = url
      }),
    `${base}/256`
  )
  expect(loaded).toEqual([256, 128])
  const served = await t.app.evaluate(async ({ net }, url) => {
    const response = await net.fetch(url)
    return Buffer.from(await response.arrayBuffer()).toString('base64')
  }, `${base}/original`)
  expect(Buffer.from(served, 'base64').equals(sourceBytes)).toBe(true)
})

test('images resize proportionally, rotate with Shift snapping, and persist after restart', async () => {
  await createProject(t.page, t.projectsDir, 'Transform')
  await addImageWithToolbar(await makePng('banner.png', 600, 300))
  const [image] = await images()
  await clickImage(image.id)

  // Drag the bottom-right handle; the proportions stay 2:1.
  const corner = await toScreen(t.page, { x: image.x + image.width, y: image.y + image.height })
  await t.page.mouse.move(corner.x, corner.y)
  await t.page.mouse.down()
  await t.page.mouse.move(corner.x + 120, corner.y + 10, { steps: 8 })
  await t.page.mouse.up()
  await expect.poll(async () => (await images())[0].width).toBeGreaterThan(image.width + 20)
  const resized = (await images())[0]
  expect(resized.width / resized.height).toBeCloseTo(2, 2)

  // Drag the rotation handle (above the top edge) with Shift held: 15° steps.
  const top = await toScreen(t.page, { x: resized.x + resized.width / 2, y: resized.y })
  const middle = await toScreen(t.page, {
    x: resized.x + resized.width / 2,
    y: resized.y + resized.height / 2
  })
  const handle = { x: top.x, y: top.y - 24 }
  const radius = middle.y - handle.y
  const angle = (37 * Math.PI) / 180
  await t.page.mouse.move(handle.x, handle.y)
  await t.page.keyboard.down('Shift')
  await t.page.mouse.down()
  await t.page.mouse.move(
    middle.x + radius * Math.sin(angle),
    middle.y - radius * Math.cos(angle),
    {
      steps: 8
    }
  )
  await t.page.mouse.up()
  await t.page.keyboard.up('Shift')
  await expect.poll(async () => (await images())[0].rotation).not.toBe(0)
  const rotated = (await images())[0]
  expect(Math.abs(rotated.rotation % 15)).toBeLessThan(0.01)
  expect(rotated.rotation).toBeGreaterThanOrEqual(15)
  expect(rotated.rotation).toBeLessThanOrEqual(45)
  expect(rotated.width / rotated.height).toBeCloseTo(2, 2)

  // Undo the rotation, redo it.
  await t.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await images())[0].rotation).toBe(0)
  await t.page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => (await images())[0].rotation).toBe(rotated.rotation)

  const dirs = { dataDir: t.dataDir, projectsDir: t.projectsDir }
  await t.close()
  t = await launchApp(dirs)
  await t.page.getByRole('button', { name: /^Transform/ }).click()
  await t.page.getByTestId('canvas').waitFor()
  await expect
    .poll(async () => (await images())[0])
    .toMatchObject({
      x: rotated.x,
      y: rotated.y,
      width: rotated.width,
      height: rotated.height,
      rotation: rotated.rotation
    })
})

test('drop files onto the canvas; unsupported files explained; delete, undo, duplicate', async () => {
  await createProject(t.page, t.projectsDir, 'Drop')
  const png = readFileSync(await makePng('dropped.png', 400, 200)).toString('base64')
  const canvas = (await t.page.getByTestId('canvas').boundingBox())!

  // An image dragged from a browser has no file path: it's imported from its bytes.
  await t.page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'dropped.png', { type: 'image/png' }))
      data.items.add(new File(['hello'], 'notes.txt', { type: 'text/plain' }))
      const el = document.querySelector('[data-testid="canvas"]')!
      const init = { dataTransfer: data, bubbles: true, cancelable: true, clientX: x, clientY: y }
      el.dispatchEvent(new DragEvent('dragover', init))
      el.dispatchEvent(new DragEvent('drop', init))
    },
    { b64: png, x: canvas.x + 300, y: canvas.y + 250 }
  )
  await expect.poll(async () => (await images()).length).toBe(1)
  // A text file is stored as a file card. It is not rejected for not being an image.
  const dropped = await objects(t.page)
  const note = dropped.find((o) => o.type === 'file')
  expect(note?.asset?.originalName).toBe('notes.txt')

  // The image keeps its pixel size. The drop is the centre of the whole group.
  const [image] = await images()
  expect(image).toMatchObject({ width: 400, height: 200 })
  const minX = Math.min(...dropped.map((o) => o.x))
  const minY = Math.min(...dropped.map((o) => o.y))
  const maxX = Math.max(...dropped.map((o) => o.x + o.width))
  const maxY = Math.max(...dropped.map((o) => o.y + o.height))
  const center = await toScreen(t.page, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 })
  expect(Math.abs(center.x - (canvas.x + 300))).toBeLessThan(2)
  expect(Math.abs(center.y - (canvas.y + 250))).toBeLessThan(2)

  // Duplicating shares the stored file instead of copying it.
  await clickImage(image.id)
  await t.page.keyboard.press('ControlOrMeta+d')
  await expect.poll(async () => (await images()).length).toBe(2)
  const [a, b] = await images()
  expect(a.assetId).toBe(b.assetId)
  expect(storedOriginals()).toHaveLength(1)

  // Delete one; undo brings it back.
  await t.page.keyboard.press('Delete')
  await expect.poll(async () => (await images()).length).toBe(1)
  await t.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await images()).length).toBe(2)
  // Undoing the import too leaves an empty board, and redo restores it.
  await t.page.keyboard.press('ControlOrMeta+z')
  await t.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await images()).length).toBe(0)
  await t.page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(async () => (await images()).length).toBe(1)
})

test('a drop right after opening a board lands on the drop point, even if the window paints late', async () => {
  // A slow or throttled window reports the canvas size late. The canvas must still know its
  // size and camera straight away, and the camera mustn't jump once the report arrives.
  await t.page.context().addInitScript(() => {
    const Native = window.ResizeObserver
    window.ResizeObserver = class extends Native {
      constructor(callback: ResizeObserverCallback) {
        super((entries, observer) =>
          setTimeout(() => {
            callback(entries, observer)
            ;(window as never as { lateResizeReports: number }).lateResizeReports++
          }, 1500)
        )
      }
    }
    ;(window as never as { lateResizeReports: number }).lateResizeReports = 0
  })
  await createProject(t.page, t.projectsDir, 'Early drop')
  const png = readFileSync(await makePng('early.png', 400, 200)).toString('base64')
  const canvas = (await t.page.getByTestId('canvas').boundingBox())!
  await t.page.evaluate(
    ({ b64, x, y }) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
      const data = new DataTransfer()
      data.items.add(new File([bytes], 'early.png', { type: 'image/png' }))
      const el = document.querySelector('[data-testid="canvas"]')!
      const init = { dataTransfer: data, bubbles: true, cancelable: true, clientX: x, clientY: y }
      el.dispatchEvent(new DragEvent('dragover', init))
      el.dispatchEvent(new DragEvent('drop', init))
    },
    { b64: png, x: canvas.x + 300, y: canvas.y + 250 }
  )
  await expect.poll(async () => (await images()).length).toBe(1)
  const camera = () =>
    t.page.evaluate(() => (window as never as CanvasWindow).__cw.canvas.getState().viewport)
  const before = await camera()
  // Once the late size report arrives, the view stays where it was.
  await t.page.waitForFunction(
    () => (window as never as { lateResizeReports: number }).lateResizeReports > 0
  )
  expect(await camera()).toEqual(before)
  const [image] = await images()
  const center = await toScreen(t.page, { x: image.x + 200, y: image.y + 100 })
  expect(Math.abs(center.x - (canvas.x + 300))).toBeLessThan(2)
  expect(Math.abs(center.y - (canvas.y + 250))).toBeLessThan(2)
})

type CanvasWindow = { __cw: { canvas: { getState: () => { viewport: unknown } } } }

test('paste screenshots, Explorer files and copied images', async () => {
  await createProject(t.page, t.projectsDir, 'Paste')
  // Click empty canvas (the floating toolbar sits in the top-left corner) so shortcuts go to it.
  const canvas = (await t.page.getByTestId('canvas').boundingBox())!
  await t.page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await expect(t.page.getByTestId('canvas')).toBeFocused()
  expect(await objects(t.page)).toHaveLength(0)

  // A screenshot or an image copied in a browser: a bitmap on the clipboard.
  const screenshot = readFileSync(await makePng('shot.png', 300, 200)).toString('base64')
  await t.app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    const blob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }, screenshot)
  await t.page.keyboard.press('ControlOrMeta+v')
  await expect.poll(async () => (await images()).length).toBe(1)
  const [pasted] = await images()
  expect(pasted.asset!.originalName).toMatch(/^Pasted image .+\.png$/)
  expect(pasted).toMatchObject({ width: 300, height: 200 })

  // Copying an image in the app and pasting makes a copy that shares the stored file.
  await clickImage(pasted.id)
  await t.page.keyboard.press('ControlOrMeta+c')
  await t.page.keyboard.press('ControlOrMeta+v')
  await expect.poll(async () => (await images()).length).toBe(2)
  expect(new Set((await images()).map((o) => o.assetId)).size).toBe(1)

  // Files copied in Windows File Explorer.
  if (process.platform === 'win32') {
    const file = await makePng('from explorer.png', 500, 250)
    execFileSync('powershell', ['-NoProfile', '-Command', `Set-Clipboard -Path '${file}'`])
    await t.page.keyboard.press('ControlOrMeta+v')
    await expect.poll(async () => (await images()).length).toBe(3)
    const names = (await images()).map((o) => o.asset!.originalName)
    expect(names).toContain('from explorer.png')
    expect(storedOriginals()).toHaveLength(2)
  }

  // A link to a file on another computer (copied from a web page) is refused without being
  // opened: opening it would make Windows offer the user's login to that host.
  const before = (await images()).length
  await t.app.evaluate(async ({ clipboard, ClipboardItem }) => {
    const list = 'file://attacker.invalid/share/trap.png\r\nfile:////attacker.invalid/share/b.png'
    await clipboard.write([new ClipboardItem({ 'text/uri-list': new Blob([list]) })])
  })
  await t.page.keyboard.press('ControlOrMeta+v')
  await expect(t.page.getByRole('status')).toContainText('trap.png')
  await expect(t.page.getByRole('status')).toContainText('network locations')
  expect(await images()).toHaveLength(before)
})

test('the viewer ignores the double-click that opened it, even on a slow machine', async () => {
  await createProject(t.page, t.projectsDir, 'Viewer clicks')
  await addImageWithToolbar(await makePng('artwork.png', 2400, 1200))
  const [image] = await images()
  // Click to select, then double-click: the canvas sees its double-click on the first two
  // presses and opens the viewer, so the last press lands in the viewer.
  const c = await clickImage(image.id)
  await t.page.mouse.click(c.x, c.y)
  const viewer = t.page.getByRole('dialog', { name: 'artwork.png' })
  await expect(viewer).toBeVisible()
  const fit = viewer.getByRole('button', { name: 'Fit' })
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
  // A busy machine delivers that last press late; it still isn't a double-click in the viewer.
  await t.page.waitForTimeout(600)
  await t.page.mouse.down({ clickCount: 2 })
  await t.page.mouse.up({ clickCount: 2 })
  await expect(fit).toHaveAttribute('aria-pressed', 'true')

  // A real double-click in the viewer toggles between 100% and fit.
  await t.page.mouse.dblclick(c.x, c.y)
  await expect(viewer.getByLabel('Zoom level')).toHaveText('100%')
  await expect(fit).toHaveAttribute('aria-pressed', 'false')
  await t.page.mouse.dblclick(c.x, c.y)
  await expect(fit).toHaveAttribute('aria-pressed', 'true')
})

test('full-size viewer: open, download the original, close; second window shows images', async () => {
  await createProject(t.page, t.projectsDir, 'Viewer')
  const source = await makePng('artwork.png', 2400, 1200)
  await addImageWithToolbar(source)
  const [image] = await images()
  const c = await clickImage(image.id)
  await t.page.mouse.dblclick(c.x, c.y)

  const viewer = t.page.getByRole('dialog', { name: 'artwork.png' })
  await expect(viewer).toBeVisible()
  await expect(viewer).toContainText('2400 × 1200 px')
  await expect(viewer.getByRole('img', { name: 'artwork.png' })).toBeVisible()
  // It opens fitted to the window (a 2400 px image is shown below 100%).
  await expect(viewer.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true')
  const percent = parseInt((await viewer.getByLabel('Zoom level').textContent()) ?? '')
  expect(percent).toBeLessThan(100)
  await viewer.getByRole('button', { name: '100%' }).click()
  await expect(viewer.getByLabel('Zoom level')).toHaveText('100%')

  // Canvas shortcuts don't act behind the viewer.
  await t.page.keyboard.press('Delete')
  expect(await images()).toHaveLength(1)

  // "Download original" saves an exact copy.
  const dest = join(t.projectsDir, 'downloaded.png')
  await t.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, dest)
  await viewer.getByRole('button', { name: 'Download original' }).click()
  // The copy appears under its name only once it's complete.
  await expect.poll(() => existsSync(dest)).toBe(true)
  expect(readFileSync(dest).equals(readFileSync(source))).toBe(true)
  expect(readdirSync(t.projectsDir).filter((name) => name.endsWith('.part'))).toEqual([])

  await t.page.keyboard.press('Escape')
  await expect(viewer).toBeHidden()

  // Another window on the same board sees the image and its changes.
  const [second] = await Promise.all([
    t.app.waitForEvent('window'),
    t.page.getByRole('button', { name: 'Open in new window' }).click()
  ])
  await second.getByTestId('canvas').waitFor()
  await expect.poll(async () => (await images(second)).map((o) => o.id)).toEqual([image.id])
  await t.page.evaluate(
    (id) => window.api.invoke('objects:update', [{ id, rotation: 30 }]),
    image.id
  )
  await expect.poll(async () => (await images(second))[0].rotation).toBe(30)
})
