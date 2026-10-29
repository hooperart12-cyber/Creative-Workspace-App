import { describe, expect, it } from 'vitest'
import {
  destinationFromHref,
  destinationHref,
  isBlockedHost,
  normalizePublicUrl,
  parseDestination,
  readPreviewMeta,
  remapDestination
} from './destinations'

const board = '11111111-1111-4111-8111-111111111111'
const objectId = '22222222-2222-4222-8222-222222222222'
const slide = '33333333-3333-4333-8333-333333333333'

describe('destinations', () => {
  it('keeps a renamed title off the identity and refuses a filename used as an id', () => {
    const parsed = parseDestination({
      kind: 'slide',
      boardId: board,
      objectId,
      slideId: slide,
      title: 'Page 3'
    })
    expect(parsed).toMatchObject({ kind: 'slide', slideId: slide, title: 'Page 3' })
    expect(
      parseDestination({ kind: 'slide', boardId: board, objectId, slideId: 'left.png' })
    ).toBeNull()
    expect(parseDestination({ kind: 'pdf', boardId: board, objectId, page: 0 })).toBeNull()
  })

  it('remaps only destinations that were part of the same copy', () => {
    const link = parseDestination({ kind: 'object', boardId: board, objectId })!
    const ids = new Map([[objectId, '44444444-4444-4444-8444-444444444444']])
    const remapped = remapDestination(link, ids)
    expect(remapped?.kind).toBe('object')
    if (remapped?.kind === 'object') {
      expect(remapped.objectId).toBe('44444444-4444-4444-8444-444444444444')
      expect(remapped.boardId).toBe(board)
    }
    expect(remapDestination({ kind: 'url', href: 'https://example.com/a' }, ids)?.kind).toBe('url')
    expect(remapDestination(link, new Map(), true)).toBeNull()
  })

  it('rejects dangerous addresses and credentials', () => {
    expect(normalizePublicUrl('https://user:pass@example.com')).toBeNull()
    expect(normalizePublicUrl('javascript:alert(1)')).toBeNull()
    expect(normalizePublicUrl('file:///c:/secret')).toBeNull()
    expect(normalizePublicUrl('http://127.0.0.1/latest')).toBeNull()
    expect(normalizePublicUrl('http://169.254.169.254/')).toBeNull()
    expect(normalizePublicUrl('http://10.1.2.3/')).toBeNull()
    expect(normalizePublicUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(isBlockedHost('localhost')).toBe(true)
    expect(isBlockedHost('metadata.google.internal')).toBe(true)
  })

  it('reads preview text without keeping markup', () => {
    const meta = readPreviewMeta(
      '<html><title>Ignored</title><meta property="og:title" content="Studio"><meta name="description" content="Notes &amp; art"><script>alert(1)</script></html>'
    )
    expect(meta.title).toBe('Studio')
    expect(meta.description).toBe('Notes & art')
    expect(meta.description.includes('<')).toBe(false)
  })

  it('round-trips an internal note link and leaves ordinary web addresses alone', () => {
    const destination = parseDestination({ kind: 'pdf', boardId: board, objectId, page: 4 })!
    const href = destinationHref(destination)
    expect(destinationFromHref(href)).toMatchObject({ kind: 'pdf', page: 4, objectId })
    expect(destinationFromHref('https://example.com')).toBeNull()
  })
})
