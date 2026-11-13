/** Internal and external navigation targets (M8). Identity is the id, never the title. */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type Destination =
  | { kind: 'board'; boardId: string; title?: string }
  | { kind: 'object'; boardId: string; objectId: string; title?: string }
  | { kind: 'pdf'; boardId: string; objectId: string; page: number; title?: string }
  | { kind: 'stack'; boardId: string; objectId: string; title?: string }
  | { kind: 'slide'; boardId: string; objectId: string; slideId: string; title?: string }
  | { kind: 'camera'; boardId: string; x: number; y: number; zoom: number; title?: string }
  | { kind: 'url'; href: string; title?: string }
  | { kind: 'collection'; collectionId: string; title?: string }
  | { kind: 'page'; collectionId: string; pageId: string; title?: string }

const KINDS = new Set([
  'board',
  'object',
  'pdf',
  'stack',
  'slide',
  'camera',
  'url',
  'collection',
  'page'
])

const id = (value: unknown): string | null =>
  typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null

const titleOf = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined
  const text = value.trim().slice(0, 200)
  return text || undefined
}

/** Returns a destination, or null when the value is not one we can store. */
export function parseDestination(value: unknown): Destination | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  if (typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) return null
  const title = titleOf(raw.title)
  if (raw.kind === 'collection') {
    const collectionId = id(raw.collectionId)
    return collectionId ? { kind: 'collection', collectionId, ...(title ? { title } : {}) } : null
  }
  if (raw.kind === 'page') {
    const collectionId = id(raw.collectionId)
    const pageId = id(raw.pageId)
    return collectionId && pageId
      ? { kind: 'page', collectionId, pageId, ...(title ? { title } : {}) }
      : null
  }
  if (raw.kind === 'url') {
    const href = normalizePublicUrl(raw.href)
    return href ? { kind: 'url', href, ...(title ? { title } : {}) } : null
  }
  const boardId = id(raw.boardId)
  if (!boardId) return null
  if (raw.kind === 'board') return { kind: 'board', boardId, ...(title ? { title } : {}) }
  if (raw.kind === 'camera') {
    if (typeof raw.x !== 'number' || typeof raw.y !== 'number' || typeof raw.zoom !== 'number')
      return null
    if (![raw.x, raw.y, raw.zoom].every(Number.isFinite)) return null
    return {
      kind: 'camera',
      boardId,
      x: raw.x,
      y: raw.y,
      zoom: Math.min(8, Math.max(0.05, raw.zoom)),
      ...(title ? { title } : {})
    }
  }
  const objectId = id(raw.objectId)
  if (!objectId) return null
  if (raw.kind === 'object')
    return { kind: 'object', boardId, objectId, ...(title ? { title } : {}) }
  if (raw.kind === 'stack') return { kind: 'stack', boardId, objectId, ...(title ? { title } : {}) }
  if (raw.kind === 'pdf') {
    const page = typeof raw.page === 'number' ? Math.floor(raw.page) : 0
    if (page < 1 || page > 100000) return null
    return { kind: 'pdf', boardId, objectId, page, ...(title ? { title } : {}) }
  }
  const slideId = id(raw.slideId)
  if (raw.kind === 'slide' && slideId)
    return { kind: 'slide', boardId, objectId, slideId, ...(title ? { title } : {}) }
  return null
}

/** Ids that identify the target. Titles are display-only and are not compared. */
export function destinationIds(destination: Destination): string[] {
  if (destination.kind === 'url') return []
  if (destination.kind === 'collection') return [destination.collectionId]
  if (destination.kind === 'page') return [destination.collectionId, destination.pageId]
  if (destination.kind === 'board' || destination.kind === 'camera') return [destination.boardId]
  if (destination.kind === 'slide')
    return [destination.boardId, destination.objectId, destination.slideId]
  return [destination.boardId, destination.objectId]
}

/**
 * Points copied destinations at the new copies when those targets were copied too.
 * Anything outside the copy keeps its original id. With `detachOutside`, an id that
 * was not copied becomes a missing reference instead of pointing at another project.
 */
export function remapDestination(
  destination: Destination,
  ids: Map<string, string>,
  detachOutside = false
): Destination | null {
  if (destination.kind === 'url') return destination
  const mapId = (value: string): string | null => {
    const next = ids.get(value)
    if (next) return next
    return detachOutside ? null : value
  }
  if (destination.kind === 'collection') {
    const collectionId = mapId(destination.collectionId)
    return collectionId ? { ...destination, collectionId } : null
  }
  if (destination.kind === 'page') {
    const collectionId = mapId(destination.collectionId)
    const pageId = mapId(destination.pageId)
    if (!collectionId || !pageId) return null
    return { ...destination, collectionId, pageId }
  }
  const boardId = mapId(destination.boardId)
  if (!boardId) return null
  if (destination.kind === 'board') return { ...destination, boardId }
  if (destination.kind === 'camera') return { ...destination, boardId }
  const objectId = mapId(destination.objectId)
  if (!objectId) return null
  if (destination.kind === 'slide') {
    const slideId = mapId(destination.slideId)
    if (!slideId) return null
    return { ...destination, boardId, objectId, slideId }
  }
  return { ...destination, boardId, objectId }
}

