/**
 * Opt-in preview fetch for an external link. Addresses are checked before and after DNS
 * lookup so a public name cannot redirect the app at a private network.
 */
import { lookup } from 'node:dns/promises'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { isBlockedHost, normalizePublicUrl, readPreviewMeta } from '@shared/destinations'
import { boardObjects, linkPreviews } from '../db/schema'
import type { Project } from './project'
import { RELATION_CONFLICT } from './relations'

const MAX_HTML = 1_000_000
const MAX_IMAGE = 2_000_000
const TIMEOUT_MS = 8000

async function publicAddress(url: URL): Promise<void> {
  if (isBlockedHost(url.hostname)) throw new Error('That address cannot be previewed.')
  const looked = await lookup(url.hostname, { all: true })
  if (looked.length === 0 || looked.some((entry) => isBlockedHost(entry.address))) {
    throw new Error('That address cannot be previewed.')
  }
}

async function readPublic(
  url: string,
  accept: string,
  limit: number,
  redirects = 0
): Promise<{ body: Buffer; type: string }> {
  const parsed = new URL(url)
  await publicAddress(parsed)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(parsed, {
      redirect: 'manual',
      signal: controller.signal,
      headers: { Accept: accept, 'User-Agent': 'CreativeWorkspace/0.1' }
    })
    if (response.status >= 300 && response.status < 400) {
      if (redirects >= 3) throw new Error('The preview redirected too many times.')
      const next = response.headers.get('location')
      if (!next) throw new Error('The preview redirect had no destination.')
      const resolved = new URL(next, parsed).toString()
      if (!normalizePublicUrl(resolved)) throw new Error('That address cannot be previewed.')
      return readPublic(resolved, accept, limit, redirects + 1)
    }
    if (!response.ok) throw new Error(`The page replied ${response.status}.`)
    const type = response.headers.get('content-type') ?? ''
    const reader = response.body?.getReader()
    if (!reader) throw new Error('The page had no preview.')
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const step = await reader.read()
      if (step.done) break
      total += step.value.byteLength
      if (total > limit) throw new Error('The preview is too large.')
      chunks.push(Buffer.from(step.value))
    }
    return { body: Buffer.concat(chunks), type }
  } finally {
    clearTimeout(timer)
  }
}

/** Downloads title, description, and an image for one link card. Never runs on project open. */
export async function fetchLinkPreview(
  project: Project,
  objectId: string,
  baseRevision: number
): Promise<{ revision: number }> {
  const row = project.db.select().from(boardObjects).where(eq(boardObjects.id, objectId)).get()
  if (!row || row.deletedAt || row.type !== 'link') throw new Error('Link not found.')
  if (row.revision !== baseRevision) throw new Error(RELATION_CONFLICT)
  const href = normalizePublicUrl(
    (row.data as { destination?: { href?: string } }).destination?.href
  )
  if (!href) throw new Error('Add a web address before generating a preview.')
  let title = ''
  let description = ''
  let imageFile: string | null = null
  let error: string | null = null
  try {
    const page = await readPublic(href, 'text/html', MAX_HTML)
    if (!page.type.includes('html') && !page.type.includes('text')) {
      throw new Error('That page is not a document we can preview.')
    }
    const meta = readPreviewMeta(page.body.toString('utf8'))
    title = meta.title
    description = meta.description
    if (meta.image) {
      const image = await readPublic(meta.image, 'image/*', MAX_IMAGE)
      if (image.type.startsWith('image/')) {
        const ext = image.type.includes('png')
          ? 'png'
          : image.type.includes('webp')
            ? 'webp'
            : 'jpg'
        const dir = join(project.path, 'thumbs', 'link-previews')
        await mkdir(dir, { recursive: true })
        imageFile = `${objectId}.${ext}`
        await writeFile(join(dir, imageFile), image.body)
      }
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : 'The preview could not be loaded.'
  }
  project.db
    .insert(linkPreviews)
    .values({
      objectId,
      url: href,
      title: title || null,
      description: description || null,
      imageFile,
      fetchedAt: new Date(),
      error
    })
    .onConflictDoUpdate({
      target: linkPreviews.objectId,
      set: {
        url: href,
        title: title || null,
        description: description || null,
        imageFile,
        fetchedAt: new Date(),
        error
      }
    })
    .run()
  return project.relations.updateLink(objectId, baseRevision, {
    ...row.data,
    title: (row.data.title as string | undefined) || title,
    description: (row.data.description as string | undefined) || description
  })
}
