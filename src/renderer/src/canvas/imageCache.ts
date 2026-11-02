import { useEffect, useReducer } from 'react'

interface Entry {
  image: HTMLImageElement
  status: 'loading' | 'ready' | 'failed'
  ready: Promise<void>
  /** Components currently showing this image. */
  users: number
  lastUsed: number
}

/** Decoded images no longer on screen are kept up to this size (bytes, RGBA) for quick reuse. */
const UNUSED_BUDGET = 256 * 1024 * 1024

const cache = new Map<string, Entry>()

const decodedBytes = (image: HTMLImageElement) => image.naturalWidth * image.naturalHeight * 4

function acquire(url: string): Entry {
  let entry = cache.get(url)
  if (!entry) {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    const created: Entry = {
      image,
      status: 'loading',
      users: 0,
      lastUsed: 0,
      // decode() finishes off the main thread, so big images don't stall the canvas.
      ready: image.decode().then(
        () => {
          created.status = 'ready'
        },
        () => {
          created.status = 'failed'
        }
      )
    }
    entry = created
    cache.set(url, entry)
  }
  entry.users++
  entry.lastUsed = performance.now()
  return entry
}

function release(url: string): void {
  const entry = cache.get(url)
  if (!entry) return
  entry.users = Math.max(0, entry.users - 1)
  entry.lastUsed = performance.now()
  trim()
}

/** Forgets the least recently used images nobody is showing until they fit the budget. */
function trim(): void {
  const unused = [...cache.entries()]
    .filter(([, e]) => e.users === 0)
    .sort(([, a], [, b]) => a.lastUsed - b.lastUsed)
  let total = unused.reduce((sum, [, e]) => sum + decodedBytes(e.image), 0)
  for (const [url, entry] of unused) {
    if (total <= UNUSED_BUDGET && entry.status !== 'failed') break
    total -= decodedBytes(entry.image)
    entry.image.src = ''
    cache.delete(url)
  }
}

export type ImageState =
  | { status: 'none' }
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'ready'; image: HTMLImageElement }

/** Resolves when every image currently on screen has finished decoding. */
export function waitForShownImages(): Promise<void> {
  const pending = [...cache.values()]
    .filter((entry) => entry.users > 0 && entry.status === 'loading')
    .map((entry) => entry.ready)
  return Promise.all(pending).then(() => undefined)
}

/** Loads and decodes an image for drawing on the canvas; shared between everything showing it. */
export function useImage(url: string | undefined): ImageState {
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!url) return
    const entry = acquire(url)
    let active = true
    if (entry.status === 'loading') void entry.ready.then(() => active && rerender())
    return () => {
      active = false
      release(url)
    }
  }, [url])
  if (!url) return { status: 'none' }
  const entry = cache.get(url)
  if (!entry || entry.status === 'loading') return { status: 'loading' }
  if (entry.status === 'failed') return { status: 'failed' }
  return { status: 'ready', image: entry.image }
}
