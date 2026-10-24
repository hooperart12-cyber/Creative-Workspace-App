import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { boardObjects } from '../db/schema'
import { CARD_GRID, DEFAULT_BOARD_TITLE } from './boards'
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
    expect(mainView.cards).toHaveLength(1)
    expect(mainView.cards[0]).toMatchObject({
      boardId: characters.id,
      title: 'Characters',
      childBoardCount: 1
    })

    const heroView = project.boards.get(hero.id)
    expect(heroView.breadcrumb.map((b) => b.title)).toEqual(['Manga', 'Characters', 'Hero'])
    expect(heroView.isMain).toBe(false)
  })

  it('defaults the title and lays new cards out on a grid', () => {
    const main = project.mainBoardId
    const created = Array.from({ length: 5 }, () => project.boards.create(main))
    expect(created[0].title).toBe(DEFAULT_BOARD_TITLE)

    const cards = project.boards.get(main).cards
    expect(cards.map((c) => [c.x, c.y])).toEqual([
      [0, 0],
      [CARD_GRID.width + CARD_GRID.gap, 0],
      [2 * (CARD_GRID.width + CARD_GRID.gap), 0],
      [3 * (CARD_GRID.width + CARD_GRID.gap), 0],
      [0, CARD_GRID.height + CARD_GRID.gap]
    ])
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

    expect(project.boards.get(main).cards.map((c) => c.title)).toEqual(['A'])
    expect(project.boards.get(a.id).cards.map((c) => c.title)).toEqual(['B'])
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
    expect(project.boards.get(main).cards.map((c) => c.boardId)).toEqual([keep.id])
    expect(cardsOn(a.id)).toHaveLength(0)
    expect(() => project.boards.get(b.id)).toThrow(/not found/)
    expect(project.summary().boardCount).toBe(2)
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
