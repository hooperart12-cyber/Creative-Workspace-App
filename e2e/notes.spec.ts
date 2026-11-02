import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import electronPath from 'electron'
import sharp from 'sharp'
import { cleanup, createProject, dragTo, launchApp, objects, toScreen, type TestApp } from './app'

let t: TestApp

test.beforeEach(async () => {
  t = await launchApp()
})

test.afterEach(async () => {
  await t.close()
  cleanup(t)
})

// ── Helpers ──────────────────────────────────────────────────────────────────

interface Mark {
  type: string
  attrs?: Record<string, unknown>
}
interface DocNode {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Mark[]
  content?: DocNode[]
}
interface NoteData {
  content: { schemaVersion: number; doc: DocNode }
  plainText: string
  appearance: Record<string, unknown> & { mode: string }
  sizing: 'auto' | 'fixed'
}
interface Note {
  id: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  revision: number
  data: NoteData
}
interface Run {
  text: string
  x: number
  width: number
  font: string
  fontSize: number
  top: number
  href: string | null
}

type Cw = {
  __cw: {
    workspace: { getState: () => { board: { objects: (Note & { type: string })[] } } }
    canvas: {
      getState: () => {
        selection: Set<string>
        viewport: { x: number; y: number; zoom: number }
        setViewport: (v: { x: number; y: number; zoom: number }) => void
      }
    }
    notes: {
      getState: () => {
        editing: { objectId: string; status: string; readOnly: boolean; mode: string } | null
        editedElsewhere: Set<string>
        scroll: Record<string, number>
      }
    }
    noteLayout: (
      id: string
    ) => { height: number; runs: Run[]; markers: { text: string }[] } | undefined
    noteEditor: () => {
      view: {
        dom: HTMLElement
        state: { selection: { anchor: number; head: number } }
        posAtDOM: (node: Node, offset: number) => number
      }
    } | null
  }
}

/** Notes on the open board, from this window's state. */
const notes = (page: Page = t.page): Promise<Note[]> =>
  page.evaluate(() =>
    (window as never as Cw).__cw.workspace
      .getState()
      .board.objects.filter((o) => o.type === 'text')
      .map((o) => JSON.parse(JSON.stringify(o)) as Note)
  )

/** A note as saved in the project (not this window's copy). */
const stored = (id: string, page: Page = t.page): Promise<Note | undefined> =>
  page.evaluate(async (noteId) => (await window.api.invoke('notes:get', [noteId]))[0] as never, id)

const layoutOf = (id: string, page: Page = t.page) =>
  page.evaluate((noteId) => (window as never as Cw).__cw.noteLayout(noteId), id)

const editingState = (page: Page = t.page) =>
  page.evaluate(() => (window as never as Cw).__cw.notes.getState().editing)

const selection = (page: Page = t.page) =>
  page.evaluate(() => [...(window as never as Cw).__cw.canvas.getState().selection])

const viewport = (page: Page = t.page) =>
  page.evaluate(() => (window as never as Cw).__cw.canvas.getState().viewport)

const editorBox = (page: Page = t.page) => page.getByTestId('note-editor')
const textArea = (page: Page = t.page) => editorBox(page).locator('.ProseMirror')
const status = (page: Page = t.page) => page.getByTestId('note-save-status')

/** Every text run in a document, with its marks. */
function textRuns(node: DocNode, out: { text: string; marks: Mark[] }[] = []) {
  if (node.text) out.push({ text: node.text, marks: node.marks ?? [] })
  for (const child of node.content ?? []) textRuns(child, out)
  return out
}
const hasMark = (doc: DocNode, text: string, type: string) =>
  textRuns(doc).some((r) => r.text.includes(text) && r.marks.some((m) => m.type === type))

/** Screen point of a spot inside a note (rotation included), in note units from its corner. */
async function notePoint(note: Note, dx: number, dy: number, page: Page = t.page) {
  const r = (note.rotation * Math.PI) / 180
  return toScreen(page, {
    x: note.x + dx * Math.cos(r) - dy * Math.sin(r),
    y: note.y + dx * Math.sin(r) + dy * Math.cos(r)
  })
}
const noteCenter = (note: Note, page: Page = t.page) =>
  notePoint(note, note.width / 2, note.height / 2, page)

async function canvasBox(page: Page = t.page) {
  return (await page.getByTestId('canvas').boundingBox())!
}

/** Double-clicks empty canvas and types a new note; returns it once saved and closed. */
async function typeNewNote(text: string, at?: { x: number; y: number }, page: Page = t.page) {
  const box = await canvasBox(page)
  const before = (await notes(page)).map((n) => n.id)
  await page.mouse.dblclick(at?.x ?? box.x + 420, at?.y ?? box.y + 260)
  await expect(textArea(page)).toBeFocused()
  await page.keyboard.type(text)
  await page.keyboard.press('Escape')
  await expect(editorBox(page)).toBeHidden()
  await expect.poll(async () => (await notes(page)).length).toBe(before.length + 1)
  const note = (await notes(page)).find((n) => !before.includes(n.id))!
  return note
}

/**
 * Waits until the editor has caught up with where the browser put the cursor. Clicks and
 * cursor keys move the browser's selection first; the editor reads it a moment later, and
 * a test can press the next shortcut sooner than any person could.
 */
async function synced(page: Page = t.page) {
  await expect
    .poll(() =>
      page.evaluate(() => {
        const view = (window as never as Cw).__cw.noteEditor()?.view
        const s = window.getSelection()
        if (!view || !s?.anchorNode || !s.focusNode || !view.dom.contains(s.anchorNode))
          return false
        const { anchor, head } = view.state.selection
        return (
          anchor === view.posAtDOM(s.anchorNode, s.anchorOffset) &&
          head === view.posAtDOM(s.focusNode, s.focusOffset)
        )
      })
    )
    .toBe(true)
}

