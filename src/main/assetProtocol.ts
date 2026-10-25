import { open } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { ASSET_SCHEME, THUMBNAIL_SIZES } from '@shared/assets'
import type { AssetVariant } from '@shared/types'
import type { ProjectRegistry } from './project/projectRegistry'

/** Must run before the app is ready. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: ASSET_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

const notFound = () =>
  new Response('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }
  })

/**
 * Serves `cw-asset://<projectId>/<sha256>/<256|1024|original>` from an open project's
 * `assets/` and `thumbs/` folders. Only files of known assets can be reached.
 */
export function handleAssetRequests(registry: ProjectRegistry): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const url = new URL(request.url)
    const [sha256 = '', rawVariant = ''] = url.pathname.split('/').filter(Boolean)
    const variant: AssetVariant | undefined =
      rawVariant === 'original'
        ? 'original'
        : THUMBNAIL_SIZES.find((size) => String(size) === rawVariant)
    const project = registry.findById(url.hostname)
    if (!project || !variant) return notFound()

    const file = await project.assets.fileFor(sha256, variant)
    if (!file) return notFound()
    return serveFile(file.path, file.mime, request)
  })
}

/**
 * Serves a file, including `Range` so pdf.js can read a PDF without downloading it all first.
 * A missing file is not cached: a PDF cover is written after the card is already on screen.
 */
async function serveFile(path: string, mime: string, request: Request): Promise<Response> {
  const headers = {
    'Content-Type': mime,
    'Accept-Ranges': 'bytes',
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'private, max-age=31536000, immutable'
  }
  const range = request.headers.get('range')
  // Images load the whole file. Don't hold our own handle while net.fetch reads it:
  // on Windows that lock makes the response come back empty.
  if (!range) {
    const response = await net.fetch(pathToFileURL(path).toString())
    if (!response.ok) return notFound()
    const extra = new Headers(response.headers)
    for (const [key, value] of Object.entries(headers)) extra.set(key, value)
    return new Response(response.body, { status: 200, headers: extra })
  }
  let file
  try {
    file = await open(path, 'r')
  } catch {
    return notFound()
  }
  try {
    const { size } = await file.stat()
    const parsed = parseByteRange(range, size)
    if (!parsed) {
      return new Response(null, {
        status: 416,
        headers: { 'Content-Range': `bytes */${size}` }
      })
    }
    const buf = Buffer.alloc(parsed.end - parsed.start + 1)
    await file.read(buf, 0, buf.length, parsed.start)
    return new Response(new Uint8Array(buf), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${parsed.start}-${parsed.end}/${size}`,
        'Content-Length': String(buf.length)
      }
    })
  } finally {
    await file.close()
  }
}

/** `bytes=start-end`, or null when the header is unusable. */
export function parseByteRange(
  header: string,
  size: number
): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || size <= 0) return null
  const startText = match[1] ?? ''
  const endText = match[2] ?? ''
  if (!startText && !endText) return null
  let start: number
  let end: number
  if (!startText) {
    const suffix = Number(endText)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startText)
    end = endText ? Number(endText) : size - 1
  }
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < 0 ||
    start >= size ||
    end < start
  ) {
    return null
  }
  return { start, end: Math.min(end, size - 1) }
}
