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

const notFound = () => new Response('Not found', { status: 404 })

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
    const response = await net.fetch(pathToFileURL(file.path).toString())
    if (!response.ok) return notFound()
    return new Response(response.body, {
      headers: {
        'Content-Type': file.mime,
        // Content-addressed: a URL always means the same bytes.
        'Cache-Control': 'private, max-age=31536000, immutable'
      }
    })
  })
}
