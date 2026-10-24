import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardObjects } from '../db/schema'
import { BOARD_CARD_SIZE, DEFAULT_BOARD_TITLE, PLACEMENT_GAP } from './boards'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-boards-'))
  project = Project.create(dir, 'Manga', migrations)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

/** Board cards on a board, as the canvas sees them. */
const cards = (boardId: string) =>
  project.boards
    .get(boardId)
    .objects.filter((o) => o.type === 'board')
    .map((o) => ({ ...o, title: o.board!.title, childBoardCount: o.board!.childBoardCount }))

const cardsOn = (boardId: string) =>
  project.db
    .select()
    .from(boardObjects)
    .where(and(eq(boardObjects.boardId, boardId), isNull(boardObjects.deletedAt)))
    .all()

describe('BoardRepository', () => {
  it('creates nested boards with a card on the parent and a breadcrumb', () => {
    const main = project.mainBoardId
    const characters = project.boards.create(main, 'Characters')
    const hero = project.boards.create(characters.id, 'Hero')

    const mainView = project.boards.get(main)
    expect(mainView.isMain).toBe(true)
    expect(cards(main)).toHaveLength(1)
    expect(cards(main)[0]).toMatchObject({
      linkedBoardId: characters.id,
      title: 'Characters',
      childBoardCount: 1,
      ...BOARD_CARD_SIZE
    })
    expect(mainView.viewport).toEqual({ x: 0, y: 0, zoom: 1 })

    const heroView = project.boards.get(hero.id)
    expect(heroView.breadcrumb.map((b) => b.title)).toEqual(['Manga', 'Characters', 'Hero'])
    expect(heroView.isMain).toBe(false)
  })

  it('defaults the title and places new cards below existing content', () => {
    const main = project.mainBoardId
    const first = project.boards.create(main)
    expect(first.title).toBe(DEFAULT_BOARD_TITLE)
    project.boards.create(main, 'Placed', { x: 500, y: 300 })
    project.boards.create(main, 'Auto')

    const positions = cards(main).map((c) => [c.title, c.x, c.y])
    expect(positions).toEqual([
      [DEFAULT_BOARD_TITLE, 0, 0],
      ['Placed', 500, 300],
      // Left edge of all content, below the lowest bottom edge (300 + card height).
      ['Auto', 0, 300 + BOARD_CARD_SIZE.height + PLACEMENT_GAP]
    ])
  })

  it('stacks new cards on top (z-order)', () => {
    const main = project.mainBoardId
    project.boards.create(main, 'A')
    project.boards.create(main, 'B')
    const [a, b] = cards(main)
    expect(b.zIndex).toBeGreaterThan(a.zIndex)
  })

  it('saves the viewport per board', () => {
    project.boards.setViewport(project.mainBoardId, { x: -120, y: 40, zoom: 0.5 })
    expect(project.boards.get(project.mainBoardId).viewport).toEqual({ x: -120, y: 40, zoom: 0.5 })
  })

  it('renames boards and rejects empty names', () => {
    const board = project.boards.create(project.mainBoardId, 'Old')
    project.boards.rename(board.id, '  New  ')
    expect(project.boards.get(board.id).title).toBe('New')
    expect(() => project.boards.rename(board.id, ' ')).toThrow(/cannot be empty/)
  })

  it('keeps the main board title in sync with the project name', () => {
    project.rename('Manga Volume 1')
    expect(project.boards.get(project.mainBoardId).title).toBe('Manga Volume 1')
  })

  it('moves a board and its card to a new parent', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const b = project.boards.create(main, 'B')
    project.boards.move(b.id, a.id)

    expect(cards(main).map((c) => c.title)).toEqual(['A'])
    expect(cards(a.id).map((c) => c.title)).toEqual(['B'])
    expect(project.boards.get(b.id).breadcrumb.map((x) => x.title)).toEqual(['Manga', 'A', 'B'])
  })

  it('prevents moving a board inside itself or its descendants, and moving the main board', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const b = project.boards.create(a.id, 'B')
    const c = project.boards.create(b.id, 'C')
    expect(() => project.boards.move(a.id, a.id)).toThrow(/inside itself/)
    expect(() => project.boards.move(a.id, c.id)).toThrow(/inside itself/)
    expect(() => project.boards.move(main, a.id)).toThrow(/main board cannot be moved/)
  })

  it('soft-deletes a board with its descendants and their cards', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const b = project.boards.create(a.id, 'B')
    project.boards.create(b.id, 'C')
    const keep = project.boards.create(main, 'Keep')

    const { deletedBoardIds } = project.boards.delete(a.id)
    expect(deletedBoardIds).toHaveLength(3)
    expect(project.boards.list().map((x) => x.title)).toEqual(['Manga', 'Keep'])
    expect(cards(main).map((c) => c.linkedBoardId)).toEqual([keep.id])
    expect(cardsOn(a.id)).toHaveLength(0)
    expect(() => project.boards.get(b.id)).toThrow(/not found/)
    expect(project.summary().boardCount).toBe(2)
  })

  it('restores a trashed board with everything trashed alongside it', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A', { x: 10, y: 20 })
    const b = project.boards.create(a.id, 'B')
    const c = project.boards.create(b.id, 'C')
    // C trashed separately, earlier: must stay trashed when A is restored.
    project.boards.delete(c.id)
    project.boards.delete(a.id)

    project.boards.restore(a.id)
    expect(project.boards.list().map((x) => x.title)).toEqual(['Manga', 'A', 'B'])
    expect(cards(main)[0]).toMatchObject({ title: 'A', x: 10, y: 20 })
    expect(cards(a.id).map((x) => x.title)).toEqual(['B'])
    expect(cards(b.id)).toHaveLength(0)
  })

  it('refuses to restore a board whose parent is still trashed', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    const b = project.boards.create(a.id, 'B')
    project.boards.delete(b.id)
    project.boards.delete(a.id)
    expect(() => project.boards.restore(b.id)).toThrow(/Restore the board it was inside first/)
  })

  it('deep-copies a board with its nested boards', () => {
    const main = project.mainBoardId
    const a = project.boards.create(main, 'A')
    const b = project.boards.create(a.id, 'B', { x: 50, y: 60 })
    project.boards.create(b.id, 'C')
    const target = project.boards.create(main, 'Target')

    const cardId = project.boards.duplicate(a.id, target.id, { x: 5, y: 5 })
    const copy = cards(target.id)
    expect(copy).toHaveLength(1)
    expect(copy[0]).toMatchObject({ id: cardId, title: 'A', x: 5, y: 5 })
    const copyA = copy[0].linkedBoardId!
    expect(copyA).not.toBe(a.id)
    expect(cards(copyA)[0]).toMatchObject({ title: 'B', x: 50, y: 60 })
    expect(cards(cards(copyA)[0].linkedBoardId!).map((x) => x.title)).toEqual(['C'])
    // The original is untouched.
    expect(cards(a.id).map((x) => x.linkedBoardId)).toEqual([b.id])
    expect(project.boards.list()).toHaveLength(8)
    expect(() => project.boards.duplicate(a.id, b.id, { x: 0, y: 0 })).toThrow(/inside itself/)
  })

  it('finds the card that represents a board', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    expect(project.boards.cardIdOf(a.id)).toBe(a.objectId)
    expect(project.boards.cardIdOf(project.mainBoardId)).toBeNull()
  })

  it('refuses to delete the main board', () => {
    expect(() => project.boards.delete(project.mainBoardId)).toThrow(/main board cannot be deleted/)
  })

  it('persists the hierarchy across reopen', () => {
    const a = project.boards.create(project.mainBoardId, 'A')
    project.boards.create(a.id, 'B')
    const path = project.path
    project.close()
    project = Project.open(path, migrations)
    expect(project.boards.list().map((x) => x.title)).toEqual(['Manga', 'A', 'B'])
  })
})

describe('FolderRepository', () => {
  it('creates, nests, renames and lists folders', () => {
    const refs = project.folders.create(null, 'References')
    const poses = project.folders.create(refs.id, 'Poses')
    project.folders.rename(poses.id, 'Pose refs')
    expect(project.folders.list()).toEqual([
      { id: poses.id, name: 'Pose refs', parentId: refs.id },
      { id: refs.id, name: 'References', parentId: null }
    ])
    expect(project.folders.create(null).name).toBe('New folder')
  })

  it('moves folders, including to the root, and prevents cycles', () => {
    const a = project.folders.create(null, 'A')
    const b = project.folders.create(a.id, 'B')
    expect(() => project.folders.move(a.id, b.id)).toThrow(/inside itself/)
    project.folders.move(b.id, null)
    expect(project.folders.list().find((f) => f.id === b.id)?.parentId).toBeNull()
  })

  it('soft-deletes a folder and its sub-folders', () => {
    const a = project.folders.create(null, 'A')
    project.folders.create(a.id, 'B')
    project.folders.create(null, 'Keep')
    expect(project.folders.delete(a.id).deletedFolderIds).toHaveLength(2)
    expect(project.folders.list().map((f) => f.name)).toEqual(['Keep'])
  })
})