/** Selects a word in the open note. End and Home do not move the caret on macOS. */
async function selectText(text: string, page: Page = t.page) {
  await textArea(page).click()
  const found = await page.evaluate((wanted) => {
    const view = (window as never as Cw).__cw.noteEditor()?.view
    if (!view) return false
    const walker = document.createTreeWalker(view.dom, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const value = node.textContent ?? ''
      const index = value.indexOf(wanted)
      if (index >= 0) {
        const range = document.createRange()
        range.setStart(node, index)
        range.setEnd(node, index + wanted.length)
        const selection = window.getSelection()
        selection?.removeAllRanges()
        selection?.addRange(range)
        return true
      }
      node = walker.nextNode()
    }
    return false
  }, text)
  expect(found).toBe(true)
  await synced(page)
}

/** Presses cursor keys in the editor, then waits for the editor to follow. */
async function moveCursor(keys: string[], page: Page = t.page) {
  for (const key of keys) await page.keyboard.press(key)
  await synced(page)
}

/**
 * Moves the cursor to the end of the note. Ctrl+End does this on Windows and Linux, but macOS
 * has no such shortcut (Cmd+End does nothing); Cmd+Down goes to the end of the text there.
 */
const END_OF_NOTE = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End'

async function startEditing(note: Note, page: Page = t.page) {
  const c = await noteCenter(note, page)
  await page.mouse.dblclick(c.x, c.y)
  await expect(textArea(page)).toBeFocused()
}

// ── 1. Create, edit, delete ──────────────────────────────────────────────────

test('create notes (double-click, T, toolbar), autosave while typing, delete and undo', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Notes')
  const box = await canvasBox(page)
  const click = { x: box.x + 420, y: box.y + 260 }

  await page.mouse.dblclick(click.x, click.y)
  await expect(textArea()).toBeFocused()
  await page.keyboard.type('Hello canvas')
  // Saved while still typing, not only when editing ends.
  await expect(status()).toHaveAttribute('data-status', 'saved')
  const [note] = await notes()
  expect((await stored(note.id))!.data.plainText).toBe('Hello canvas')
  expect(await editingState()).toMatchObject({ objectId: note.id })
  // The note starts where the canvas was double-clicked (its text just right of and below it).
  const editorAt = (await editorBox().boundingBox())!
  expect(click.x - editorAt.x).toBeGreaterThan(0)
  expect(click.x - editorAt.x).toBeLessThan(40)
  expect(click.y - editorAt.y).toBeGreaterThan(0)
  expect(click.y - editorAt.y).toBeLessThan(40)

  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
  expect(await selection()).toEqual([note.id])

  // Delete, then undo brings it back with its text.
  await page.keyboard.press('Delete')
  await expect.poll(async () => (await notes()).length).toBe(0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await notes()).map((n) => n.data.plainText))
    .toEqual(['Hello canvas'])

  // T makes a note under the pointer.
  await page.mouse.move(box.x + 250, box.y + 420)
  await page.keyboard.press('t')
  await expect(textArea()).toBeFocused()
  await page.keyboard.type('Second')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await notes()).length).toBe(2)

  // The toolbar's Text tile makes one in the middle of the view. Left empty, it goes away.
  await page.getByRole('button', { name: 'Add text' }).click()
  await expect(textArea()).toBeFocused()
  expect(await notes()).toHaveLength(3)
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await notes()).length).toBe(2)
  // …and that left nothing to undo: Ctrl+Z undoes the "Second" note.
  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await notes()).map((n) => n.data.plainText))
    .toEqual(['Hello canvas'])
})

// ── 2. Card / floating ───────────────────────────────────────────────────────

