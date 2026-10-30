import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultComment } from '@shared/comments'
import { defaultConnection } from '@shared/connections'
import { parseConnection } from '@shared/connections'
import { Project } from './project'
import { RELATION_CONFLICT } from './relations'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-m8-'))
  project = Project.create(dir, 'Relations', migrations)
})
afterEach(() => {
  project.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('relations', () => {
  it('stores a connection behind other objects and refuses a stale edit', () => {
    const board = project.mainBoardId
    const created = project.relations.createConnection(board, { x: 0, y: 0 }, { x: 120, y: 40 })
    const detail = project.boards.get(board)
    const connection = detail.objects.find((object) => object.id === created.id)
    expect(connection?.type).toBe('connection')
    expect(connection?.zIndex).toBeLessThan(0)
    const data = parseConnection(connection?.data)
    expect(data?.style.endMarker).toBe('arrow')
    data!.label = { text: 'allies', t: 0.5, offset: 12 }
    const saved = project.relations.updateConnection(created.id, created.revision, data!)
    expect(saved.revision).toBe(1)
    expect(() => project.relations.updateConnection(created.id, created.revision, data!)).toThrow(
      RELATION_CONFLICT
    )
    const hits = project.search.search('allies', 'connection')
    expect(hits.map((hit) => hit.kind)).toEqual(['connection'])
  })

  it('detaches a connection when its object is deleted and reattaches on restore', () => {
    const board = project.mainBoardId
    const note = project.notes.create({ boardId: board, at: { x: 40, y: 40 } })
    const data = defaultConnection({ x: 0, y: 0 }, { x: 80, y: 80 })
    data.end.attachment = {
      kind: 'object',
      id: note.id,
      placement: 'auto',
      pin: null,
      missing: false,
      userHeld: false
    }
    const created = project.relations.createConnection(board, data.start, data.end, data)
    project.objects.delete([note.id])
    const detached = parseConnection(
      project.boards.get(board).objects.find((object) => object.id === created.id)?.data
    )
    expect(detached?.end.attachment?.missing).toBe(true)
    project.objects.restore([note.id])
    const back = parseConnection(
      project.boards.get(board).objects.find((object) => object.id === created.id)?.data
    )
    expect(back?.end.attachment?.missing).toBe(false)
    expect(back?.end.attachment?.id).toBe(note.id)
  })

  it('keeps a detached endpoint when asked and can put the reference back', () => {
    const board = project.mainBoardId
    const note = project.notes.create({ boardId: board, at: { x: 40, y: 40 } })
    const data = defaultConnection({ x: 0, y: 0 }, { x: 80, y: 80 })
    data.end.attachment = {
      kind: 'object',
      id: note.id,
      placement: 'auto',
      pin: null,
      missing: false,
      userHeld: false
    }
    const created = project.relations.createConnection(board, data.start, data.end, data)
    project.objects.delete([note.id])
    expect(project.relations.integrity().map((issue) => issue.id)).toContain(created.id)
    const kept = project.relations.repair(created.id, 'keep')
    expect(project.relations.integrity()).toEqual([])
    const held = parseConnection(
      project.boards.get(board).objects.find((object) => object.id === created.id)?.data
    )
    expect(held?.end.attachment?.missing).toBe(true)
    expect(held?.end.attachment?.userHeld).toBe(true)
    expect(project.boards.get(board).objects.some((object) => object.id === created.id)).toBe(true)
    project.relations.restore(created.id, kept.revision, kept.before)
    expect(project.relations.integrity().map((issue) => issue.id)).toContain(created.id)
  })

  it('copies a comment thread onto the new object and keeps an outside link', () => {
    const board = project.mainBoardId
    const note = project.notes.create({ boardId: board, at: { x: 10, y: 10 } })
    const comment = defaultComment({ x: 30, y: 30 })
    comment.anchor = {
      ...comment.anchor,
      scope: 'object',
      targetId: note.id,
      detached: 'none'
    }
    const created = project.relations.createComment(board, { x: 30, y: 30 }, comment, 'Look here')
    project.relations.addReply(created.id, created.revision, 'Agreed')
    const other = project.boards.create(board, 'Elsewhere')
    const link = project.relations.createLink(
      board,
      { x: 200, y: 20 },
      {
        version: 1,
        title: 'Elsewhere',
        destination: { kind: 'board', boardId: other.id, title: 'Elsewhere' }
      }
    )
    const copies = project.objects.copyTo([note.id, created.id, link.id], board, { x: 400, y: 10 })
    const copied = project.relations.decorate(project.boards.get(board).objects)
    const copyComment = copied.find((object) => object.id === copies[1])
    expect(copyComment?.messages?.map((message) => message.body)).toEqual(['Look here', 'Agreed'])
    const anchor = (copyComment?.data as { anchor?: { targetId?: string } }).anchor
    expect(anchor?.targetId).toBe(copies[0])
    expect(anchor?.targetId).not.toBe(note.id)
    const copyLink = copied.find((object) => object.id === copies[2])
    expect((copyLink?.data as { destination?: { boardId?: string } }).destination?.boardId).toBe(
      other.id
    )
  })

  it('moves an attached comment with its object and leaves the connection behind', () => {
    const board = project.mainBoardId
    const other = project.boards.create(board, 'Scene').id
    const note = project.notes.create({ boardId: board, at: { x: 10, y: 10 } })
    const comment = defaultComment({ x: 20, y: 20 })
    comment.anchor = { ...comment.anchor, scope: 'object', targetId: note.id }
    const created = project.relations.createComment(board, { x: 20, y: 20 }, comment, 'Note')
    const line = defaultConnection({ x: 0, y: 0 }, { x: 10, y: 10 })
    line.end.attachment = {
      kind: 'object',
      id: note.id,
      placement: 'pinned',
      pin: { edge: 'top', along: 0.5 },
      missing: false,
      userHeld: false
    }
    const connection = project.relations.createConnection(board, line.start, line.end, line)
    project.objects.moveToBoard([note.id], other, { x: 0, y: 0 })
    expect(project.boards.get(other).objects.some((object) => object.id === created.id)).toBe(true)
    const left = parseConnection(
      project.boards.get(board).objects.find((object) => object.id === connection.id)?.data
    )
    expect(left?.end.attachment?.missing).toBe(true)
    expect(project.boards.get(other).objects.some((object) => object.id === connection.id)).toBe(
      false
    )
  })
})