/** HTTP(S) only, with no username or password in the address. */
export function normalizePublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (isBlockedHost(url.hostname)) return null
  return url.toString()
}

/** True for loopback, private, link-local, and local-metadata hosts. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .toLowerCase()
    .replace(/\.$/, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local'))
    return true
  if (host === 'metadata.google.internal' || host === 'metadata.google.com') return true
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true
  const mapped = host.startsWith('::ffff:') ? host.slice(7) : host
  const parts = mapped.split('.').map((part) => Number(part))
  if (
    parts.length === 4 &&
    parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
  ) {
    const [a, b] = parts
    if (a === 0 || a === 10 || a === 127) return true
    if (a === 169 && b === 254) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 100 && b >= 64 && b <= 127) return true
    if (a === 255) return true
  }
  if (host.includes(':')) {
    if (host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true
  }
  return false
}

const ENTITY: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

function decode(text: string): string {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_all, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code > 0 && code < 0x110000
          ? String.fromCodePoint(code)
          : ''
      }
      return ENTITY[body.toLowerCase()] ?? ''
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function meta(html: string, key: string): string | null {
  const pattern = new RegExp(
    `<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["']`,
    'i'
  )
  const match = pattern.exec(html)
  const value = decode(match?.[1] || match?.[2] || '')
  return value.slice(0, 500) || null
}

/** Reads title, description, and a preview image address from HTML. No markup is kept. */
export function readPreviewMeta(html: string): {
  title: string
  description: string
  image: string | null
} {
  const limited = html.slice(0, 1_000_000)
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(limited)
  const title = (meta(limited, 'og:title') || decode(titleMatch?.[1] ?? '')).slice(0, 300)
  const description = (meta(limited, 'og:description') || meta(limited, 'description') || '').slice(
    0,
    500
  )
  const image = normalizePublicUrl(meta(limited, 'og:image'))
  return { title, description, image }
}

/** `cw:` address for a destination, used inside a note link. External URLs stay http(s). */
export function destinationHref(destination: Destination): string {
  if (destination.kind === 'url') return destination.href
  if (destination.kind === 'collection') return `cw://collection/${destination.collectionId}`
  if (destination.kind === 'page')
    return `cw://page/${destination.collectionId}/${destination.pageId}`
  if (destination.kind === 'board') return `cw://board/${destination.boardId}`
  if (destination.kind === 'camera')
    return `cw://camera/${destination.boardId}/${destination.x}/${destination.y}/${destination.zoom}`
  if (destination.kind === 'pdf')
    return `cw://pdf/${destination.boardId}/${destination.objectId}/${destination.page}`
  if (destination.kind === 'stack')
    return `cw://stack/${destination.boardId}/${destination.objectId}`
  if (destination.kind === 'slide')
    return `cw://slide/${destination.boardId}/${destination.objectId}/${destination.slideId}`
  return `cw://object/${destination.boardId}/${destination.objectId}`
}

/** Parses a `cw:` note link. Anything else is not an internal destination. */
export function destinationFromHref(href: string): Destination | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'cw:') return null
  const parts = url.pathname.split('/').filter(Boolean)
  const host = url.hostname
  if (host === 'collection' && parts[0])
    return parseDestination({ kind: 'collection', collectionId: parts[0] })
  if (host === 'page' && parts.length >= 2)
    return parseDestination({ kind: 'page', collectionId: parts[0], pageId: parts[1] })
  if (host === 'board' && parts[0]) return parseDestination({ kind: 'board', boardId: parts[0] })
  if (host === 'object' && parts.length >= 2)
    return parseDestination({ kind: 'object', boardId: parts[0], objectId: parts[1] })
  if (host === 'stack' && parts.length >= 2)
    return parseDestination({ kind: 'stack', boardId: parts[0], objectId: parts[1] })
  if (host === 'pdf' && parts.length >= 3)
    return parseDestination({
      kind: 'pdf',
      boardId: parts[0],
      objectId: parts[1],
      page: Number(parts[2])
    })
  if (host === 'slide' && parts.length >= 3)
    return parseDestination({
      kind: 'slide',
      boardId: parts[0],
      objectId: parts[1],
      slideId: parts[2]
    })
  if (host === 'camera' && parts.length >= 4)
    return parseDestination({
      kind: 'camera',
      boardId: parts[0],
      x: Number(parts[1]),
      y: Number(parts[2]),
      zoom: Number(parts[3])
    })
  return null
}