test('switch between card and floating text without losing anything; reset appearance', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Modes')
  const note = await typeNewNote('Keep me exactly as I am')
  const c = await noteCenter(note)

  await page.mouse.click(c.x, c.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Show as floating text' }).click()
  await expect.poll(async () => (await stored(note.id))!.data.appearance.mode).toBe('floating')
  const floating = (await stored(note.id))!
  expect(floating.data.content).toEqual(note.data.content)
  expect(floating).toMatchObject({ x: note.x, y: note.y, width: note.width, height: note.height })
  // The text is drawn in the same place in both modes.
  const runFloating = (await layoutOf(note.id))!.runs[0]

  await page.mouse.click(c.x, c.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Show as card' }).click()
  await expect.poll(async () => (await stored(note.id))!.data.appearance.mode).toBe('card')
  expect((await layoutOf(note.id))!.runs[0]).toMatchObject({ top: runFloating.top })

  // Change the look in the panel, then "Reset appearance" puts the default back (text kept).
  await startEditing((await notes())[0])
  await page.getByRole('button', { name: 'More formatting' }).click()
  const panel = page.getByTestId('note-format-panel')
  await panel.getByRole('button', { name: 'Background colour: #fff1a8' }).click()
  await panel.getByLabel('Padding').selectOption('32')
  await expect
    .poll(async () => (await stored(note.id))!.data.appearance)
    .toMatchObject({
      background: '#fff1a8',
      padding: 32
    })
  await panel.getByRole('button', { name: 'Reset appearance' }).click()
  await expect
    .poll(async () => (await stored(note.id))!.data.appearance)
    .toMatchObject({
      background: '#ffffff',
      padding: 16,
      mode: 'card'
    })
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
  expect((await stored(note.id))!.data.plainText).toBe('Keep me exactly as I am')
  // Reset is one undo step.
  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(async () => (await stored(note.id))!.data.appearance)
    .toMatchObject({
      background: '#fff1a8',
      padding: 32
    })
})

// ── 3. Formatting ────────────────────────────────────────────────────────────

test('mixed text and paragraph formatting, safe links, drawn on the canvas', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Formatting')
  const box = await canvasBox(page)
  await page.mouse.dblclick(box.x + 300, box.y + 200)
  await expect(textArea()).toBeFocused()
  await page.keyboard.type('Title')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Some bold words')
  await page.keyboard.press('Enter')
  await page.keyboard.type('item')

  const toolbar = page.getByTestId('note-toolbar')
  // Third line: bulleted list.
  await toolbar.getByRole('button', { name: 'Bulleted list' }).click()
  // First line: heading.
  await textArea().getByText('Title').click()
  await synced()
  await toolbar.getByLabel('Text style').selectOption('h1')
  // "bold": select the word, then the toolbar. End/Home do not move the caret on macOS.
  await selectText('bold')
  await toolbar.getByRole('button', { name: 'Bold' }).click()
  // "words": highlight, bigger, coloured.
  await selectText('words')
  await toolbar.getByRole('button', { name: 'Highlight' }).click()
  await toolbar.getByRole('button', { name: 'More formatting' }).click()
  const panel = page.getByTestId('note-format-panel')
  await panel.getByLabel('Font size').selectOption('24px')
  await panel.getByRole('button', { name: 'Text colour: #1d4ed8' }).click()
  await panel.getByRole('button', { name: 'Align centre' }).click()
  await panel.getByLabel('Line spacing').selectOption('2')

  // A link on "Some" (Ctrl+K). Unsafe addresses are refused.
  await selectText('Some')
  await page.keyboard.press('ControlOrMeta+k')
  const address = page.getByLabel('Link address')
  await address.fill('javascript:alert(1)')
  await address.press('Enter')
  await expect(page.getByRole('alert').filter({ hasText: 'Only web' })).toBeVisible()
  await address.fill('example.com')
  await address.press('Enter')
  await expect(address).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
  const [note] = await notes()
  const doc = (await stored(note.id))!.data.content.doc
  expect(doc.content![0]).toMatchObject({ type: 'heading', attrs: { level: 1 } })
  expect(doc.content![1]).toMatchObject({
    type: 'paragraph',
    attrs: { textAlign: 'center', lineHeight: 2 }
  })
  expect(doc.content![2]).toMatchObject({ type: 'bulletList' })
  expect(hasMark(doc, 'bold', 'bold')).toBe(true)
  expect(hasMark(doc, 'words', 'highlight')).toBe(true)
  expect(hasMark(doc, 'Some', 'bold')).toBe(false)
  const words = textRuns(doc).find((r) => r.text === 'words')!
  expect(words.marks).toContainEqual({
    type: 'textStyle',
    attrs: expect.objectContaining({ fontSize: '24px', color: '#1d4ed8' })
  })
  const link = textRuns(doc).find((r) => r.marks.some((m) => m.type === 'link'))!
  expect(link.text).toBe('Some')
  expect(link.marks.find((m) => m.type === 'link')!.attrs).toMatchObject({
    href: 'https://example.com'
  })

  // The canvas draws it all: bold weight, heading size, the bullet.
  const layout = (await layoutOf(note.id))!
  expect(layout.runs.find((r) => r.text === 'bold')!.font).toContain('700')
  expect(layout.runs.find((r) => r.text === 'Title')!.fontSize).toBeCloseTo(28, 0)
  expect(layout.runs.find((r) => r.text.includes('words'))!.fontSize).toBe(24)
  expect(layout.markers.map((m) => m.text.trim())).toEqual(['•'])

  // Links on the canvas: a plain click only selects; Ctrl+click opens.
  await t.app.evaluate(({ shell }) => {
    const opened: string[] = []
    ;(globalThis as never as { opened: string[] }).opened = opened
    shell.openExternal = (async (url: string) => void opened.push(url)) as never
  })
  const run = layout.runs.find((r) => r.href)!
  const onLink = await notePoint(note, run.x + 5, run.top + 5)
  await page.mouse.click(onLink.x, onLink.y)
  await page.keyboard.down('ControlOrMeta')
  await page.mouse.click(onLink.x, onLink.y)
  await page.keyboard.up('ControlOrMeta')
  await expect
    .poll(() => t.app.evaluate(() => (globalThis as never as { opened: string[] }).opened))
    .toEqual(['https://example.com'])
  expect(await editingState()).toBeNull()
})

// ── 4–6. Sizing ──────────────────────────────────────────────────────────────

test('resizing reflows text without stretching it; auto-height grows and shrinks', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Sizing')
  const note = await typeNewNote('one two three four five six seven eight nine ten eleven twelve')
  const lines = async () => new Set((await layoutOf(note.id))!.runs.map((r) => r.top)).size
  const before = await lines()
  const c = await noteCenter(note)
  await page.mouse.click(c.x, c.y)

  // Narrower from the right-hand handle: more lines, taller, same letter size.
  const handle = await notePoint(note, note.width, note.height / 2)
  await dragTo(page, handle, { x: handle.x - 120, y: handle.y })
  await expect.poll(async () => (await notes())[0].width).toBeCloseTo(note.width - 120, 0)
  const narrow = (await notes())[0]
  expect(narrow.height).toBeGreaterThan(note.height)
  expect(await lines()).toBeGreaterThan(before)
  expect((await layoutOf(note.id))!.runs.every((r) => r.fontSize === 16)).toBe(true)
  expect((await stored(note.id))!.height).toBeCloseTo((await layoutOf(note.id))!.height, 1)

  // Auto-height follows the text: more paragraphs, taller; less text, shorter again.
  await startEditing(narrow)
  await moveCursor([END_OF_NOTE])
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`Line ${i}`)
  }
  await expect(status()).toHaveAttribute('data-status', 'saved')
  const tall = (await stored(note.id))!
  expect(tall.height).toBeGreaterThan(narrow.height + 60)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('x')
  await expect(status()).toHaveAttribute('data-status', 'saved')
  await expect.poll(async () => (await stored(note.id))!.height).toBeLessThan(narrow.height)
  await page.keyboard.press('Escape')
})

