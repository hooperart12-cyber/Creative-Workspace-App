import { expect, test, type Page } from '@playwright/test'
import {
  connectionPoints,
  curveControls,
  defaultConnection,
  type ConnectionData
} from '@shared/connections'
import {
  cleanup,
  createProject,
  dragTo,
  launchApp,
  objects,
  toScreen,
  type ObjectInfo,
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

type End = {
  x: number
  y: number
  attachment: {
    kind: string
    id: string
    placement: string
    pin: { edge: string; along: number } | null
  } | null
}

const endOf = (object: ObjectInfo, which: 'start' | 'end'): End =>
  (object.data?.[which] ?? { x: 0, y: 0, attachment: null }) as End

async function card(page: Page, title: string): Promise<ObjectInfo> {
  const found = (await objects(page)).find((item) => item.title === title)
  if (!found) throw new Error(`No card titled ${title}`)
  return found
}

async function place(page: Page, title: string, x: number, y: number): Promise<void> {
  const item = await card(page, title)
  await page.evaluate(
    async ({ id, x: nextX, y: nextY }) => {
      await window.api.invoke('objects:update', [{ id, x: nextX, y: nextY }])
    },
    { id: item.id, x, y }
  )
  await expect.poll(async () => Math.round((await card(page, title)).x)).toBe(x)
}

async function link(page: Page, fromTitle: string, toTitle: string, label: string): Promise<void> {
  const from = await card(page, fromTitle)
  const to = await card(page, toTitle)
  const data = defaultConnection(
    { x: from.x + from.width / 2, y: from.y + from.height / 2 },
    { x: to.x + to.width / 2, y: to.y + to.height / 2 }
  )
  data.label = { text: label, t: 0.5, offset: -18 }
  data.start.attachment = {
    kind: 'object',
    id: from.id,
    placement: 'auto',
    pin: null,
    missing: false,
    userHeld: false
  }
  data.end.attachment = {
    kind: 'object',
    id: to.id,
    placement: 'auto',
    pin: null,
    missing: false,
    userHeld: false
  }
  await page.evaluate(
    async ({ data: next }) => {
      const boardId = (
        window as unknown as { __cw: { workspace: { getState: () => { board: { id: string } } } } }
      ).__cw.workspace.getState().board.id
      await window.api.invoke('relations:createConnection', boardId, next)
    },
    { data }
  )
  await expect
    .poll(async () =>
      (await objects(page)).some(
        (item) =>
          item.type === 'connection' && (item.data?.label as { text?: string })?.text === label
      )
    )
    .toBe(true)
}

async function connection(page: Page, label: string): Promise<ObjectInfo> {
  const found = (await objects(page)).find(
    (item) => item.type === 'connection' && (item.data?.label as { text?: string })?.text === label
  )
  if (!found) throw new Error(`No connection labeled ${label}`)
  return found
}

async function selectLine(page: Page, label: string): Promise<ObjectInfo> {
  const line = await connection(page, label)
  await page.evaluate((id) => {
    ;(
      window as unknown as {
        __cw: { canvas: { getState: () => { setSelection: (ids: string[]) => void } } }
      }
    ).__cw.canvas
      .getState()
      .setSelection([id])
  }, line.id)
  const editor = page.getByRole('textbox', { name: 'Edit connection label' })
  if (await editor.isVisible()) await page.keyboard.press('Escape')
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))
      )
  )
  return connection(page, label)
}

/** A point on the round handle, just outside the box the end is attached to. */
function grab(
  end: End,
  box: { x: number; y: number; width: number; height: number }
): { x: number; y: number } {
  const dx = end.x - (box.x + box.width / 2)
  const dy = end.y - (box.y + box.height / 2)
  const length = Math.hypot(dx, dy) || 1
  return { x: end.x + (dx / length) * 6, y: end.y + (dy / length) * 6 }
}

async function screenPoint(page: Page, point: { x: number; y: number }): Promise<[number, number]> {
  const screen = await toScreen(page, point)
  return [screen.x, screen.y]
}

