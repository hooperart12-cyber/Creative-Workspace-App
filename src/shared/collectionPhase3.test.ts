import { describe, expect, it } from 'vitest'
import { bulkDecision, preflightBulk } from './collectionBulk'
import { dragGhost, dropPlan, neighborPreview, type DragPage } from './collectionDrag'
import { planStagedImport, stageImportNames } from './collectionImport'
import {
  collectionQueryActive,
  filterCollectionPages,
  hiddenSelectionCount,
  visiblePageRange,
  type CollectionSearchPage
} from './collectionSearch'

function page(patch: Partial<CollectionSearchPage> & { id: string }): CollectionSearchPage {
  return {
    title: '',
    label: '',
    notes: '',
    number: null,
    overallStatus: 'not_started',
    role: 'story',
    spreadId: null,
    span: 1,
    versionNames: [],
    fileNames: [],
    tags: [],
    comments: [],
    stageNotes: [],
    blank: true,
    ...patch
  }
}

describe('collection search', () => {
  const pages = [
    page({ id: 'cover', title: 'Cover', role: 'cover', number: null, blank: true }),
    page({
      id: 'two',
      title: 'Page 2',
      number: 2,
      notes: 'rain',
      tags: ['Inks'],
      comments: ['check the gutter'],
      fileNames: ['Page 2.png']
    }),
    page({ id: 'ten', title: 'Page 10', number: 10, overallStatus: 'done' })
  ]

  it('keeps sequence order and does not treat the query as a saved view', () => {
    expect(filterCollectionPages(pages, 'page').map((item) => item.id)).toEqual(['two', 'ten'])
    expect(filterCollectionPages(pages, 'tag:inks').map((item) => item.id)).toEqual(['two'])
    expect(filterCollectionPages(pages, 'status:done').map((item) => item.id)).toEqual(['ten'])
    expect(filterCollectionPages(pages, 'gutter').map((item) => item.id)).toEqual(['two'])
    expect(collectionQueryActive('  page ')).toBe(true)
    expect(collectionQueryActive('   ')).toBe(false)
    expect(hiddenSelectionCount(['two', 'ten', 'cover'], ['two'])).toBe(2)
  })

  it('draws a window of the grid instead of every page', () => {
    const range = visiblePageRange({
      count: 100,
      scrollTop: 0,
      viewport: 200,
      rowHeight: 100,
      columns: 4
    })
    expect(range.start).toBe(0)
    expect(range.end).toBeLessThan(100)
    expect(range.end).toBeGreaterThan(4)
  })
})

describe('bulk preview', () => {
  const pages = [
    { id: 'a', notes: 'keep', overallStatus: 'not_started', role: 'story' },
    { id: 'b', notes: 'other', overallStatus: 'done', role: 'story' }
  ]

  it('changes only status and leaves notes off the patch', () => {
    const preview = preflightBulk(pages, ['a', 'b'], { kind: 'status', status: 'done' })
    expect(preview.fields).toEqual(['overallStatus'])
    expect(preview.changed).toEqual(['a'])
    expect(preview.alreadyMatching).toEqual(['b'])
    expect(preview.dangerous).toBe(false)
    const decision = bulkDecision(pages[0]!, { kind: 'status', status: 'done' })
    expect(decision).toEqual({
      kind: 'change',
      patch: { overallStatus: 'done' },
      previous: { overallStatus: 'not_started' }
    })
    expect(decision.kind === 'change' && decision.patch.notes).toBeUndefined()
  })

  it('appends a note and marks replacing notes as dangerous', () => {
    const appended = bulkDecision(pages[0]!, { kind: 'append-notes', text: 'later' })
    expect(appended).toMatchObject({ kind: 'change', patch: { notes: 'keep\nlater' } })
    const preview = preflightBulk(pages, ['a'], { kind: 'replace-notes', text: 'gone' })
    expect(preview.dangerous).toBe(true)
    expect(preview.fields).toEqual(['notes'])
  })
})

describe('staged import plan', () => {
  it('sorts naturally, rejects unsafe and non-images, and does not apply version groups', () => {
    const staged = stageImportNames([
      'folder/Page 10.png',
      'folder/Page 2.png',
      '../secret.png',
      'notes.txt',
      'chapter.pdf',
      'folder/Page 2.png',
      'Page 2 inks.png',
      'Page 2 final.png'
    ])
    const accepted = staged.filter((entry) => entry.accepted).map((entry) => entry.name)
    expect(accepted).toEqual([
      'folder/Page 2.png',
      'folder/Page 10.png',
      'Page 2 final.png',
      'Page 2 inks.png'
    ])
    expect(staged.find((entry) => entry.name === '../secret.png')?.reason).toBe('Unsafe path.')
    expect(staged.find((entry) => entry.name === 'chapter.pdf')?.reason).toMatch(/PDF/)
    expect(staged.find((entry) => entry.name === 'notes.txt')?.accepted).toBe(false)
    const suggested = staged
      .filter((entry) => entry.suggestion === 'version')
      .map((entry) => entry.name)
    expect(suggested).toEqual(['Page 2 final.png', 'Page 2 inks.png'])
    const separate = planStagedImport({
      entries: staged,
      placeholders: [],
      mode: 'append',
      applyVersionGroups: false
    })
    expect(separate.actions).toHaveLength(4)
    expect(separate.actions.every((action) => action.names.length === 1)).toBe(true)
    const grouped = planStagedImport({
      entries: staged,
      placeholders: [],
      mode: 'append',
      applyVersionGroups: true
    })
    const versionPage = grouped.actions.find((action) => action.names.length === 2)
    expect(versionPage?.names).toEqual(['Page 2 final.png', 'Page 2 inks.png'])
  })

  it('fills empty placeholders and leaves extra files uncommitted', () => {
    const entries = stageImportNames(['a.png', 'b.png', 'c.png'])
    const plan = planStagedImport({
      entries,
      placeholders: [
        { id: 'blank', hasArtwork: false },
        { id: 'full', hasArtwork: true }
      ],
      mode: 'fill',
      applyVersionGroups: false
    })
    expect(plan.actions).toEqual([{ kind: 'fill', pageId: 'blank', names: ['a.png'] }])
    expect(plan.leftover).toEqual(['b.png', 'c.png'])
  })
})

describe('drag plan', () => {
  const pages: DragPage[] = [
    { id: 'open', span: 1, spreadId: null },
    { id: 'left', span: 1, spreadId: 'pair' },
    { id: 'right', span: 1, spreadId: 'pair' },
    { id: 'wide', span: 2, spreadId: null }
  ]

  it('moves a locked pair together and refuses a split', () => {
    expect(dragGhost(pages, ['left'])).toEqual({ count: 2, locked: true, wide: false })
    const between = dropPlan(pages, ['wide'], 'right', 'before')
    expect(between.ok).toBe(false)
    if (!between.ok) expect(between.error).toMatch(/split/)
    const before = [...pages]
    const plan = dropPlan(pages, ['left'], 'open', 'before')
    expect(plan).toMatchObject({ ok: true, pageIds: ['left', 'right'], beforeId: 'open' })
    expect(pages).toEqual(before)
    if (plan.ok) {
      expect(neighborPreview(pages, plan.pageIds, plan.beforeId)).toEqual({
        earlier: null,
        later: 'open'
      })
    }
  })
})