test('fixed height: text scrolls inside the note, fit to content', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Fixed')
  const note = await typeNewNote('First line')
  await startEditing(note)
  await page.getByRole('button', { name: 'More formatting' }).click()
  await page.getByRole('radio', { name: 'Fixed' }).click()
  await expect.poll(async () => (await stored(note.id))!.data.sizing).toBe('fixed')
  await moveCursor([END_OF_NOTE])
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Enter')
    await page.keyboard.type(`More text ${i}`)
  }
  await expect(status()).toHaveAttribute('data-status', 'saved')
  // A fixed note keeps its height while text is added.
  expect((await stored(note.id))!.height).toBeCloseTo(note.height, 1)
  // The editor scrolls inside the note to keep the cursor visible; the camera doesn't move.
  const camera = await viewport()
  await expect.poll(() => editorBox().evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await viewport()).toEqual(camera)
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()

  // On the canvas, the wheel over the selected note scrolls its text, not the canvas.
  const fixed = (await notes())[0]
  const c = await noteCenter(fixed)
  await page.mouse.click(c.x, c.y)
  const scrollOf = () =>
    page.evaluate((id) => (window as never as Cw).__cw.notes.getState().scroll[id] ?? 0, fixed.id)
  const cam = await viewport()
  await page.mouse.wheel(0, -2000)
  await expect.poll(scrollOf).toBe(0)
  await page.mouse.wheel(0, 120)
  await expect.poll(scrollOf).toBeGreaterThan(0)
  expect(await viewport()).toEqual(cam)

  // "Fit to content" makes it exactly as tall as its text.
  await page.mouse.click(c.x, c.y, { button: 'right' })
  await page.getByRole('menuitem', { name: 'Fit to content' }).click()
  await expect
    .poll(async () => (await stored(fixed.id))!.height)
    .toBeCloseTo((await layoutOf(fixed.id))!.height, 0)
  expect((await stored(fixed.id))!.height).toBeGreaterThan(fixed.height + 100)
})

// ── 7. Rotate and move ───────────────────────────────────────────────────────

test('move and rotate a note, then edit it rotated', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Rotate')
  const note = await typeNewNote('Tilted words')
  const c = await noteCenter(note)
  await dragTo(page, c, { x: c.x + 80, y: c.y + 40 })
  await expect.poll(async () => (await notes())[0].x).toBeCloseTo(note.x + 80, 0)
  const moved = (await notes())[0]

  // Rotation handle above the top edge, Shift for 15° steps.
  const top = await notePoint(moved, moved.width / 2, 0)
  const middle = await noteCenter(moved)
  const handle = { x: top.x, y: top.y - 24 }
  const radius = middle.y - handle.y
  const angle = (37 * Math.PI) / 180
  await page.mouse.move(handle.x, handle.y)
  await page.keyboard.down('Shift')
  await page.mouse.down()
  await page.mouse.move(middle.x + radius * Math.sin(angle), middle.y - radius * Math.cos(angle), {
    steps: 8
  })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect.poll(async () => (await notes())[0].rotation).not.toBe(0)
  const rotated = (await notes())[0]
  expect(Math.abs(rotated.rotation % 15)).toBeLessThan(0.01)
  expect(rotated.rotation).toBeGreaterThanOrEqual(15)
  expect(rotated.rotation).toBeLessThanOrEqual(45)
  // Rotating never changes the note's size or the size of its letters.
  expect(rotated.width).toBeCloseTo(moved.width, 1)
  expect((await layoutOf(note.id))!.runs.every((r) => r.fontSize === 16)).toBe(true)

  // Editing a rotated note: the editor is rotated the same way, and typing works.
  await startEditing(rotated)
  const transform = await editorBox().evaluate((el) => el.style.transform)
  expect(transform).toContain(`rotate(${rotated.rotation}deg)`)
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' still')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await stored(note.id))!.data.plainText).toBe('Tilted words still')
})

// ── 8. Zoom ──────────────────────────────────────────────────────────────────

test('edit inline zoomed in (cursor where clicked) and zoomed far out (zooms to 100%)', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Zoom')
  const note = await typeNewNote('alpha omega')
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const zoom = (await viewport()).zoom
  expect(zoom).toBeGreaterThan(1.3)

  // Double-click just before "omega": the cursor lands there.
  const run = (await layoutOf(note.id))!.runs[0] as Run & { x: number; width: number }
  const omega = await page.evaluate(
    ({ text }) => {
      const ctx = document.createElement('canvas').getContext('2d')!
      ctx.font = text.font
      return ctx.measureText('alpha ').width
    },
    { text: run }
  )
  const at = await notePoint((await notes())[0], run.x + omega + 1, run.top + run.fontSize / 2)
  await page.mouse.dblclick(at.x, at.y)
  await expect(textArea()).toBeFocused()
  await page.keyboard.type('beta ')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await stored(note.id))!.data.plainText).toBe('alpha beta omega')

  // Far out: editing zooms to 100% so the text is readable.
  for (let i = 0; i < 6; i++) await page.getByRole('button', { name: 'Zoom out' }).click()
  expect((await viewport()).zoom).toBeLessThan(0.5)
  await startEditing((await notes())[0])
  expect((await viewport()).zoom).toBe(1)
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type('!')
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await stored(note.id))!.data.plainText).toBe('alpha beta omega!')
})

