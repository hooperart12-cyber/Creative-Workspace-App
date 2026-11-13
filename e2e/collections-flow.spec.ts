import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import sharp from 'sharp'
import { cleanup, createProject, launchApp, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

async function panReader(page: import('@playwright/test').Page): Promise<void> {
  await page
    .locator('#page-reader .relative')
    .last()
    .evaluate((node) => {
      const fire = (type: string, x: number, y: number) =>
        node.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }))
      fire('mousedown', 40, 40)
      fire('mousemove', 120, 90)
      fire('mouseup', 120, 90)
    })
}

test('creates, reopens, imports, crops, edits, and exports a collection', async () => {
  test.setTimeout(120_000)
  const page = t.page
  await createProject(page, t.projectsDir, 'Collections')
  await page.getByRole('button', { name: 'New collection', exact: true }).click()
  await page.getByLabel('Collection name').fill('Chapter Two')
  await page.getByLabel('Collection template').selectOption({ label: 'Manga' })
  await page.getByLabel('Starting page count').fill('2')
  await page.getByRole('button', { name: 'Create and open' }).click()
  await expect(page.locator('#page-planner')).toBeVisible()
  await page.getByRole('button', { name: 'Back to canvas' }).click()
  await page.getByTestId('canvas').waitFor()
  await page.getByText('Chapter Two', { exact: true }).click()
  await expect(page.locator('#page-planner')).toBeVisible()

  const art = join(t.projectsDir, 'page.png')
  const other = join(t.projectsDir, 'other.png')
  writeFileSync(
    art,
    await sharp({ create: { width: 40, height: 20, channels: 3, background: 'red' } })
      .png()
      .toBuffer()
  )
  writeFileSync(
    other,
    await sharp({ create: { width: 4, height: 4, channels: 3, background: 'blue' } })
      .png()
      .toBuffer()
  )
  await page.evaluate((path) => window.api.invoke('assets:importFiles', [path]), art)
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const importer = page.getByRole('dialog', { name: 'Import pages' })
  await importer.getByRole('button', { name: 'Asset library' }).click()
  await expect(importer.getByText('page.png')).toBeVisible()
  await importer.getByLabel('Import placement').selectOption('fill')
  await importer.getByRole('button', { name: 'Import', exact: true }).click()
  await expect(importer).toBeHidden()
  const thumb = page.locator('#page-planner img').first()
  await expect(thumb).toBeVisible()
  await expect
    .poll(() => thumb.evaluate((node) => (node as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0)

  await page.getByLabel('Page notes').fill('keep this note')
  await page.getByLabel('Page notes').blur()
  await expect(page.getByLabel('Page notes')).toHaveValue('keep this note')
  await expect(async () => {
    const surface = page.getByLabel('Crop the artwork')
    await surface.scrollIntoViewIfNeeded({ timeout: 2000 })
    const next = await surface.boundingBox()
    expect(next?.height ?? 0).toBeGreaterThan(20)
  }).toPass()
  const collectionId = await page.evaluate(() =>
    window.api.invoke('collections:outline').then((outline) => outline.collections[0]?.id ?? '')
  )
  const pages = await page.evaluate(
    (id) => window.api.invoke('collections:detail', id).then((detail) => detail.pages),
    collectionId
  )
  const filled = pages.find((item) => item.artwork === 'ready')
  if (!filled?.id) throw new Error('The imported page has no artwork.')
  const [original] = await page.evaluate(
    (id) => window.api.invoke('collections:versions', id),
    filled.id
  )
  if (!original?.sha256) throw new Error('The imported page has no stored version.')
  const sourceSha = createHash('sha256').update(readFileSync(art)).digest('hex')
  const stored = join(
    t.projectsDir,
    'Collections.cwproj',
    'assets',
    original.sha256.slice(0, 2),
    `${original.sha256}.png`
  )
  expect(original.sha256).toBe(sourceSha)

  // The 40 x 20 image sits centered in the crop frame. Drag from 25% to 75% of the shown image.
  const crop = page.getByLabel('Crop the artwork')
  const frame = await crop.boundingBox()
  if (!frame) throw new Error('The crop frame is not on screen.')
  const scale = Math.min(frame.width / 40, frame.height / 20)
  const left = frame.x + (frame.width - 40 * scale) / 2
  const top = frame.y + (frame.height - 20 * scale) / 2
  await page.mouse.move(left + 40 * scale * 0.25, top + 20 * scale * 0.25)
  await page.mouse.down()
  await page.mouse.move(left + 40 * scale * 0.5, top + 20 * scale * 0.5, { steps: 4 })
  await page.mouse.move(left + 40 * scale * 0.75, top + 20 * scale * 0.75, { steps: 4 })
  await page.mouse.up()
  const near = (value: string, expected: number) =>
    expect(Math.abs(Number(value) - expected)).toBeLessThanOrEqual(1)
  await expect(page.getByLabel('Crop width')).not.toHaveValue('')
  near(await page.getByLabel('Crop x').inputValue(), 10)
  near(await page.getByLabel('Crop y').inputValue(), 5)
  near(await page.getByLabel('Crop width').inputValue(), 20)
  near(await page.getByLabel('Crop height').inputValue(), 10)
  const drawnCrop = {
    x: Number(await page.getByLabel('Crop x').inputValue()),
    y: Number(await page.getByLabel('Crop y').inputValue()),
    w: Number(await page.getByLabel('Crop width').inputValue()),
    h: Number(await page.getByLabel('Crop height').inputValue())
  }
  await expect
    .poll(async () => {
      const rows = await page.evaluate(
        (id) => window.api.invoke('collections:versions', id),
        filled.id
      )
      return rows.find((row) => row.id === original.id)?.crop ?? null
    })
    .toEqual(drawnCrop)
  expect(createHash('sha256').update(readFileSync(stored)).digest('hex')).toBe(sourceSha)
  await page.evaluate(
    ([pageId, path]) => window.api.invoke('collections:addVersion', pageId, path),
    [filled.id, other] as const
  )
  const versions = await page.evaluate(
    (id) => window.api.invoke('collections:versions', id),
    filled.id
  )
  expect(versions.find((row) => row.id === original.id)?.crop).toEqual(drawnCrop)
  expect(versions.find((row) => row.id !== original.id)?.crop).toBeNull()
  await page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(page.locator('#artwork-review')).toBeVisible()
  await page.getByLabel('Artwork version').first().selectOption({ label: 'other.png' })
  await page.getByRole('button', { name: 'Set as displayed' }).first().click()
  await page.getByRole('button', { name: 'Planner', exact: true }).click()
  await expect(page.getByText('other.png')).toBeVisible()

  await page.getByRole('button', { name: 'Lock with the next page' }).click()
  await page.getByRole('button', { name: 'Spread layout' }).click()
  await expect(page.getByText('Locked spread').first()).toBeVisible()
  await page.getByRole('button', { name: 'Thumbnail grid' }).click()

  // Ctrl toggles on Windows and Linux; on macOS Ctrl-click is a right click, so Command toggles.
  const toggle = process.platform === 'darwin' ? 'Meta' : 'Control'
  const firstCard = page.getByRole('button', { name: /^1 Untitled/ })
  const secondCard = page.getByRole('button', { name: /^2 Untitled/ })
  const selectedIds = () =>
    page
      .locator('#page-planner [data-page-id][aria-pressed="true"]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-page-id')))
  const orderedIds = pages.map((item) => item.id)
  await firstCard.click()
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true')
  await expect(secondCard).toHaveAttribute('aria-pressed', 'false')
  await secondCard.click({ modifiers: ['Shift'] })
  await expect(secondCard).toHaveAttribute('aria-pressed', 'true')
  expect(await selectedIds()).toEqual(orderedIds)
  await secondCard.click({ modifiers: [toggle] })
  await expect(secondCard).toHaveAttribute('aria-pressed', 'false')
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true')
  await secondCard.click({ modifiers: [toggle] })
  await expect(secondCard).toHaveAttribute('aria-pressed', 'true')
  await expect(firstCard).toHaveAttribute('aria-pressed', 'true')
  expect(await selectedIds()).toEqual(orderedIds)
  await expect(page.getByRole('button', { name: 'Edit selected' })).toBeEnabled()
  await page.evaluate(() => window.api.invoke('tags:create', 'Review'))
  await page.getByRole('button', { name: 'Edit selected' }).click()
  const bulk = page.getByRole('dialog', { name: 'Edit selected pages' })
  await bulk.getByLabel('Bulk change').selectOption('add-tag')
  await expect
    .poll(async () => bulk.getByLabel('Bulk tag').locator('option').count())
    .toBeGreaterThan(0)
  await bulk.getByLabel('Bulk tag').selectOption({ label: 'Review' })
  await bulk.getByRole('button', { name: 'Apply' }).click()
  await expect(bulk).toBeHidden()
  await page.getByRole('button', { name: 'Edit selected' }).click()
  const stages = page.getByRole('dialog', { name: 'Edit selected pages' })
  await stages.getByLabel('Bulk change').selectOption('set-stage')
  await stages.getByLabel('Bulk stage', { exact: true }).selectOption({ label: 'Thumbnail' })
  await stages.getByLabel('Bulk stage status').selectOption('done')
  await stages.getByRole('button', { name: 'Apply' }).click()
  await expect(stages).toBeHidden()
  const afterBulk = await page.evaluate(
    (id) => window.api.invoke('collections:detail', id),
    collectionId
  )
  const kept = afterBulk.pages.find((item) => item.id === filled.id)
  expect(kept?.notes).toBe('keep this note')
  expect(kept?.overallStatus).toBe('not_started')
  expect(afterBulk.stageStates.some((state) => state.state === 'done')).toBe(true)

  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(page.locator('#page-reader')).toBeVisible()
  await page.getByRole('button', { name: 'Spread', exact: true }).click()
  await page.keyboard.press('=')
  await expect
    .poll(() =>
      page.evaluate(
        (id) => window.api.invoke('collections:reader', id).then((doc) => doc.resume.zoom),
        collectionId
      )
    )
    .toBeGreaterThan(1)
  await panReader(page)
  await page.getByRole('button', { name: 'Planner', exact: true }).click()
  const resume = await page.evaluate(
    (id) => window.api.invoke('collections:reader', id).then((doc) => doc.resume),
    collectionId
  )
  expect(resume.layout).toBe('spread')
  expect(resume.zoom).toBeGreaterThan(1)
  expect(resume.x).not.toBe(0)
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Spread', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await page.getByRole('button', { name: 'Planner', exact: true }).first().click()
  await page.getByRole('button', { name: 'Export' }).click()
  const exporter = page.getByRole('dialog', { name: 'Export collection' })
  await exporter.getByRole('button', { name: 'PNG', exact: true }).click()
  await exporter.getByRole('button', { name: 'Package', exact: true }).click()
  await exporter.getByRole('button', { name: 'PDF', exact: true }).click()
  await exporter.getByRole('button', { name: 'Cancel' }).click()
  const pdf = join(t.projectsDir, 'chapter.pdf')
  const folder = join(t.projectsDir, 'images')
  const zip = join(t.projectsDir, 'chapter.zip')
  mkdirSync(folder)
  const written = await page.evaluate(
    async ({ id, pdfPath, folderPath, zipPath }) => {
      const pictures = await window.api.invoke(
        'collections:exportSequence',
        id,
        pdfPath,
        'pdf',
        'spread',
        false
      )
      const images = await window.api.invoke(
        'collections:exportSequence',
        id,
        folderPath,
        'png',
        'page',
        false
      )
      await window.api.invoke('collections:exportPackage', id, zipPath, false)
      const imported = await window.api.invoke('collections:importPackage', zipPath)
      return { pictures: pictures.files.length, images: images.files.length, imported }
    },
    { id: collectionId, pdfPath: pdf, folderPath: folder, zipPath: zip }
  )
  expect(readFileSync(pdf).subarray(0, 5).toString()).toBe('%PDF-')
  expect(written.images).toBeGreaterThan(0)
  expect(written.imported.collectionId).not.toBe(collectionId)
  const listed = await page.evaluate(() =>
    window.api.invoke('collections:outline').then((outline) => outline.collections.length)
  )
  expect(listed).toBe(2)

  const version = await page.evaluate(async (pageId) => {
    const versions = await window.api.invoke('collections:versions', pageId)
    return versions[0]
  }, filled.id)
  if (!version) throw new Error('The page has no version to relink.')
  await page.evaluate(
    ([versionId, path]) => window.api.invoke('collections:relinkFile', versionId, path),
    [version.id, other] as const
  )
  await expect(page.getByLabel('Page notes')).toHaveValue('keep this note')
  await expect(page.getByText('Missing file')).toHaveCount(0)

  const note = resolve('docs/archive/Creative Workspace App v1.0.pdf')
  const current = await page.evaluate(
    (id) => window.api.invoke('collections:detail', id).then((detail) => detail.pages),
    collectionId
  )
  const shown = current.find((item) => item.id === filled.id)
  if (!shown) throw new Error('The artwork page is gone.')
  await page.evaluate(
    ([pageId, path, revision]) =>
      window.api
        .invoke('collections:addVersion', pageId, path)
        .then((added) => window.api.invoke('collections:setDisplayed', pageId, added.id, revision)),
    [filled.id, note, shown.revision] as const
  )
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(page.getByText('Unsupported artwork')).toBeVisible()
})
