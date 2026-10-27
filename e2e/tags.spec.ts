import { expect, test } from '@playwright/test'
import { cleanup, createProject, launchApp, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

test('tags a board from the canvas and finds it by that tag', async () => {
  await createProject(t.page, t.projectsDir, 'Tagged')
  await t.page.keyboard.press('Control+k')
  const palette = t.page.getByRole('dialog', { name: 'Command palette' })
  await palette.getByLabel('Command palette').fill('Tag manager')
  await palette.getByText('Tag manager', { exact: true }).click()

  const manager = t.page.getByRole('dialog', { name: 'Tag manager' })
  await manager.getByLabel('New tag name').fill('Hero')
  await manager.getByRole('button', { name: 'Create' }).click()
  await expect(manager.getByRole('button', { name: /Hero/ })).toBeVisible()
  await manager.getByRole('button', { name: 'Close' }).click()

  await t.page.getByTestId('canvas').click({ button: 'right' })
  await t.page.getByRole('menuitem', { name: 'Tag this board' }).click()
  const editor = t.page.getByRole('dialog', { name: 'Tag this board' })
  await editor.getByRole('checkbox', { name: 'Hero' }).check()
  await editor.getByRole('button', { name: 'Add', exact: true }).click()
  await editor.getByRole('button', { name: 'Close' }).click()

  await t.page.getByRole('button', { name: 'Search', exact: true }).click()
  const search = t.page.getByTestId('search')
  await search.getByLabel('Add a tag to this search').fill('Hero')
  await search.getByLabel('Add a tag to this search').press('Enter')
  await expect(search.getByRole('button', { name: 'Hero ×' })).toBeVisible()
  await search.getByLabel('Project search').press('Enter')
  await expect(search.getByRole('button', { name: /Tagged/ }).first()).toBeVisible()

  await search.getByRole('button', { name: 'Back', exact: true }).click()
  await t.page.getByLabel('Tag visibility').selectOption('always')
  await expect
    .poll(() =>
      t.page.evaluate(
        () =>
          (
            window as unknown as {
              __cw: { workspace: { getState: () => { board: { tagVisibility: string } } } }
            }
          ).__cw.workspace.getState().board.tagVisibility
      )
    )
    .toBe('always')
})