// ── 9. Expanded editor ───────────────────────────────────────────────────────

test('expanded editor: same note and typing history, changes appear on the canvas', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Expanded')
  const note = await typeNewNote('Short note')
  const c = await noteCenter(note)
  await page.mouse.click(c.x, c.y)

  await page.keyboard.press('ControlOrMeta+Shift+e')
  const dialog = page.getByTestId('note-expanded')
  await expect(dialog).toBeVisible()
  await expect(dialog.locator('.ProseMirror')).toBeFocused()
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' with more words')
  await expect(dialog.getByTestId('note-save-status')).toHaveAttribute('data-status', 'saved')

  // Back to the canvas editor keeps the typing history: Ctrl+Z still undoes the typing.
  await dialog.getByRole('button', { name: 'Edit on canvas' }).click()
  await expect(dialog).toBeHidden()
  await expect(textArea()).toBeFocused()
  await expect(textArea()).toHaveText('Short note with more words')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(textArea()).not.toHaveText('Short note with more words')
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect(textArea()).toHaveText('Short note with more words')

  // Expand again from the toolbar, and leave with "Back to canvas".
  await page.getByTestId('note-toolbar').getByRole('button', { name: 'Expand note' }).click()
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: '← Back to canvas' }).click()
  await expect(dialog).toBeHidden()
  expect(await editingState()).toBeNull()
  await expect
    .poll(async () => (await notes())[0].data.plainText)
    .toBe('Short note with more words')
  expect((await layoutOf(note.id))!.runs.map((r) => r.text).join('')).toContain('more words')
})

// ── 10. Paste ────────────────────────────────────────────────────────────────

test('paste: rich text cleaned, Ctrl+Shift+V plain, images never go inside notes', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Paste')
  const note = await typeNewNote('Start')
  await startEditing(note)
  await moveCursor([END_OF_NOTE])

  const html =
    '<p>Hi <b>strong</b> <span style="color: red; font-family: Comic Sans MS; font-size: 40px">red</span>' +
    ' <img src="x" onerror="window.__xss = 1"><script>window.__xss = 2</script>' +
    '<a href="javascript:window.__xss = 3">bad</a> <a href="https://ok.example/">good</a></p>' +
    '<table><tr><td>cell</td></tr></table>'
  await t.app.evaluate(async ({ clipboard, ClipboardItem }, h) => {
    await clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([h], { type: 'text/html' }),
        'text/plain': new Blob(['Hi strong red bad good cell'], { type: 'text/plain' })
      })
    ])
  }, html)
  await page.keyboard.press('ControlOrMeta+v')
  await expect(textArea()).toContainText('good')
  await expect(status()).toHaveAttribute('data-status', 'saved')
  let doc = (await stored(note.id))!.data.content.doc
  const json = JSON.stringify(doc)
  expect(json).not.toContain('image')
  expect(json).not.toContain('javascript')
  expect(json).not.toContain('Comic')
  expect(json).not.toContain('red;')
  expect(hasMark(doc, 'strong', 'bold')).toBe(true)
  const good = textRuns(doc).find((r) => r.text.includes('good'))!
  expect(good.marks).toContainEqual({
    type: 'link',
    attrs: expect.objectContaining({ href: 'https://ok.example/' })
  })
  expect(textRuns(doc).find((r) => r.text.includes('bad'))!.marks).toEqual([])
  expect(json).toContain('cell')
  expect(await page.evaluate(() => (window as never as { __xss?: number }).__xss)).toBeUndefined()

  // Ctrl/Cmd+Shift+V: the same clipboard as plain text, replacing the selection.
  await page.keyboard.press('ControlOrMeta+a')
  await synced(page)
  await page.keyboard.press('ControlOrMeta+Shift+v')
  await expect
    .poll(async () => (await stored(note.id))!.data.plainText)
    .toBe('Hi strong red bad good cell')
  doc = (await stored(note.id))!.data.content.doc
  expect(textRuns(doc).every((r) => r.marks.length === 0)).toBe(true)

  // An image on the clipboard: not put inside the note, and the user is told why.
  const png = await sharp({
    create: { width: 40, height: 30, channels: 3, background: { r: 10, g: 200, b: 10 } }
  })
    .png()
    .toBuffer()
  await t.app.evaluate(async ({ clipboard, ClipboardItem }, b64) => {
    const blob = new Blob([Buffer.from(b64, 'base64')], { type: 'image/png' })
    await clipboard.write([new ClipboardItem({ 'image/png': blob })])
  }, png.toString('base64'))
  const textBefore = (await stored(note.id))!.data.plainText
  await page.keyboard.press('ControlOrMeta+v')
  await expect(
    page.getByRole('status').filter({ hasText: 'Images can’t go inside notes' })
  ).toBeVisible()
  expect((await objects(page)).filter((o) => o.type === 'image')).toHaveLength(0)
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
  expect((await stored(note.id))!.data.plainText).toBe(textBefore)

  // On the canvas (not editing), the same image is pasted as an image object (M3A)…
  const box = await canvasBox(page)
  await page.mouse.click(box.x + box.width - 120, box.y + box.height - 120)
  await page.keyboard.press('ControlOrMeta+v')
  await expect
    .poll(async () => (await objects(page)).filter((o) => o.type === 'image').length)
    .toBe(1)
  // …and text pasted on the canvas doesn't make a note.
  await t.app.evaluate(async ({ clipboard }) => clipboard.writeText('just text'))
  await page.keyboard.press('ControlOrMeta+v')
  expect(await notes()).toHaveLength(1)
})

