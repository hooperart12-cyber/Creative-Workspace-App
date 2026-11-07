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
  const crop = page.getByLabel('Crop the artwork')
  await crop.dragTo(crop, {
    sourcePosition: { x: 8, y: 8 },
    targetPosition: { x: 70, y: 50 }
  })
  if ((await page.getByLabel('Crop width').inputValue()) === '') {
    await page.getByLabel('Crop x').fill('0')
    await page.getByLabel('Crop y').fill('0')
    await page.getByLabel('Crop width').fill('10')
    await page.getByLabel('Crop height').fill('8')
    await page.getByLabel('Crop height').blur()
  }
  await expect(page.getByLabel('Crop width')).not.toHaveValue('')

  const collectionId = await page.evaluate(() =>
    window.api.invoke('collections:outline').then((outline) => outline.collections[0]?.id ?? '')
  )
  const pages = await page.evaluate(
    (id) => window.api.invoke('collections:detail', id).then((detail) => detail.pages),
    collectionId
  )
  const filled = pages.find((item) => item.artwork === 'ready')
  if (!filled?.id) throw new Error('The imported page has no artwork.')
  await page.evaluate(
    ([pageId, path]) => window.api.invoke('collections:addVersion', pageId, path),
    [filled.id, other] as const
  )
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

  await page.getByRole('button', { name: /2 Untitled/ }).click({ modifiers: ['Control'] })
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