test('8.4b–8.4d retarget, bend, label, and disambiguate connections', async () => {
  test.setTimeout(90_000)
  await createProject(t.page, t.projectsDir, 'Connections')
  for (const name of ['Left', 'Right', 'Below', 'Top', 'Bottom']) {
    await t.page.getByRole('button', { name: 'Add board' }).click()
    await t.page.getByRole('textbox', { name: 'Board name' }).fill(name)
    await t.page.keyboard.press('Enter')
    await expect.poll(async () => (await objects(t.page)).map((item) => item.title)).toContain(name)
  }
  await place(t.page, 'Left', 40, 200)
  await place(t.page, 'Right', 500, 200)
  await place(t.page, 'Below', 40, 420)
  await place(t.page, 'Top', 300, 20)
  await place(t.page, 'Bottom', 300, 420)
  await link(t.page, 'Left', 'Right', 'Across')
  await link(t.page, 'Top', 'Bottom', 'Down')
  const canvas = (await t.page.getByTestId('canvas').boundingBox())!
  await t.page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await t.page.keyboard.press('Shift+1')

  await test.step('8.4d alt-click lists overlapping lines', async () => {
    const across = await connection(t.page, 'Across')
    const down = await connection(t.page, 'Down')
    const horizontal = endOf(across, 'start').y
    const vertical = endOf(down, 'start').x
    const screen = await toScreen(t.page, { x: vertical, y: horizontal })
    await t.page.keyboard.down('Alt')
    await t.page.mouse.click(screen.x, screen.y)
    await t.page.keyboard.up('Alt')
    const menu = t.page.getByRole('menu', { name: 'Overlapping connections' })
    await expect(menu).toBeVisible()
    await menu.getByRole('button', { name: 'Down' }).click()
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
      .toEqual([down.id])
  })

  await test.step('8.4b drag an end onto a card, pin it, attach a group, then detach', async () => {
    const line = await selectLine(t.page, 'Across')
    const below = await card(t.page, 'Below')
    const right = await card(t.page, 'Right')
    await dragTo(
      t.page,
      await toScreen(t.page, grab(endOf(line, 'end'), right)),
      await toScreen(t.page, { x: below.x + below.width / 2, y: below.y + below.height / 2 })
    )
    await expect
      .poll(async () => endOf(await connection(t.page, 'Across'), 'end').attachment?.id)
      .toBe(below.id)

    const pinnedFrom = await connection(t.page, 'Across')
    await t.page.keyboard.down('Alt')
    await dragTo(
      t.page,
      await toScreen(t.page, grab(endOf(pinnedFrom, 'end'), below)),
      await toScreen(t.page, { x: below.x + below.width / 2, y: below.y + 4 })
    )
    await t.page.keyboard.up('Alt')
    await expect
      .poll(async () => endOf(await connection(t.page, 'Across'), 'end').attachment?.placement)
      .toBe('pinned')

    const left = await card(t.page, 'Left')
    await t.page.evaluate(
      async ({ leftId, belowId }) => {
        const groupId = crypto.randomUUID()
        await window.api.invoke('objects:update', [
          { id: leftId, groupId },
          { id: belowId, groupId }
        ])
      },
      { leftId: left.id, belowId: below.id }
    )
    await expect
      .poll(() =>
        t.page.evaluate(
          (id) =>
            (
              window as unknown as {
                __cw: {
                  workspace: {
                    getState: () => { board: { objects: { id: string; groupId: string | null }[] } }
                  }
                }
              }
            ).__cw.workspace
              .getState()
              .board.objects.find((item) => item.id === id)?.groupId ?? null,
          left.id
        )
      )
      .not.toBeNull()
    const groupId = await t.page.evaluate(
      (id) =>
        (
          window as unknown as {
            __cw: {
              workspace: {
                getState: () => { board: { objects: { id: string; groupId: string | null }[] } }
              }
            }
          }
        ).__cw.workspace
          .getState()
          .board.objects.find((item) => item.id === id)?.groupId,
      left.id
    )
    const latest = await selectLine(t.page, 'Across')
    await t.page.keyboard.down('Shift')
    await dragTo(
      t.page,
      await toScreen(t.page, grab(endOf(latest, 'end'), below)),
      await toScreen(t.page, { x: left.x + left.width / 2, y: left.y + left.height / 2 })
    )
    await t.page.keyboard.up('Shift')
    await expect
      .poll(async () => endOf(await connection(t.page, 'Across'), 'end').attachment)
      .toMatchObject({
        kind: 'group',
        id: groupId
      })

    const parkedAt = { x: 40, y: 90 }
    const beforeDetach = await connection(t.page, 'Across')
    await dragTo(
      t.page,
      await toScreen(t.page, endOf(beforeDetach, 'end')),
      await toScreen(t.page, parkedAt)
    )
    await expect
      .poll(async () => endOf(await connection(t.page, 'Across'), 'end').attachment)
      .toBeNull()
    const parked = endOf(await connection(t.page, 'Across'), 'end')
    const moved = await card(t.page, 'Below')
    await t.page.keyboard.down('Alt')
    await dragTo(
      t.page,
      await toScreen(t.page, { x: moved.x + moved.width / 2, y: moved.y + moved.height / 2 }),
      await toScreen(t.page, { x: moved.x + moved.width / 2 + 70, y: moved.y + moved.height / 2 })
    )
    await t.page.keyboard.up('Alt')
    await expect.poll(async () => (await card(t.page, 'Below')).x).toBeGreaterThan(moved.x + 40)
    const stayed = endOf(await connection(t.page, 'Across'), 'end')
    expect(stayed.attachment).toBeNull()
    expect(Math.abs(stayed.x - parked.x)).toBeLessThan(2)
    expect(Math.abs(stayed.y - parked.y)).toBeLessThan(2)
  })

  await test.step('8.4c a bend survives movement and the label stays horizontal', async () => {
    const left = await card(t.page, 'Left')
    const right = await card(t.page, 'Right')
    const line = await connection(t.page, 'Across')
    const curved: ConnectionData = {
      ...(line.data as unknown as ConnectionData),
      path: 'curved',
      routing: 'manual',
      curve: { t1: 0.33, t2: 0.66, offset1: 50, offset2: -30 },
      start: {
        x: left.x + left.width,
        y: left.y + left.height / 2,
        attachment: {
          kind: 'object',
          id: left.id,
          placement: 'auto',
          pin: null,
          missing: false,
          userHeld: false
        }
      },
      end: {
        x: right.x,
        y: right.y + right.height / 2,
        attachment: {
          kind: 'object',
          id: right.id,
          placement: 'auto',
          pin: null,
          missing: false,
          userHeld: false
        }
      },
      label: { text: 'Across', t: 0.5, offset: -18 }
    }
    await t.page.evaluate(
      async ({ id, data }) => {
        const current = (
          window as unknown as {
            __cw: {
              workspace: {
                getState: () => { board: { objects: { id: string; revision: number }[] } }
              }
            }
          }
        ).__cw.workspace
          .getState()
          .board.objects.find((item) => item.id === id)
        if (!current) throw new Error('missing connection')
        await window.api.invoke('relations:updateConnection', id, current.revision, data)
      },
      { id: line.id, data: curved }
    )
    await expect.poll(async () => (await connection(t.page, 'Across')).data?.path).toBe('curved')
    const ready = await selectLine(t.page, 'Across')
    const handle = curveControls(endOf(ready, 'start'), endOf(ready, 'end'), curved.curve)[0]
    await dragTo(
      t.page,
      await toScreen(t.page, handle),
      await toScreen(t.page, { x: handle.x, y: handle.y + 70 })
    )
    await expect
      .poll(async () => {
        const curve = (await connection(t.page, 'Across')).data?.curve as { offset1: number }
        return Math.abs(curve.offset1 - 50)
      })
      .toBeGreaterThan(20)
    const offset = ((await connection(t.page, 'Across')).data?.curve as { offset1: number }).offset1
    const leftNow = await card(t.page, 'Left')
    await t.page.keyboard.down('Alt')
    await dragTo(
      t.page,
      await toScreen(t.page, {
        x: leftNow.x + leftNow.width / 2,
        y: leftNow.y + leftNow.height / 2
      }),
      await toScreen(t.page, {
        x: leftNow.x + leftNow.width / 2 + 40,
        y: leftNow.y + leftNow.height / 2
      })
    )
    await t.page.keyboard.up('Alt')
    await expect.poll(async () => (await card(t.page, 'Left')).x).toBeGreaterThan(leftNow.x + 20)
    const afterMove = await connection(t.page, 'Across')
    expect((afterMove.data?.curve as { offset1: number }).offset1).toBeCloseTo(offset, 0)
    expect(endOf(afterMove, 'start').attachment?.id).toBe(left.id)
    const onLine = connectionPoints(afterMove.data as unknown as ConnectionData)
    await t.page.mouse.dblclick(
      ...(await screenPoint(t.page, onLine[Math.floor(onLine.length / 2)]))
    )
    const editor = t.page.getByRole('textbox', { name: 'Edit connection label' })
    await expect(editor).toBeVisible()
    await editor.fill('Allies')
    await editor.press('Enter')
    await expect
      .poll(async () => (await connection(t.page, 'Allies')).data?.label)
      .toMatchObject({ text: 'Allies' })
    const labeled = await connection(t.page, 'Allies')
    expect(labeled.data?.label).not.toHaveProperty('rotation')
  })
})