// ── 11. Shortcuts ────────────────────────────────────────────────────────────

test('while typing, keys edit the text and never act on the canvas', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Keys')
  const other = await typeNewNote('Another note', {
    x: (await canvasBox()).x + 650,
    y: (await canvasBox()).y + 120
  })
  const note = await typeNewNote('abc def')
  const camera = await viewport()
  await startEditing(note)

  await page.keyboard.press('ControlOrMeta+a') // select all text, not all objects
  expect(await selection()).toEqual([note.id])
  await page.keyboard.type('t') // not "new note"
  await moveCursor(['ArrowLeft']) // not "nudge"
  await page.keyboard.press('Delete') // a character, not the note
  await page.keyboard.press('Backspace')
  await page.keyboard.type('xyz ')
  await page.keyboard.press('ControlOrMeta+d') // not "duplicate"
  await page.keyboard.press('ControlOrMeta+g') // not "group"
  await page.keyboard.type('=-') // not "zoom in / out"
  await page.keyboard.press('Space') // not "pan"
  await page.keyboard.type('q')
  await expect(textArea()).toHaveText('xyz =- q')
  expect(await notes()).toHaveLength(2)
  expect((await notes()).find((n) => n.id === note.id)!.x).toBe(note.x)
  expect(await viewport()).toEqual(camera)

  // Ctrl+Z undoes typing, not canvas steps (the other note stays).
  await page.keyboard.press('ControlOrMeta+z')
  await expect(textArea()).not.toHaveText('xyz =- q')
  expect((await notes()).map((n) => n.id).sort()).toEqual([note.id, other.id].sort())

  // The canvas's undo button is off while typing.
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled()
  expect(await notes()).toHaveLength(2)
})

// ── 12. Undo across text and canvas ──────────────────────────────────────────

test('undo and redo step through text edits and canvas edits in order', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Undo')
  const note = await typeNewNote('One')
  const c = await noteCenter(note)
  await dragTo(page, c, { x: c.x + 100, y: c.y })
  await expect.poll(async () => (await notes())[0].x).toBeCloseTo(note.x + 100, 0)
  const moved = (await notes())[0]
  await startEditing(moved)
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('Two')
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()

  const text = async () => (await stored(note.id))!.data.plainText
  const x = async () => (await stored(note.id))!.x
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(text).toBe('One')
  await expect.poll(async () => (await notes())[0].data.plainText).toBe('One')
  expect(await x()).toBeCloseTo(moved.x, 0)
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(x).toBeCloseTo(note.x, 0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(x).toBeCloseTo(moved.x, 0)
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect.poll(text).toBe('Two')
  // The whole text session was one step: one more undo goes back to "One", not to "Tw".
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(text).toBe('One')
})

// ── 13. Persistence ──────────────────────────────────────────────────────────

test('reopening the project restores text, formatting, look, sizing and placement', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Persist')
  const box = await canvasBox(page)
  await page.mouse.dblclick(box.x + 300, box.y + 200)
  await expect(textArea()).toBeFocused()
  await page.keyboard.type('Bold ')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.type('part')
  await page.keyboard.press('ControlOrMeta+b')
  await page.keyboard.press('Enter')
  await page.getByTestId('note-toolbar').getByRole('button', { name: 'Numbered list' }).click()
  await page.keyboard.type('first')
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
  const [note] = await notes()
  // Fixed height first, so the new width can't re-measure the height.
  await page.evaluate(async (id) => {
    await window.api.invoke('notes:updateStyle', [
      { id, appearance: { mode: 'floating', padding: 8 }, sizing: 'fixed', height: 90 }
    ])
    await window.api.invoke('objects:update', [{ id, rotation: -12, width: 340 }])
  }, note.id)
  const saved = (await stored(note.id))!

  const dirs = { dataDir: t.dataDir, projectsDir: t.projectsDir }
  await t.close()
  t = await launchApp(dirs)
  await t.page.getByRole('button', { name: /^Persist/ }).click()
  await t.page.getByTestId('canvas').waitFor()
  await expect.poll(async () => (await notes(t.page)).length).toBe(1)
  // A freshly opened window isn't focused, so a double-click in it wouldn't register.
  await t.page.bringToFront()
  const reopened = (await notes(t.page))[0]
  expect(reopened).toMatchObject({
    x: saved.x,
    y: saved.y,
    width: 340,
    height: 90,
    rotation: -12,
    data: saved.data
  })
  expect(reopened.data.appearance).toMatchObject({ mode: 'floating', padding: 8 })
  // It's drawn, and editable again.
  await expect
    .poll(async () => (await layoutOf(note.id, t.page))?.markers.map((m) => m.text.trim()))
    .toEqual(['1.'])
  await startEditing(reopened, t.page)
  await expect(textArea(t.page)).toContainText('Bold part')
})

// ── 14–15. Two windows ───────────────────────────────────────────────────────

