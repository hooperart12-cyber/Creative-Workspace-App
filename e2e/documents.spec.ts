import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { buildPdf } from '../src/main/project/buildPdf'
import { cleanup, createProject, launchApp, objects, toScreen, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

test('PDF cards open in a reader: pages, modes, search, outline, export, pop-out', async () => {
  test.setTimeout(90_000)
  await createProject(t.page, t.projectsDir, 'Docs')
  const pdf = buildPdf(['Hello PDF', 'Second page', 'Last page'], {
    outline: [{ title: 'Second', page: 2 }]
  })
  const pdfPath = join(t.projectsDir, 'chapter.pdf')
  const badPath = join(t.projectsDir, 'broken.pdf')
  writeFileSync(pdfPath, pdf)
  writeFileSync(badPath, '%PDF-1.4 this is not a real pdf')

  await t.app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never
    },
    [pdfPath, badPath]
  )
  await t.page.getByRole('button', { name: 'Add files' }).click()
  await expect
    .poll(async () => (await objects(t.page)).some((o) => o.type === 'document'))
    .toBe(true)
  await expect(t.page.getByRole('status')).toContainText('isn’t a valid PDF')
  const card = (await objects(t.page)).find((o) => o.type === 'document')!
  expect(card.asset).toMatchObject({
    originalName: 'chapter.pdf',
    pageCount: 3,
    width: 300,
    height: 400
  })
  expect(card.width / card.height).toBeCloseTo(300 / 400, 2)

  // The image tool does not import a PDF.
  await t.app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never
    },
    [pdfPath]
  )
  await t.page.getByRole('button', { name: 'Add images' }).click()
  await expect(t.page.getByRole('status')).toContainText('Not a JPG, PNG or WebP image')
  expect((await objects(t.page)).filter((o) => o.type === 'document')).toHaveLength(1)

  const viewport = await t.page.evaluate(
    () =>
      (
        window as unknown as {
          __cw: { canvas: { getState: () => { viewport: { x: number; y: number; zoom: number } } } }
        }
      ).__cw.canvas.getState().viewport
  )
  const center = await toScreen(t.page, { x: card.x + card.width / 2, y: card.y + card.height / 2 })
  await t.page.mouse.dblclick(center.x, center.y)
  const reader = t.page.getByRole('dialog', { name: 'PDF reader' })
  await expect(reader).toBeVisible()
  await expect(reader.getByRole('textbox', { name: 'Page', exact: true })).toHaveValue('1')
  await expect(reader.getByText('of 3')).toBeVisible()

  // Canvas shortcuts do not delete the card while the reader is open.
  await t.page.keyboard.press('Delete')
  expect((await objects(t.page)).filter((o) => o.type === 'document')).toHaveLength(1)

  await reader.getByRole('button', { name: 'Next page' }).click()
  await expect(reader.getByRole('textbox', { name: 'Page', exact: true })).toHaveValue('2')
  await reader.getByLabel('View mode').selectOption('single')
  await expect(reader.getByTestId('pdf-page')).toHaveCount(1)
  await reader.getByLabel('View mode').selectOption('spread')
  await expect(reader.getByLabel('Reading direction')).toBeVisible()
  // Page 2 sits in the pair with page 3.
  await expect(reader.getByTestId('pdf-page')).toHaveCount(2)
  await reader.getByLabel('Reading direction').selectOption('rtl')
  await expect(reader.getByTestId('pdf-page').first()).toHaveAttribute('data-page', '3')
  await reader.getByLabel('Reading direction').selectOption('ltr')
  await expect(reader.getByTestId('pdf-page').first()).toHaveAttribute('data-page', '2')
  await reader.getByLabel('View mode').selectOption('continuous')
  await reader.getByRole('button', { name: '100%' }).click()
  await expect(reader.getByLabel('Zoom level')).toHaveText('100%')
  await reader.getByRole('button', { name: 'Fit page' }).click()
  await expect(reader.getByRole('button', { name: 'Fit page' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await reader.getByRole('button', { name: 'Outline' }).click()
  await reader.getByRole('button', { name: 'Second' }).click()
  await expect(reader.getByRole('textbox', { name: 'Page', exact: true })).toHaveValue('2')

  await reader.getByRole('searchbox', { name: 'Search' }).fill('Last page')
  await reader.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(reader.getByLabel('Search results')).toHaveText('1 of 1')
  await expect(reader.locator('.pdf-hit').first()).toBeVisible()

  const dest = join(t.projectsDir, 'saved.pdf')
  await t.app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath })) as never
  }, dest)
  await reader.getByRole('button', { name: 'Save original as' }).click()
  await expect.poll(() => existsSync(dest)).toBe(true)
  expect(readFileSync(dest).equals(pdf)).toBe(true)

  const [popup] = await Promise.all([
    t.app.waitForEvent('window'),
    reader.getByRole('button', { name: 'Open in new window' }).click()
  ])
  await expect(popup.getByRole('dialog', { name: 'PDF reader' })).toBeVisible()
  await popup.getByLabel('View mode').selectOption('single')
  // The first window keeps its own mode.
  await expect(reader.getByLabel('View mode')).toHaveValue('continuous')
  await popup.close()
  await expect(t.page.getByTestId('canvas')).toBeVisible()
  await expect(reader).toBeVisible()

  await reader.getByRole('button', { name: 'Close' }).click()
  await expect(reader).toBeHidden()
  expect(
    await t.page.evaluate(
      () =>
        (
          window as unknown as {
            __cw: {
              canvas: { getState: () => { viewport: { x: number; y: number; zoom: number } } }
            }
          }
        ).__cw.canvas.getState().viewport
    )
  ).toEqual(viewport)

  // A long PDF only paints the pages on screen.
  const many = buildPdf(Array.from({ length: 40 }, (_, index) => `Marker ${index + 1}`))
  const manyPath = join(t.projectsDir, 'long.pdf')
  writeFileSync(manyPath, many)
  await t.page.evaluate(async (path) => {
    const win = window as unknown as {
      api: {
        invoke: (channel: string, ...args: unknown[]) => Promise<{ imported: { id: string }[] }>
      }
      __cw: { workspace: { getState: () => { board: { id: string } } } }
    }
    const result = await win.api.invoke('assets:importFiles', [path])
    const boardId = win.__cw.workspace.getState().board.id
    await win.api.invoke('objects:createFromAssets', {
      boardId,
      assetIds: result.imported.map((asset) => asset.id),
      center: { x: 900, y: 300 }
    })
  }, manyPath)
  await expect
    .poll(
      async () => (await objects(t.page)).filter((o) => o.asset?.originalName === 'long.pdf').length
    )
    .toBe(1)
  const longCard = (await objects(t.page)).find((o) => o.asset?.originalName === 'long.pdf')!
  await t.page.evaluate((object) => {
    const box = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect()
    const canvas = (
      window as unknown as {
        __cw: { canvas: { setState: (s: unknown) => void } }
      }
    ).__cw.canvas
    canvas.setState({
      viewport: {
        x: box.width / 2 - (object.x + object.width / 2),
        y: box.height / 2 - (object.y + object.height / 2),
        zoom: 1
      }
    })
  }, longCard)
  const longCenter = await toScreen(t.page, {
    x: longCard.x + longCard.width / 2,
    y: longCard.y + longCard.height / 2
  })
  await t.page.mouse.dblclick(longCenter.x, longCenter.y)
  const longReader = t.page.getByRole('dialog', { name: 'PDF reader' })
  await expect(longReader.getByText('of 40')).toBeVisible()
  await longReader.getByRole('button', { name: '100%' }).click()
  await expect(longReader.getByTestId('pdf-page').first()).toBeVisible()
  await expect.poll(async () => longReader.getByTestId('pdf-page').count()).toBeLessThanOrEqual(8)
  await longReader.getByRole('button', { name: 'Close' }).click()

  // A page with no text still opens. Search says so instead of inventing words.
  const scanPath = join(t.projectsDir, 'scan.pdf')
  writeFileSync(scanPath, buildPdf(['']))
  await t.page.evaluate(async (path) => {
    const win = window as unknown as {
      api: {
        invoke: (channel: string, ...args: unknown[]) => Promise<{ imported: { id: string }[] }>
      }
      __cw: { workspace: { getState: () => { board: { id: string } } } }
    }
    const result = await win.api.invoke('assets:importFiles', [path])
    const boardId = win.__cw.workspace.getState().board.id
    await win.api.invoke('objects:createFromAssets', {
      boardId,
      assetIds: result.imported.map((asset) => asset.id),
      center: { x: 1400, y: 300 }
    })
  }, scanPath)
  await expect
    .poll(
      async () => (await objects(t.page)).filter((o) => o.asset?.originalName === 'scan.pdf').length
    )
    .toBe(1)
  const scan = (await objects(t.page)).find((o) => o.asset?.originalName === 'scan.pdf')!
  await t.page.evaluate((object) => {
    const box = document.querySelector('[data-testid="canvas"]')!.getBoundingClientRect()
    const canvas = (window as unknown as { __cw: { canvas: { setState: (s: unknown) => void } } })
      .__cw.canvas
    canvas.setState({
      viewport: {
        x: box.width / 2 - (object.x + object.width / 2),
        y: box.height / 2 - (object.y + object.height / 2),
        zoom: 1
      }
    })
  }, scan)
  const scanCenter = await toScreen(t.page, {
    x: scan.x + scan.width / 2,
    y: scan.y + scan.height / 2
  })
  await t.page.mouse.dblclick(scanCenter.x, scanCenter.y)
  const scanReader = t.page.getByRole('dialog', { name: 'PDF reader' })
  await expect(scanReader.getByText('of 1')).toBeVisible()
  await scanReader.getByRole('searchbox', { name: 'Search' }).fill('hello')
  await scanReader.getByRole('button', { name: 'Search', exact: true }).click()
  await expect(scanReader.getByLabel('Search results')).toHaveText('No searchable text')
  await scanReader.getByRole('button', { name: 'Close' }).click()

  const projectPath = join(t.projectsDir, 'Docs.cwproj')
  await t.page.evaluate(async (path) => {
    const api = (
      window as unknown as { api: { invoke: (c: string, ...a: unknown[]) => Promise<unknown> } }
    ).api
    await api.invoke('project:close')
    await api.invoke('project:open', path)
  }, projectPath)
  await t.page.reload()
  await t.page.getByTestId('canvas').waitFor()
  await expect
    .poll(async () => (await objects(t.page)).filter((o) => o.type === 'document').length)
    .toBe(3)
})

