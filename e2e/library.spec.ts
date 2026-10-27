import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
import { cleanup, createProject, launchApp, objects, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

test('library workspace searches, reuses a file on the board, and restores trash', async () => {
  await createProject(t.page, t.projectsDir, 'Library')
  const note = join(t.projectsDir, 'chapter.txt')
  const other = join(t.projectsDir, 'other.txt')
  writeFileSync(note, 'chapter')
  writeFileSync(other, 'other')
  await t.page.evaluate(
    ([chapter, extra]) =>
      window.api.invoke('library:importFiles', [chapter, extra], {
        folderId: null,
        duplicates: 'skip'
      }),
    [note, other] as const
  )

  await t.page.getByRole('button', { name: 'Open library' }).click()
  const library = t.page.getByTestId('library')
  await expect(library).toBeVisible()
  await expect(library.getByLabel('chapter.txt').first()).toBeVisible()

  const search = library.getByLabel('Library search')
  await search.fill('chapter')
  await library.getByLabel('Search scope').selectOption('project')
  await expect(search).toHaveValue('chapter')
  await expect(library.getByLabel('chapter.txt').first()).toBeVisible()
  await expect(library.getByLabel('other.txt')).toHaveCount(0)

  await library.getByRole('button', { name: 'List' }).click()
  await library.getByLabel('chapter.txt').first().click()
  await t.page.getByRole('button', { name: 'Add to current board' }).click()
  await expect(t.page.getByTestId('canvas')).toBeVisible()
  await expect.poll(async () => (await objects(t.page)).length).toBe(1)
  await t.page.keyboard.press('Control+z')
  await expect.poll(async () => (await objects(t.page)).length).toBe(0)
  await t.page.keyboard.press('Control+Shift+z')
  await expect.poll(async () => (await objects(t.page)).length).toBe(1)

  await t.page.getByRole('button', { name: 'Open library' }).click()
  await library.getByLabel('chapter.txt').first().click()
  await library.getByRole('button', { name: 'Move to trash' }).click()
  await library.getByRole('button', { name: 'Trash' }).click()
  const trash = t.page.getByTestId('trash')
  await expect(trash).toBeVisible()
  await expect(trash.getByLabel('chapter.txt')).toBeVisible()
  await trash.getByLabel('chapter.txt').check()
  await trash.getByRole('button', { name: 'Restore' }).click()
  await trash.getByRole('button', { name: 'Library', exact: true }).click()
  await search.fill('')
  await expect(library.getByLabel('chapter.txt').first()).toBeVisible()
  await t.page.getByRole('button', { name: 'Canvas' }).click()
  await expect.poll(async () => (await objects(t.page)).length).toBe(1)
})