test('two windows: edits appear in the other window, which shows the note is being edited', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Sync')
  const note = await typeNewNote('Shared')
  const [second] = await Promise.all([
    t.app.waitForEvent('window'),
    page.getByRole('button', { name: 'Open in new window' }).click()
  ])
  await second.getByTestId('canvas').waitFor()
  await expect.poll(async () => (await notes(second)).map((n) => n.id)).toEqual([note.id])

  // A person clicks a window before typing in it; cursor keys only work in the focused window.
  await page.bringToFront()
  await startEditing((await notes())[0])
  const othersSee = () =>
    second.evaluate(
      (id) => (window as never as Cw).__cw.notes.getState().editedElsewhere.has(id),
      note.id
    )
  await expect.poll(othersSee).toBe(true)
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' text')
  // The other window gets the saved text while this one is still typing.
  await expect.poll(async () => (await notes(second))[0].data.plainText).toBe('Shared text')
  await expect
    .poll(async () => (await layoutOf(note.id, second))?.runs.map((r) => r.text).join(''))
    .toBe('Shared text')
  await page.keyboard.press('Escape')
  await expect.poll(othersSee).toBe(false)

  // Look changes made in the other window arrive too.
  await second.evaluate(
    (id) => window.api.invoke('notes:updateStyle', [{ id, appearance: { mode: 'floating' } }]),
    note.id
  )
  await expect.poll(async () => (await notes())[0].data.appearance.mode).toBe('floating')
})

test('two windows can’t overwrite each other: take over, conflicts, deleted notes', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Conflicts')
  const note = await typeNewNote('Original')
  const [second] = await Promise.all([
    t.app.waitForEvent('window'),
    page.getByRole('button', { name: 'Open in new window' }).click()
  ])
  await second.getByTestId('canvas').waitFor()
  await expect.poll(async () => (await notes(second)).length).toBe(1)

  // Window 1 is typing; window 2 can't just start editing the same note. (A person clicks a
  // window before typing in it; cursor keys only work in the focused window.)
  await page.bringToFront()
  await startEditing(note)
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' plus mine')
  const c2 = await noteCenter((await notes(second))[0], second)
  await second.bringToFront()
  await second.mouse.dblclick(c2.x, c2.y)
  await expect(second.getByTestId('note-blocked')).toBeVisible()
  expect(await editingState(second)).toBeNull()

  // "Edit here instead": window 1 saves what it has and stops; window 2 starts from it.
  await second.getByRole('button', { name: 'Edit here instead' }).click()
  await expect(textArea(second)).toBeFocused()
  await expect(textArea(second)).toHaveText('Original plus mine')
  await expect(page.getByTestId('note-notice')).toContainText(
    'Another window is editing this note now'
  )
  await expect(textArea()).toHaveAttribute('contenteditable', 'false')
  await moveCursor([END_OF_NOTE], second)
  await second.keyboard.type(' and theirs')
  await second.keyboard.press('Escape')
  await expect
    .poll(async () => (await stored(note.id))!.data.plainText)
    .toBe('Original plus mine and theirs')
  await page.bringToFront()
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
  expect((await stored(note.id))!.data.plainText).toBe('Original plus mine and theirs')

  // A save from elsewhere lands while window 1 is typing: window 1's next save is refused
  // and the user chooses. "Keep both" keeps theirs and adds mine as a new note.
  await startEditing((await notes())[0])
  const current = (await stored(note.id))!
  await second.evaluate(
    ({ id, revision }) =>
      window.api.invoke('notes:saveContent', {
        id,
        baseRevision: revision,
        content: {
          schemaVersion: 1,
          doc: {
            type: 'doc',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Theirs' }] }]
          }
        }
      }),
    { id: note.id, revision: current.revision }
  )
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' mine again')
  await expect(page.getByTestId('note-notice')).toContainText('changed this note in another window')
  expect((await stored(note.id))!.data.plainText).toBe('Theirs')
  await page.getByRole('button', { name: 'Keep both' }).click()
  await expect.poll(async () => (await notes()).length).toBe(2)
  const texts = (await notes()).map((n) => n.data.plainText).sort()
  expect(texts).toEqual(['Original plus mine and theirs mine again', 'Theirs'])
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()

  // The note goes to the trash in window 2 while window 1 is editing it: the text isn't lost.
  const target = (await notes()).find((n) => n.data.plainText === 'Theirs')!
  await startEditing(target)
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' rescued')
  await expect(status()).toHaveAttribute('data-status', 'saved')
  await second.evaluate((id) => window.api.invoke('objects:delete', [id]), target.id)
  await expect(page.getByTestId('note-notice')).toContainText('moved to the trash')
  // The text stays on screen while the user decides.
  await expect(textArea()).toHaveText('Theirs rescued')
  await page.getByRole('button', { name: 'Keep my text as a new note' }).click()
  await expect(editorBox()).toBeHidden()
  await expect
    .poll(async () => (await notes()).map((n) => n.data.plainText).sort())
    .toEqual(['Original plus mine and theirs mine again', 'Theirs rescued'])
})

// ── Failure cases ────────────────────────────────────────────────────────────

