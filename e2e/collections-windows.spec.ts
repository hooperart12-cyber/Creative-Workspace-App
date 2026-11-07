import { expect, test, type Page } from '@playwright/test'
import { cleanup, createProject, launchApp, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

test('two windows keep their own reader and the last one used is the resume', async () => {
  test.setTimeout(120_000)
  const first = t.page
  await createProject(first, t.projectsDir, 'Windows')
  const created = await first.evaluate(() =>
    window.api.invoke('collections:create', { title: 'Shared chapter', placeholderCount: 2 })
  )
  await first.evaluate(
    ([left, right]) =>
      Promise.all([
        window.api.invoke('collections:updatePage', left, 0, { label: 'Left' }),
        window.api.invoke('collections:updatePage', right, 0, { label: 'Right' })
      ]),
    created.pageIds as [string, string]
  )
  await first.getByText('Shared chapter', { exact: true }).click()
  await expect(first.locator('#page-planner')).toBeVisible()

  const [second] = await Promise.all([
    t.app.waitForEvent('window'),
    first.getByRole('button', { name: 'Open in new window' }).click()
  ])
  await second.getByTestId('canvas').waitFor()
  await second.getByText('Shared chapter', { exact: true }).click()
  await expect(second.locator('#page-planner')).toBeVisible()

  await first.bringToFront()
  await first.getByLabel('Page title').fill('First edit')
  await first.getByLabel('Page title').blur()
  await expect(second.getByText('First edit')).toBeVisible()

  const stale = await second.evaluate(
    (id) => window.api.invoke('collections:detail', id),
    created.id
  )
  const page = stale.pages[0]
  if (!page) throw new Error('The collection has no page.')
  await first.getByLabel('Page title').fill('Saved title')
  await first.getByLabel('Page title').blur()
  await expect(second.getByText('Saved title')).toBeVisible()
  await expect(
    second.evaluate(
      ([id, revision]) =>
        window.api.invoke('collections:updatePage', id, revision, { title: 'Stolen' }),
      [page.id, page.revision] as const
    )
  ).rejects.toThrow(/Another window/)
  await expect(first.getByLabel('Page title')).toHaveValue('Saved title')

  await openReader(first)
  await first.getByRole('button', { name: 'Spread', exact: true }).click()
  await first.keyboard.press('=')
  await expect
    .poll(() =>
      first.evaluate(
        (id) => window.api.invoke('collections:reader', id).then((doc) => doc.resume.zoom),
        created.id
      )
    )
    .toBeGreaterThan(1)
  await panReader(first)
  await expect(first.locator('#page-reader button.bg-white')).toHaveText('Left')

  await second.bringToFront()
  await openReader(second)
  await expect(second.locator('#page-reader button.bg-white')).toHaveText('Left')
  await expect(first.locator('#page-reader button.bg-white')).toHaveText('Left')
  await second.getByRole('button', { name: 'Right', exact: true }).click()
  await expect(second.locator('#page-reader button.bg-white')).toHaveText('Right')
  await expect(first.locator('#page-reader button.bg-white')).toHaveText('Left')
  await second.getByRole('button', { name: 'Planner', exact: true }).click()
  await second.close()

  const resume = await first.evaluate(
    (id) => window.api.invoke('collections:reader', id).then((doc) => doc.resume),
    created.id
  )
  expect(resume.pageId).toBe(created.pageIds[1])
  expect(resume.layout).toBe('spread')
  expect(resume.zoom).toBeGreaterThan(1)
  expect(resume.x).not.toBe(0)
  await first.getByRole('button', { name: 'Planner', exact: true }).click()
  await openReader(first)
  await expect(first.locator('#page-reader button.bg-white')).toHaveText('Right')
  await expect(first.getByRole('button', { name: 'Spread', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
})

async function panReader(page: Page): Promise<void> {
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

async function openReader(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Read', exact: true }).click()
  await expect(page.locator('#page-reader')).toBeVisible()
}
