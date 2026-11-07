import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { visiblePageRange } from '@shared/collectionSearch'
import { writesResume } from '@shared/reader'
import { assets } from '../db/schema'
import { COLLECTION_CONFLICT } from './collections'
import { Project } from './project'

const migrations = resolve('drizzle')
let dir: string
let project: Project

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cw-m9-scale-'))
  project = Project.create(dir, 'Scale', migrations)
})

afterEach(() => {
  try {
    project?.close()
  } catch {
    // The project may already be closed.
  }
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      // Windows can keep the database locked briefly.
    }
  }
})

describe('collection conflicts and scale', () => {
  it('keeps a note when the same field is stale and accepts a different field', () => {
    const created = project.collections.create({ title: 'Race', placeholderCount: 1 })
    const page = project.collections.pages(created.id)[0]!
    const saved = project.collections.updatePage(page.id, page.revision, { notes: 'saved' })
    expect(() =>
      project.collections.updatePage(
        page.id,
        page.revision,
        { notes: 'stale' },
        { notes: page.notes }
      )
    ).toThrow(COLLECTION_CONFLICT)
    expect(project.collections.pages(created.id)[0]?.notes).toBe('saved')
    const titled = project.collections.updatePage(
      page.id,
      page.revision,
      { title: 'Cover' },
      { title: page.title }
    )
    const after = project.collections.pages(created.id)[0]!
    expect(after.notes).toBe('saved')
    expect(after.title).toBe('Cover')
    expect(after.revision).toBe(titled.revision)
    expect(titled.revision).toBe(saved.revision + 1)
  })

  it('does not undo over a newer edit', () => {
    const created = project.collections.create({ title: 'Undo', placeholderCount: 1 })
    const page = project.collections.pages(created.id)[0]!
    const bulk = project.collections.applyBulk([page.id], { kind: 'status', status: 'done' }, false)
    const undo = bulk.undo[0]
    if (!undo || undo.kind !== 'page') throw new Error('Expected a page undo.')
    project.collections.updatePage(page.id, undo.revision, { notes: 'newer' })
    expect(() => project.collections.undoBulk(bulk.undo)).toThrow(COLLECTION_CONFLICT)
    expect(project.collections.pages(created.id)[0]).toMatchObject({
      notes: 'newer',
      overallStatus: 'done'
    })
  })

  it('rolls back a move or reorder that would split a locked spread', () => {
    const created = project.collections.create({ title: 'Pair', placeholderCount: 3 })
    const other = project.collections.create({ title: 'Other', placeholderCount: 0 })
    const [first, second, third] = created.pageIds
    project.collections.lockSpread(first!, second!)
    project.collections.updatePage(first!, 0, { notes: 'stay' })
    const stage = project.collections.stages(created.id)[0]!
    project.collections.setStage(first!, stage.id, 'in_progress', 'pencils')
    expect(() => project.collections.reorder(created.id, [third!], second!)).toThrow(/split/)
    expect(() => project.collections.movePages([third!], other.id, 'missing')).toThrow(
      /not in this collection/
    )
    expect(project.collections.pages(created.id).map((page) => page.id)).toEqual([
      first,
      second,
      third
    ])
    expect(project.collections.pages(other.id)).toHaveLength(0)
    expect(project.collections.pages(created.id)[0]).toMatchObject({
      notes: 'stay',
      spreadId: expect.any(String)
    })
    expect(project.collections.detail(created.id).stageStates[0]).toMatchObject({
      pageId: first,
      note: 'pencils',
      state: 'in_progress'
    })
    expect(project.collections.pages(created.id)[0]?.overallStatus).toBe('not_started')
  })

  it('leaves the saved reader position when a window only closes', () => {
    const created = project.collections.create({ title: 'Read', placeholderCount: 2 })
    const [first, second] = created.pageIds
    project.collections.touchReader(created.id, {
      pageId: first!,
      layout: 'spread',
      zoom: 2,
      x: 8,
      y: -3
    })
    expect(writesResume('close')).toBe(false)
    expect(writesResume('refresh')).toBe(false)
    project.collections.rememberPlanner(created.id, {
      pageId: second!,
      view: 'spread',
      spreadZoom: 1.2
    })
    expect(project.collections.reader(created.id).resume).toMatchObject({
      pageId: first,
      layout: 'spread',
      zoom: 2,
      x: 8,
      y: -3
    })
    project.collections.touchReader(created.id, {
      pageId: second!,
      layout: 'single',
      zoom: 1.25,
      x: 0,
      y: 1
    })
    expect(project.collections.reader(created.id).resume).toMatchObject({
      pageId: second,
      layout: 'single',
      zoom: 1.25,
      x: 0,
      y: 1
    })
  })

  it('keeps a thousand blank pages as ids, and the grid draws a window', () => {
    const created = project.collections.create({ title: 'Long' })
    const inserted = project.collections.insertPages({ collectionId: created.id, count: 1000 })
    expect(inserted.pageIds).toHaveLength(1000)
    expect(new Set(inserted.pageIds).size).toBe(1000)
    const pages = project.collections.pages(created.id)
    expect(pages[0]?.id).toBe(inserted.pageIds[0])
    expect(pages[999]?.id).toBe(inserted.pageIds[999])
    expect(pages.every((page) => page.artwork === 'blank')).toBe(true)
    expect(project.db.select().from(assets).all()).toHaveLength(0)
    const opened = project.collections.reader(created.id)
    expect(opened.pages).toHaveLength(1000)
    expect(opened.pages.every((page) => page.sha256 === null)).toBe(true)
    const range = visiblePageRange({
      count: opened.pages.length,
      scrollTop: 2000,
      viewport: 600,
      rowHeight: 160,
      columns: 4
    })
    expect(range.start).toBeGreaterThan(0)
    expect(range.end).toBeLessThanOrEqual(1000)
    expect(range.end - range.start).toBeLessThan(40)
  })
})