test('a failed save keeps the note open with the text, retries, and recovers', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Failing')
  const note = await typeNewNote('Safe')
  // Make saving fail, as a full disk would.
  await t.app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as never as { _invokeHandlers: Map<string, unknown> })._invokeHandlers
    ;(globalThis as never as { realSave: unknown }).realSave = handlers.get('notes:saveContent')
    handlers.set('notes:saveContent', () => {
      throw new Error('Disk full')
    })
  })
  await startEditing(note)
  await moveCursor([END_OF_NOTE])
  await page.keyboard.type(' and sound')
  await expect(status()).toHaveAttribute('data-status', 'error')
  await expect(page.getByTestId('note-notice')).toContainText('aren’t saved yet')
  // Leaving doesn't throw the text away: the note stays open.
  await page.keyboard.press('Escape')
  await expect(textArea()).toHaveText('Safe and sound')
  expect((await stored(note.id))!.data.plainText).toBe('Safe')

  await t.app.evaluate(({ ipcMain }) => {
    const handlers = (ipcMain as never as { _invokeHandlers: Map<string, unknown> })._invokeHandlers
    handlers.set('notes:saveContent', (globalThis as never as { realSave: unknown }).realSave)
  })
  await page.getByRole('button', { name: 'Try now' }).click()
  await expect(status()).toHaveAttribute('data-status', 'saved')
  expect((await stored(note.id))!.data.plainText).toBe('Safe and sound')
  await page.keyboard.press('Escape')
  await expect(editorBox()).toBeHidden()
})

test('closing the window right after typing saves the text first', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Closing')
  const box = await canvasBox(page)
  await page.mouse.dblclick(box.x + 300, box.y + 200)
  await expect(textArea()).toBeFocused()
  // Typed and closed straight away, before the autosave delay.
  await page.keyboard.type('Last words')
  const dirs = { dataDir: t.dataDir, projectsDir: t.projectsDir }
  await Promise.all([
    page.waitForEvent('close'),
    t.app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  ])
  // On Windows the app quits with its last window; on macOS it keeps running until closed.
  await t.close().catch(() => {})
  t = await launchApp(dirs)
  await t.page.getByRole('button', { name: /^Closing/ }).click()
  await t.page.getByTestId('canvas').waitFor()
  await expect
    .poll(async () => (await notes(t.page)).map((n) => n.data.plainText))
    .toEqual(['Last words'])
})

test('a damaged note shows a placeholder; the board and other notes keep working', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Damaged')
  const good = await typeNewNote('Fine note')
  // The good note sits at the default spot. Keep this one in the same central column, above it:
  // far enough right to clear the toolbar, far enough left to stay on screen in CI's smaller window.
  const box = await canvasBox()
  const bad = await typeNewNote('Will be damaged', { x: box.x + 420, y: box.y + 100 })
  const dirs = { dataDir: t.dataDir, projectsDir: t.projectsDir }
  await t.close()

  // Damage the stored text the way a broken file or an older bug might.
  execFileSync(
    electronPath as never as string,
    [
      '-e',
      // Electron on macOS inserts its own process.argv entries, so the script finds its arguments
      // by what they look like instead of trusting their position.
      `const Database = require('better-sqlite3')
       const args = process.argv.slice(1)
       const dbPath = args.find((a) => a.endsWith('project.db'))
       const id = args.find((a) => /^[0-9a-f-]{36}$/i.test(a))
       if (!dbPath || !id) throw new Error('Arguments not found in ' + JSON.stringify(process.argv))
       const db = new Database(dbPath)
       const { changes } = db.prepare('UPDATE board_objects SET data = ? WHERE id = ?')
         .run(JSON.stringify({ content: 'garbage', plainText: 'Will be damaged' }), id)
       db.close()
       if (changes !== 1) throw new Error('Expected to damage 1 note, damaged ' + changes)`,
      join(t.projectsDir, 'Damaged.cwproj', 'project.db'),
      bad.id
    ],
    { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, cwd: process.cwd() }
  )

  t = await launchApp(dirs)
  await t.page.getByRole('button', { name: /^Damaged/ }).click()
  await t.page.getByTestId('canvas').waitFor()
  await expect.poll(async () => (await notes(t.page)).length).toBe(2)
  // The good note is drawn; the damaged one can't be edited but explains itself.
  await expect.poll(async () => (await layoutOf(good.id, t.page))?.runs[0].text).toBe('Fine note')
  // The reopened app is reading the database the script damaged.
  expect(JSON.stringify((await stored(bad.id, t.page))!.data.content)).toContain('garbage')
  const damaged = (await notes(t.page)).find((n) => n.id === bad.id)!
  const c = await noteCenter(damaged, t.page)
  await t.page.bringToFront()
  await t.page.mouse.dblclick(c.x, c.y)
  await expect(t.page.getByRole('status').filter({ hasText: 'couldn’t be read' })).toBeVisible()
  expect(await editingState(t.page)).toBeNull()
  // It can still be moved or deleted like any object, and the good note still edits.
  await t.page.mouse.click(c.x, c.y)
  await t.page.keyboard.press('Delete')
  await expect.poll(async () => (await notes(t.page)).length).toBe(1)
  await startEditing((await notes(t.page))[0], t.page)
  await expect(textArea(t.page)).toHaveText('Fine note')
})

test('on a slow machine, quick typing and finishing still saves everything in order', async () => {
  const page = t.page
  await createProject(page, t.projectsDir, 'Slow')
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 6 })
  const box = await canvasBox(page)
  await page.mouse.dblclick(box.x + 300, box.y + 200)
  await expect(textArea()).toBeFocused()
  await page.keyboard.type('Typed quickly on a slow machine')
  await page.keyboard.press('Escape')
  // Straight away: drag the new note (the move waits for the text to be saved first).
  await expect(editorBox()).toBeHidden()
  const [note] = await notes()
  const c = await noteCenter(note)
  await dragTo(page, c, { x: c.x + 60, y: c.y + 30 })
  await page.keyboard.press('ControlOrMeta+z')
  await expect.poll(async () => (await stored(note.id))!.x).toBeCloseTo(note.x, 0)
  expect((await stored(note.id))!.data.plainText).toBe('Typed quickly on a slow machine')
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 })
})
