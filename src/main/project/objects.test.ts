import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardObjects } from '../db/schema'
import { MIN_OBJECT_SIZE } from './objects'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-objects-'))
  project = Project.create(dir, 'Art', migrations)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

const objectsOn = (boardId: string) => project.boards.get(boardId).objects
const titled = (boardId: string) => objectsOn(boardId).map((o) => o.board?.title ?? o.type)

/** A plain (non-board) object, standing in for the images/notes that arrive in M3. */
function addNote(boardId: string, x: number, y: number, zIndex = 0): string {
  const id = randomUUID()
  project.db
    .insert(boardObjects)
    .values({ id, boardId, type: 'note', x, y, width: 100, height: 50, zIndex })
    .run()
  return id
}

describe('ObjectRepository.update', () => {
  it('applies several patches at once', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const b = project.boards.create(main, 'B')
    const group = randomUUID()
    project.objects.update([
      { id: a.objectId, x: 10, y: 20, width: 300, locked: true, groupId: group },
      { id: b.objectId, rotation: 15, zIndex: 9, groupId: group }
    ])
    const [ca, cb] = objectsOn(main)
    expect(ca).toMatchObject({ x: 10, y: 20, width: 300, locked: true, groupId: group })
    expect(cb).toMatchObject({ rotation: 15, zIndex: 9, groupId: group })
  })

  it('enforces a minimum size', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    project.objects.update([{ id: a.objectId, width: 1, height: -50 }])
    expect(objectsOn(project.mainBoardId)[0]).toMatchObject({
      width: MIN_OBJECT_SIZE,
      height: MIN_OBJECT_SIZE
    })
  })

  it('rolls back everything if one object is missing', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    expect(() =>
      project.objects.update([
        { id: a.objectId, x: 999 },
        { id: 'missing', x: 1 }
      ])
    ).toThrow(/not found/)
    expect(objectsOn(project.mainBoardId)[0].x).toBe(0)
  })
})

describe('ObjectRepository.delete / restore', () => {
  it('trashes plain objects and board cards (with their boards), and restores them', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    project.boards.create(a.id, 'Inner')
    const note = addNote(main, 0, 500)

    project.objects.delete([a.objectId, note])
    expect(objectsOn(main)).toHaveLength(0)
    expect(project.boards.list().map((b) => b.title)).toEqual(['Art'])

    project.objects.restore([a.objectId, note])
    expect(titled(main).sort()).toEqual(['A', 'note'])
    expect(titled(a.id)).toEqual(['Inner'])
  })
})

describe('ObjectRepository.moveToBoard', () => {
  it('nests board cards into another board, keeping their relative layout', () => {
    const main = project.mainBoardId
    const target = project.boards.create(main, 'Target', { x: 0, y: 0 })
    const a = project.boards.create(main, 'A', { x: 400, y: 100 })
    const b = project.boards.create(main, 'B', { x: 700, y: 160 })

    project.objects.moveToBoard([a.objectId, b.objectId], target.id, { x: 20, y: 30 })
    expect(titled(main)).toEqual(['Target'])
    const moved = objectsOn(target.id)
    expect(moved.map((o) => [o.board!.title, o.x, o.y])).toEqual([
      ['A', 20, 30],
      ['B', 320, 90]
    ])
    expect(project.boards.get(a.id).breadcrumb.map((c) => c.title)).toEqual(['Art', 'Target', 'A'])
  })

  it('moves plain objects and places them below existing content by default', () => {
    const main = project.mainBoardId
    const target = project.boards.create(main, 'Target')
    project.boards.create(target.id, 'Existing', { x: 0, y: 0 })
    const note = addNote(main, 900, 900)

    project.objects.moveToBoard([note], target.id)
    const moved = objectsOn(target.id).find((o) => o.id === note)!
    expect(moved).toMatchObject({ boardId: target.id, x: 0, y: 160 + 40 })
  })

  it('refuses to nest a board inside itself and changes nothing', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const note = addNote(main, 0, 0)
    expect(() => project.objects.moveToBoard([note, a.objectId], a.id)).toThrow(/inside itself/)
    expect(titled(main).sort()).toEqual(['A', 'note'])
  })
})

describe('ObjectRepository.copyTo', () => {
  it('copies objects at a new position, deep-copying boards, with fresh groups', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A', { x: 100, y: 100 })
    project.boards.create(a.id, 'Inner')
    const note = addNote(main, 300, 150)
    const group = randomUUID()
    project.objects.update([
      { id: a.objectId, groupId: group },
      { id: note, groupId: group }
    ])

    const [copyA, copyNote] = project.objects.copyTo([a.objectId, note], main, { x: 120, y: 120 })
    const all = objectsOn(main)
    const cA = all.find((o) => o.id === copyA)!
    const cNote = all.find((o) => o.id === copyNote)!
    expect(cA).toMatchObject({ x: 120, y: 120 })
    expect(cNote).toMatchObject({ x: 320, y: 170, type: 'note' })
    expect(cA.groupId).toBe(cNote.groupId)
    expect(cA.groupId).not.toBe(group)
    expect(cA.linkedBoardId).not.toBe(a.id)
    expect(titled(cA.linkedBoardId!)).toEqual(['Inner'])
    // Copies sit above the originals.
    expect(Math.min(cA.zIndex, cNote.zIndex)).toBeGreaterThan(
      Math.max(...all.filter((o) => o.id !== copyA && o.id !== copyNote).map((o) => o.zIndex))
    )
  })
})
