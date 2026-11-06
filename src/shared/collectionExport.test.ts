import { describe, expect, it } from 'vitest'
import {
  nextForPackage,
  planCollectionExport,
  remapPackageDestination,
  validateCollectionPackage,
  type CollectionPackageDocument
} from './collectionExport'

const pages = [
  {
    id: 'cover',
    span: 2 as const,
    spreadId: null,
    role: 'cover',
    number: null,
    artwork: 'ready' as const
  },
  {
    id: 'left',
    span: 1 as const,
    spreadId: 'pair',
    role: 'story',
    number: 1,
    artwork: 'ready' as const
  },
  {
    id: 'right',
    span: 1 as const,
    spreadId: 'pair',
    role: 'story',
    number: 2,
    artwork: 'missing' as const
  },
  {
    id: 'tail',
    span: 1 as const,
    spreadId: null,
    role: 'story',
    number: 3,
    artwork: 'blank' as const
  }
]

const document = (): CollectionPackageDocument => ({
  format: 'cw-collection',
  version: 1,
  collection: {
    sourceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    title: 'Chapter',
    description: '',
    direction: 'rtl',
    firstPageSide: 'right',
    numberStart: 1,
    nextCollectionId: null,
    coverSha: null
  },
  stages: [{ name: 'Inks' }],
  pages: [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      title: 'One',
      label: '',
      role: 'story',
      unnumbered: null,
      notes: 'keep',
      overallStatus: 'in_progress',
      span: 1,
      spreadId: null,
      displayedVersionId: null,
      versions: [],
      stages: [],
      links: [
        {
          kind: 'page',
          collectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          pageId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
        },
        {
          kind: 'page',
          collectionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          pageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
        }
      ],
      comments: ['secret'],
      tags: ['Inks']
    }
  ],
  nav: [],
  assets: []
})

describe('collection export planning', () => {
  it('keeps a wide page as one file and warns instead of dropping a blank', () => {
    const plan = planCollectionExport(pages, {
      format: 'png',
      spread: 'page',
      omitUnavailable: false
    })
    expect(plan.slots.map((slot) => slot.pageIds)).toEqual([
      ['cover'],
      ['left'],
      ['right'],
      ['tail']
    ])
    expect(plan.slots[0]?.fileName).toBe('001.png')
    expect(plan.warnings.map((warning) => warning.pageId)).toEqual(['right', 'tail'])
  })

  it('puts a locked pair on one spread and can omit unavailable pages on purpose', () => {
    const spreads = planCollectionExport(pages, {
      format: 'jpeg',
      spread: 'spread',
      omitUnavailable: false
    })
    expect(spreads.slots.map((slot) => slot.pageIds)).toEqual([
      ['cover'],
      ['left', 'right'],
      ['tail']
    ])
    expect(spreads.slots[0]?.fileName).toBe('001.jpg')
    const omitted = planCollectionExport(pages, {
      format: 'webp',
      spread: 'page',
      omitUnavailable: true
    })
    expect(omitted.slots.map((slot) => slot.pageIds)).toEqual([['cover'], ['left']])
    expect(omitted.warnings).toHaveLength(2)
  })

  it('ignores reader resume and remaps only links inside the package', () => {
    const parsed = validateCollectionPackage({
      ...document(),
      collection: { ...document().collection, readerZoom: 4, readerPageId: 'nope' }
    })
    expect('document' in parsed).toBe(true)
    if (!('document' in parsed)) return
    expect(parsed.document.collection).not.toHaveProperty('readerZoom')
    expect(parsed.document.collection.direction).toBe('rtl')
    const inside = remapPackageDestination(
      parsed.document.pages[0]!.links[0]!,
      parsed.document.collection.sourceId,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      new Map([['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ffffffff-ffff-4fff-8fff-ffffffffffff']])
    )
    expect(inside.unresolved).toBe(false)
    expect(inside.destination).toMatchObject({
      collectionId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      pageId: 'ffffffff-ffff-4fff-8fff-ffffffffffff'
    })
    const outside = remapPackageDestination(
      parsed.document.pages[0]!.links[1]!,
      parsed.document.collection.sourceId,
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      new Map()
    )
    expect(outside.unresolved).toBe(true)
    expect(outside.destination).toMatchObject({ pageId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' })
    expect(nextForPackage('cccccccc-cccc-4ccc-8ccc-cccccccccccc', new Set())).toEqual({
      id: null,
      unresolved: true
    })
    expect(
      nextForPackage(
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        new Set(['cccccccc-cccc-4ccc-8ccc-cccccccccccc'])
      )
    ).toEqual({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', unresolved: false })
  })
})
