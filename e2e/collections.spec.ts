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

test('opens a collection in the planner, spread layout, and optional overview', async () => {
  await createProject(t.page, t.projectsDir, 'Collections')
  await t.page.evaluate(() =>
    window.api.invoke('collections:create', { title: 'Chapter One', placeholderCount: 2 })
  )
  await t.page.getByText('Chapter One', { exact: true }).click()
  await expect(t.page.locator('#page-planner')).toBeVisible()
  await t.page.getByRole('button', { name: 'Spread layout' }).click()
  await expect(t.page.getByRole('button', { name: 'Spread layout' })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await t.page.getByRole('button', { name: 'Thumbnail grid' }).click()
  await t.page.getByRole('button', { name: 'Overview', exact: true }).click()
  await expect(t.page.locator('#collection-overview')).toBeVisible()
  await expect(t.page.getByText(/2 entries/)).toBeVisible()
  await t.page.getByRole('button', { name: 'Planner', exact: true }).click()
  await expect(t.page.locator('#page-planner')).toBeVisible()
  await t.page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(t.page.locator('#page-reader')).toBeVisible()
  await t.page.getByRole('button', { name: 'Planner', exact: true }).first().click()
  await t.page.getByRole('button', { name: 'Review', exact: true }).click()
  await expect(t.page.locator('#artwork-review')).toBeVisible()
})
