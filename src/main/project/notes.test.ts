import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { NOTE_MIN_HEIGHT, readNote, type NoteContent, type RichNode } from '@shared/notes'
import { boardObjects } from '../db/schema'
import { NoteLeases } from './noteLeases'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-notes-'))
  project = Project.create(dir, 'Writing', migrations)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const content = (text: string): NoteContent => ({
  schemaVersion: 1,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
})
const textOf = (id: string) => {
  const [note] = project.notes.get([id])
  const read = readNote(note.data)
  return read.ok ? read.note.plainText : null
}
const newNote = () => project.notes.create({ boardId: project.mainBoardId, at: { x: 10, y: 20 } })

describe('NoteRepository', () => {
  it('creates an empty note on a board', () => {
    const note = newNote()
    expect(note).toMatchObject({ type: 'text', x: 10, y: 20, revision: 0 })
    expect(project.boards.get(project.mainBoardId).objects.map((o) => o.id)).toEqual([note.id])
    const read = readNote(note.data)
    expect(read.ok && read.note.sizing).toBe('auto')
  })

  it('saves text based on the current revision', () => {
    const note = newNote()
    const first = project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('Hello'), height: 90 })
    expect(first).toEqual({ ok: true, revision: 1 })
    const second = project.notes.saveContent({ id: note.id, baseRevision: 1, content: content('Hello again') })
    expect(second).toEqual({ ok: true, revision: 2 })
    expect(textOf(note.id)).toBe('Hello again')
    expect(project.notes.get([note.id])[0].height).toBe(90)
  })

  it('refuses a save based on an older revision and returns the other version', () => {
    const note = newNote()
    project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('Window A') })
    const stale = project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('Window B') })
    expect(stale).toMatchObject({ ok: false, reason: 'conflict', revision: 1 })
    if (!stale.ok && stale.reason === 'conflict') {
      expect(stale.content?.doc.content?.[0].content?.[0].text).toBe('Window A')
    }
    // Nothing was overwritten.
    expect(textOf(note.id)).toBe('Window A')
  })

  it('reports a note trashed in the meantime instead of saving into the trash', () => {
    const note = newNote()
    project.objects.delete([note.id])
    expect(
      project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('late') })
    ).toEqual({ ok: false, reason: 'deleted' })
  })

  it('rejects content the note schema does not allow', () => {
    const note = newNote()
    const withImage: NoteContent = {
      schemaVersion: 1,
      doc: { type: 'doc', content: [{ type: 'image', attrs: { src: 'x.png' } } as RichNode] }
    }
    expect(() =>
      project.notes.saveContent({ id: note.id, baseRevision: 0, content: withImage })
    ).toThrow()
    expect(project.notes.get([note.id])[0].revision).toBe(0)
  })

  it('changes appearance without touching the text, and keeps height for fixed notes', () => {
    const note = newNote()
    project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('Keep me') })
    project.notes.updateStyle([
      { id: note.id, appearance: { mode: 'floating', padding: 4 }, sizing: 'fixed', height: 300 }
    ])
    const [after] = project.notes.get([note.id])
    const read = readNote(after.data)
    expect(read.ok && read.note.appearance).toMatchObject({ mode: 'floating', padding: 4, radius: 10 })
    expect(read.ok && read.note.sizing).toBe('fixed')
    expect(textOf(note.id)).toBe('Keep me')
    expect(after.height).toBe(300)
    // A fixed note's height is the user's: text saves don't change it.
    project.notes.saveContent({ id: note.id, baseRevision: 1, content: content('x'), height: 20 })
    expect(project.notes.get([note.id])[0].height).toBe(300)
  })

  it('never stores a height below the minimum', () => {
    const note = newNote()
    project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('a'), height: 3 })
    expect(project.notes.get([note.id])[0].height).toBe(NOTE_MIN_HEIGHT)
  })

  it('copies, trashes and restores notes with their text like any object', () => {
    const note = newNote()
    project.notes.saveContent({ id: note.id, baseRevision: 0, content: content('Copy me') })
    const [copy] = project.objects.copyTo([note.id], project.mainBoardId, { x: 400, y: 0 })
    expect(textOf(copy)).toBe('Copy me')
    project.objects.delete([note.id])
    expect(project.notes.get([note.id])).toEqual([])
    project.objects.restore([note.id])
    expect(textOf(note.id)).toBe('Copy me')
    // Deep-copying a board copies the notes on it.
    const child = project.boards.create(project.mainBoardId, 'Child')
    project.objects.moveToBoard([note.id], child.id)
    const [cardCopy] = project.objects.copyTo([child.objectId], project.mainBoardId, { x: 0, y: 0 })
    const copiedBoard = project.boards.get(project.mainBoardId).objects.find((o) => o.id === cardCopy)!
    const inside = project.boards.get(copiedBoard.linkedBoardId!).objects
    expect(inside.map((o) => o.type)).toEqual(['text'])
  })

  it('shows a damaged note as unreadable without breaking the board', () => {
    const note = newNote()
    project.db
      .update(boardObjects)
      .set({ data: { content: { schemaVersion: 1, doc: 'nonsense' }, plainText: 'old words' } })
      .where(eq(boardObjects.id, note.id))
      .run()
    const board = project.boards.get(project.mainBoardId)
    expect(board.objects).toHaveLength(1)
    expect(readNote(board.objects[0].data)).toEqual({ ok: false, plainText: 'old words' })
  })
})

describe('NoteLeases', () => {
  it('lets one window edit a note at a time', () => {
    const leases = new NoteLeases()
    expect(leases.acquire('p', 'n', 1)).toEqual({ ok: true })
    expect(leases.acquire('p', 'n', 1)).toEqual({ ok: true })
    expect(leases.acquire('p', 'n', 2)).toEqual({ ok: false })
    expect(leases.editedElsewhere('p', 2)).toEqual(['n'])
    expect(leases.editedElsewhere('p', 1)).toEqual([])
    // Same note id in another project is unrelated.
    expect(leases.acquire('q', 'n', 2)).toEqual({ ok: true })
  })

  it('hands a note over and reports who lost it', () => {
    const leases = new NoteLeases()
    leases.acquire('p', 'n', 1)
    expect(leases.takeOver('p', 'n', 2)).toBe(1)
    expect(leases.acquire('p', 'n', 1)).toEqual({ ok: false })
    // Releasing a lease you no longer hold does nothing.
    leases.release('p', 'n', 1)
    expect(leases.editedElsewhere('p', 1)).toEqual(['n'])
  })

  it('releases everything when a window closes', () => {
    const leases = new NoteLeases()
    leases.acquire('p', 'a', 1)
    leases.acquire('p', 'b', 1)
    expect(leases.holds(1)).toBe(true)
    expect(leases.releaseOwner(1)).toBe(true)
    expect(leases.holds(1)).toBe(false)
    expect(leases.acquire('p', 'a', 2)).toEqual({ ok: true })
    expect(leases.releaseOwner(1)).toBe(false)
  })
})