test('generic files keep their bytes, take a preview, and are not launched when dangerous', async () => {
  test.setTimeout(90_000)
  await createProject(t.page, t.projectsDir, 'Files')
  const notePath = join(t.projectsDir, 'notes.txt')
  const exePath = join(t.projectsDir, 'tool.exe')
  writeFileSync(notePath, 'hello notes')
  writeFileSync(exePath, 'not a program')
  const png = await sharp({
    create: { width: 40, height: 20, channels: 3, background: { r: 20, g: 40, b: 200 } }
  })
    .png()
    .toBuffer()
  const pngPath = join(t.projectsDir, 'preview.png')
  writeFileSync(pngPath, png)

  await t.page.evaluate(
    async (paths) => {
      const win = window as unknown as {
        api: {
          invoke: (channel: string, ...args: unknown[]) => Promise<{ imported: { id: string }[] }>
        }
        __cw: { workspace: { getState: () => { board: { id: string } } } }
      }
      const result = await win.api.invoke('assets:importFiles', paths)
      await win.api.invoke('objects:createFromAssets', {
        boardId: win.__cw.workspace.getState().board.id,
        assetIds: result.imported.map((asset) => asset.id),
        center: { x: 320, y: 240 }
      })
    },
    [notePath, exePath]
  )
  await expect
    .poll(async () => (await objects(t.page)).filter((o) => o.type === 'file').length)
    .toBe(2)
  const note = (await objects(t.page)).find((o) => o.asset?.originalName === 'notes.txt')!
  const exe = (await objects(t.page)).find((o) => o.asset?.originalName === 'tool.exe')!
  expect(note.data).toMatchObject({ appearance: 'compact' })
  const stored = readdirSync(join(t.projectsDir, 'Files.cwproj'), {
    recursive: true,
    encoding: 'utf8'
  }).filter((p) => /assets[\\/][0-9a-f]{2}[\\/]/.test(p) && p.endsWith('.txt'))
  expect(stored).toHaveLength(1)
  expect(readFileSync(join(t.projectsDir, 'Files.cwproj', stored[0])).toString()).toBe(
    'hello notes'
  )

  const center = await toScreen(t.page, { x: note.x + note.width / 2, y: note.y + note.height / 2 })
  await t.page.mouse.dblclick(center.x, center.y)
  const details = t.page.getByRole('dialog', { name: 'File details' })
  await expect(details).toBeVisible()
  await t.app.evaluate(
    ({ dialog }, files) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never
    },
    [pngPath]
  )
  await details.getByRole('button', { name: 'Attach preview' }).click()
  await expect
    .poll(async () => (await objects(t.page)).find((o) => o.id === note.id)?.asset?.preview?.width)
    .toBe(40)
  await details.getByRole('button', { name: 'Preview', exact: true }).click()
  await expect
    .poll(async () => (await objects(t.page)).find((o) => o.id === note.id)?.data)
    .toMatchObject({
      appearance: 'preview'
    })
  // Switching appearance does not drop the preview.
  await details.getByRole('button', { name: 'Compact' }).click()
  expect((await objects(t.page)).find((o) => o.id === note.id)?.asset?.preview?.width).toBe(40)
  await details.getByRole('button', { name: 'Remove preview' }).click()
  await expect
    .poll(async () => (await objects(t.page)).find((o) => o.id === note.id)?.asset?.preview ?? null)
    .toBeNull()
  // The image asset is still in the library.
  const assetsOnDisk = readdirSync(join(t.projectsDir, 'Files.cwproj'), {
    recursive: true,
    encoding: 'utf8'
  }).filter((p) => /assets[\\/][0-9a-f]{2}[\\/]/.test(p) && p.endsWith('.png'))
  expect(assetsOnDisk).toHaveLength(1)

  await details.getByRole('button', { name: 'Close' }).click()
  const noteCenter = await toScreen(t.page, {
    x: note.x + note.width / 2,
    y: note.y + note.height / 2
  })
  await t.page.mouse.click(noteCenter.x, noteCenter.y)
  await t.page.keyboard.press('ControlOrMeta+d')
  await expect
    .poll(async () => (await objects(t.page)).filter((o) => o.assetId === note.assetId).length)
    .toBe(2)

  const exeCenter = await toScreen(t.page, { x: exe.x + exe.width / 2, y: exe.y + exe.height / 2 })
  await t.page.mouse.dblclick(exeCenter.x, exeCenter.y)
  const exeDetails = t.page.getByRole('dialog', { name: 'File details' })
  await expect(exeDetails.getByRole('button', { name: 'Open a copy' })).toBeDisabled()
  await t.app.evaluate(({ dialog }) => {
    const g = globalThis as { __asked?: boolean }
    g.__asked = false
    dialog.showOpenDialog = (async () => {
      g.__asked = true
      return { canceled: true, filePaths: [] }
    }) as never
  })
  await expect(
    t.page.evaluate((id) => window.api.invoke('assets:openCopy', id), exe.assetId!)
  ).rejects.toThrow()
  expect(await t.app.evaluate(() => (globalThis as { __asked?: boolean }).__asked)).toBe(false)

  // A safe file opens a copy and says edits do not come back.
  await exeDetails.getByRole('button', { name: 'Close' }).click()
  await t.page.mouse.dblclick(noteCenter.x, noteCenter.y)
  const copyDir = join(t.projectsDir, 'copies')
  const { mkdirSync } = await import('node:fs')
  mkdirSync(copyDir)
  await t.app.evaluate(({ dialog, shell }, dir) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir] })) as never
    shell.openPath = (async () => '') as never
  }, copyDir)
  await t.page
    .getByRole('dialog', { name: 'File details' })
    .getByRole('button', { name: 'Open a copy' })
    .click()
  await expect(t.page.getByRole('status')).toContainText('don’t update this project')
  expect(readFileSync(join(copyDir, 'notes.txt')).toString()).toBe('hello notes')
})
