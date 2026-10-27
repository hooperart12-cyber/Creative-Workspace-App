import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { buildPdf } from '../src/main/project/buildPdf'
import { cleanup, createProject, launchApp, objects, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

test('palette, note search, and a manual recovery point', async () => {
  await createProject(t.page, t.projectsDir, 'Recovery')
  const boardId = await t.page.evaluate(
    () =>
      (
        window as unknown as { __cw: { workspace: { getState: () => { board: { id: string } } } } }
      ).__cw.workspace.getState().board.id
  )
  await t.page.evaluate(
    (id) =>
      window.api.invoke('notes:create', {
        boardId: id,
        at: { x: 40, y: 40 },
        content: {
          schemaVersion: 1,
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'lighthouse sketch' }] }]
          }
        }
      }),
    boardId
  )
  await t.page.keyboard.press('Control+k')
  await expect(t.page.getByRole('dialog', { name: 'Command palette' })).toBeVisible()
  await t.page.keyboard.press('Escape')

  await t.page.getByRole('button', { name: 'Search', exact: true }).click()
  const search = t.page.getByTestId('search')
  await search.getByLabel('Project search').fill('lighthouse')
  await search.getByLabel('Project search').press('Enter')
  await search.getByRole('button', { name: /lighthouse sketch/ }).click()
  await expect(t.page.getByTestId('canvas')).toBeVisible()
  const note = (await objects(t.page)).find((object) => object.type === 'text')
  expect(note).toBeTruthy()
  await expect
    .poll(() =>
      t.page.evaluate(() => [
        ...(
          window as unknown as {
            __cw: { canvas: { getState: () => { selection: Set<string> } } }
          }
        ).__cw.canvas.getState().selection
      ])
    )
    .toEqual([note!.id])

  await t.page.getByRole('button', { name: 'Backup', exact: true }).click()
  const backup = t.page.getByRole('dialog', { name: 'Backup and recovery' })
  await backup.getByRole('button', { name: 'Back up now' }).click()
  await expect(backup.getByText('manual')).toBeVisible()
})

test('search opens a PDF page, an image with no card, and a board appearance', async () => {
  test.setTimeout(90_000)
  await createProject(t.page, t.projectsDir, 'Find')
  const boardId = await t.page.evaluate(
    () =>
      (
        window as unknown as { __cw: { workspace: { getState: () => { board: { id: string } } } } }
      ).__cw.workspace.getState().board.id
  )
  const pdfPath = join(t.projectsDir, 'chapter.pdf')
  const loosePath = join(t.projectsDir, 'loose.png')
  const placedPath = join(t.projectsDir, 'placed.png')
  writeFileSync(pdfPath, buildPdf(['alpha beacon', 'second page']))
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 10, g: 20, b: 30 } }
  })
    .png()
    .toFile(loosePath)
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: { r: 200, g: 10, b: 10 } }
  })
    .png()
    .toFile(placedPath)
  const imported = await t.page.evaluate(
    ([pdf, loose, placed]) =>
      window.api.invoke('library:importFiles', [pdf, loose, placed], {
        folderId: null,
        duplicates: 'skip'
      }),
    [pdfPath, loosePath, placedPath] as const
  )
  const placed = imported.imported.find((asset) => asset.originalName === 'placed.png')
  expect(placed).toBeTruthy()
  await t.page.evaluate(
    ([id, assetId]) =>
      window.api.invoke('objects:createFromAssets', {
        boardId: id,
        assetIds: [assetId],
        center: { x: 200, y: 200 }
      }),
    [boardId, placed!.id] as const
  )

  await expect
    .poll(
      () =>
        t.page.evaluate(
          async () =>
            (await window.api.invoke('search:query', { text: 'beacon', filter: 'pdf' })).hits
        ),
      {
        timeout: 30_000
      }
    )
    .toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'pdf-page', page: 1 })]))

  await t.page.getByRole('button', { name: 'Search', exact: true }).click()
  const search = t.page.getByTestId('search')
  await search.getByLabel('Project search').fill('beacon')
  await search.getByRole('button', { name: 'PDFs' }).click()
  await search.getByRole('button', { name: /chapter\.pdf/ }).click()
  const reader = t.page.getByRole('dialog', { name: 'PDF reader' })
  await expect(reader).toBeVisible()
  await expect(reader.getByTestId('pdf-page').first()).toHaveAttribute('data-page', '1')
  await reader.getByRole('button', { name: 'Close' }).click()

  await t.page.getByRole('button', { name: 'Search', exact: true }).click()
  await search.getByLabel('Project search').fill('loose')
  await search.getByRole('button', { name: 'Images' }).click()
  const before = (await objects(t.page)).length
  await search.getByRole('button', { name: /loose\.png/ }).click()
  await expect(t.page.getByRole('dialog', { name: 'loose.png' })).toBeVisible()
  expect((await objects(t.page)).length).toBe(before)
  await t.page.keyboard.press('Escape')

  await t.page.getByRole('button', { name: 'Search', exact: true }).click()
  await search.getByLabel('Project search').fill('placed')
  await search.getByRole('button', { name: 'Images' }).click()
  await search.getByRole('button', { name: 'Used on boards' }).click()
  await search.getByRole('button', { name: 'Find' }).click()
  await expect(t.page.getByTestId('canvas')).toBeVisible()
  await expect
    .poll(async () =>
      (await objects(t.page)).some((object) => object.asset?.originalName === 'placed.png')
    )
    .toBe(true)
})
