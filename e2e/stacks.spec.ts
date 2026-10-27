import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from '@playwright/test'
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

async function makePng(name: string, red: number): Promise<string> {
  const bytes = await sharp({
    create: {
      width: 120,
      height: 80,
      channels: 4,
      background: { r: red, g: 120, b: 200, alpha: 1 }
    }
  })
    .png()
    .toBuffer()
  const path = join(t.projectsDir, name)
  writeFileSync(path, bytes)
  return path
}

async function stubPicker(paths: string[]) {
  await t.app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never
  }, paths)
}

test('combines images into a stack, crops one slide, and opens that slide from search', async () => {
  await createProject(t.page, t.projectsDir, 'Stacks')
  const first = await makePng('left.png', 20)
  const second = await makePng('right.png', 180)
  await stubPicker([first, second])
  await t.page.getByRole('button', { name: 'Add images' }).click()
  await expect
    .poll(async () => (await objects(t.page)).filter((object) => object.type === 'image').length)
    .toBe(2)

  const images = (await objects(t.page)).filter((object) => object.type === 'image')
  await t.page.evaluate(
    (ids) => {
      ;(
        window as unknown as {
          __cw: { canvas: { getState: () => { setSelection: (ids: string[]) => void } } }
        }
      ).__cw.canvas
        .getState()
        .setSelection(ids)
    },
    images.map((image) => image.id)
  )
  const spot = await toScreen(t.page, {
    x: images[0].x + images[0].width / 2,
    y: images[0].y + images[0].height / 2
  })
  await t.page.mouse.click(spot.x, spot.y, { button: 'right' })
  await t.page.getByRole('menuitem', { name: 'Combine into stack' }).click()
  await expect
    .poll(async () => (await objects(t.page)).some((object) => object.type === 'stack'))
    .toBe(true)
  expect((await objects(t.page)).filter((object) => object.type === 'image')).toHaveLength(0)

  const stack = (await objects(t.page)).find((object) => object.type === 'stack')!
  const stackSpot = await toScreen(t.page, {
    x: stack.x + stack.width / 2,
    y: stack.y + stack.height / 2
  })
  await t.page.mouse.click(stackSpot.x, stackSpot.y, { button: 'right' })
  await t.page.getByRole('menuitem', { name: 'Edit stack' }).click()
  const editor = t.page.getByRole('dialog', { name: 'Stack editor' })
  await editor.getByRole('textbox', { name: 'Name' }).fill('Heroes')
  await editor.getByRole('textbox', { name: 'Name' }).blur()
  await editor.getByRole('button', { name: 'Crop' }).first().click()
  const crop = t.page.getByRole('dialog', { name: 'Crop this appearance' })
  await crop.getByLabel('width').fill('40')
  await crop.getByRole('button', { name: 'Apply crop' }).click()
  await expect
    .poll(async () => {
      const slides = await t.page.evaluate(() => {
        const board = (
          window as unknown as {
            __cw: {
              workspace: {
                getState: () => {
                  board: { objects: { type: string; slides?: { crop: unknown }[] }[] }
                }
              }
            }
          }
        ).__cw.workspace.getState().board
        return board.objects.find((object) => object.type === 'stack')?.slides ?? []
      })
      return slides.some((slide) => slide.crop != null)
    })
    .toBe(true)
  await editor.getByRole('button', { name: 'Close' }).click()

  await t.page.getByRole('button', { name: 'Search', exact: true }).click()
  const search = t.page.getByTestId('search')
  await search.getByLabel('Project search').fill('left')
  await search.getByLabel('Project search').press('Enter')
  const group = search.getByRole('listitem').filter({ hasText: 'stack' })
  await group.getByRole('button', { name: 'left.png' }).click()
  await t.page.getByRole('button', { name: 'Keep displayed' }).click()
  await expect
    .poll(async () =>
      t.page.evaluate(() => {
        const stack = (
          window as unknown as {
            __cw: {
              workspace: {
                getState: () => {
                  board: { objects: { type: string; data: { displayedSlideId?: string } }[] }
                }
              }
            }
          }
        ).__cw.workspace
          .getState()
          .board.objects.find((object) => object.type === 'stack')
        return stack?.data.displayedSlideId ?? null
      })
    )
    .toBeTruthy()
})
