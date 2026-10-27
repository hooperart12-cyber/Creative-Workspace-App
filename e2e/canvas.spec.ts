import { expect, test } from '@playwright/test'
import {
  breadcrumb,
  cardCenter,
  cleanup,
  createProject,
  dragTo,
  launchApp,
  objects,
  type TestApp
} from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

const addBoard = async (name: string) => {
  await t.page.getByRole('button', { name: 'Add board' }).click()
  await t.page.getByRole('textbox', { name: 'Board name' }).fill(name)
  await t.page.keyboard.press('Enter')
  await expect.poll(async () => (await objects(t.page)).map((o) => o.title)).toContain(name)
}

test('start screen appears on first launch', async () => {
  await expect(t.page.getByRole('heading', { name: 'Creative Workspace' })).toBeVisible()
  await expect(t.page.getByText('No recent projects yet.')).toBeVisible()
})

test('create boards from the toolbar, drag one, and it persists after restart', async () => {
  await createProject(t.page, t.projectsDir, 'E2E Project')
  await addBoard('Characters')
  await addBoard('Chapter 1')

  const before = (await objects(t.page)).find((o) => o.title === 'Characters')!
  const from = await cardCenter(t.page, 'Characters')
  // Hold Alt so snapping doesn't adjust the drop position.
  await t.page.keyboard.down('Alt')
  await dragTo(t.page, from, { x: from.x + 150, y: from.y + 90 })
  await t.page.keyboard.up('Alt')

  const moved = async () => (await objects(t.page)).find((o) => o.title === 'Characters')!
  await expect.poll(async () => Math.round((await moved()).x - before.x)).toBe(150)

  // Restart the app with the same settings and projects; the layout is saved.
  const dirs = { dataDir: t.dataDir, projectsDir: t.projectsDir }
  const expected = await moved()
  await t.close()
  t = await launchApp(dirs)
  await t.page.getByRole('button', { name: /^E2E Project/ }).click()
  await t.page.getByTestId('canvas').waitFor()
  await expect
    .poll(async () => (await objects(t.page)).find((o) => o.title === 'Characters'))
    .toMatchObject({ x: expected.x, y: expected.y })
})

test('drag a card onto another card to nest it, then undo', async () => {
  await createProject(t.page, t.projectsDir, 'Nesting')
  await addBoard('Folder board')
  await addBoard('Child')

  await dragTo(t.page, await cardCenter(t.page, 'Child'), await cardCenter(t.page, 'Folder board'))
  await expect
    .poll(async () => (await objects(t.page)).map((o) => o.title))
    .toEqual(['Folder board'])

  // Double-click opens the board; the child is inside.
  const target = await cardCenter(t.page, 'Folder board')
  await t.page.mouse.dblclick(target.x, target.y)
  await expect.poll(() => breadcrumb(t.page)).toEqual(['Nesting', 'Folder board'])
  await expect.poll(async () => (await objects(t.page)).map((o) => o.title)).toEqual(['Child'])

  // Back to the main board and undo the nesting.
  await t.page.keyboard.press('Alt+ArrowLeft')
  await expect.poll(() => breadcrumb(t.page)).toEqual(['Nesting'])
  await t.page.getByTestId('canvas').focus()
  await t.page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await objects(t.page)).map((o) => o.title).sort())
    .toEqual(['Child', 'Folder board'])
})

test('delete with the keyboard and restore with undo', async () => {
  await createProject(t.page, t.projectsDir, 'Trash')
  await addBoard('Keep me')
  const c = await cardCenter(t.page, 'Keep me')
  await t.page.mouse.click(c.x, c.y)
  await t.page.keyboard.press('Delete')
  await expect.poll(async () => (await objects(t.page)).length).toBe(0)
  await t.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await objects(t.page)).map((o) => o.title)).toEqual(['Keep me'])
})

test('a click selects what is on the board even before the window repaints', async () => {
  // Slow or throttled windows paint late; what a click hits must follow the board's data,
  // not the last frame that was drawn.
  await t.page.context().addInitScript(() => {
    const native = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = (callback) => {
      setTimeout(() => native(callback), 400)
      return 0
    }
  })
  await createProject(t.page, t.projectsDir, 'Slow frames')
  await addBoard('Keep me')
  const c = await cardCenter(t.page, 'Keep me')
  await t.page.mouse.click(c.x, c.y)
  await t.page.keyboard.press('Delete')
  await expect.poll(async () => (await objects(t.page)).length).toBe(0)
  await t.page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await objects(t.page)).map((o) => o.title)).toEqual(['Keep me'])
})

test('drag the Board tile onto the canvas to place a board there', async () => {
  await createProject(t.page, t.projectsDir, 'Toolbar drag')
  const canvas = t.page.getByTestId('canvas')
  await t.page
    .getByRole('button', { name: 'Add board' })
    .dragTo(canvas, { targetPosition: { x: 200, y: 150 } })
  await t.page.getByRole('textbox', { name: 'Board name' }).fill('Dropped')
  await t.page.keyboard.press('Enter')
  await expect.poll(async () => (await objects(t.page)).map((o) => o.title)).toEqual(['Dropped'])
  // The card is centred on the drop point.
  const center = await cardCenter(t.page, 'Dropped')
  const box = (await canvas.boundingBox())!
  expect(Math.abs(center.x - (box.x + 200))).toBeLessThan(2)
  expect(Math.abs(center.y - (box.y + 150))).toBeLessThan(2)
})

test('drag boards and folders in the sidebar to reorganise them', async () => {
  await createProject(t.page, t.projectsDir, 'Sidebar drag')
  await addBoard('Parent')
  await addBoard('Child')
  const tree = t.page.getByRole('navigation', { name: 'Project navigation' })
  await tree
    .getByRole('treeitem', { name: 'Child' })
    .dragTo(tree.getByRole('treeitem', { name: 'Parent' }))
  await expect.poll(async () => (await objects(t.page)).map((o) => o.title)).toEqual(['Parent'])

  // Folders: create two, drag one into the other.
  for (const name of ['Refs', 'Poses']) {
    await t.page.getByRole('button', { name: 'New library folder' }).click()
    await t.page.getByRole('textbox', { name: 'Folder name' }).fill(name)
    await t.page.keyboard.press('Enter')
  }
  await tree
    .getByRole('treeitem', { name: 'Poses' })
    .dragTo(tree.getByRole('treeitem', { name: 'Refs' }))
  await expect
    .poll(() =>
      t.page.evaluate(async () => {
        const tr = await window.api.invoke('tree:get')
        const refs = tr.folders.find((f) => f.name === 'Refs')!
        return tr.folders.find((f) => f.name === 'Poses')?.parentId === refs.id
      })
    )
    .toBe(true)
})
